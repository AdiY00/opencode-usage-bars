import { expect, test } from "bun:test"
import { createUsageRefresh, mergeReadings } from "./refresh"
import type { ProviderUsage, UsageCache } from "./types"
import { z } from "zod"
import { usageOutput } from "./rpc"

const good: ProviderUsage = {
  name: "Codex", integrationID: "openai", id: "one", account: "Work",
  windows: [{ usedPercent: 20, resetsAt: 1_800_000_000, summary: true }],
}
const deferred = <T>() => Promise.withResolvers<T>()

test("overlapping manual and scheduled refreshes share one provider fetch", async () => {
  const load = deferred<ProviderUsage[]>()
  let calls = 0
  const writes: UsageCache[] = []
  const usage = createUsageRefresh({ load: () => { calls++; return load.promise }, write: async value => { writes.push(value) } })
  const first = usage.refresh()
  expect(usage.refresh()).toBe(first)
  expect(calls).toBe(1)
  load.resolve([good])
  expect((await first).providers![0]!.windows).toEqual(good.windows)
  expect(writes).toHaveLength(1)
  await usage.refresh()
  expect(calls).toBe(2)
})

test("credential changes discard an in-flight result and queue a new read", async () => {
  const old = deferred<ProviderUsage[]>()
  const fresh = deferred<ProviderUsage[]>()
  const started = deferred<void>()
  let calls = 0
  const writes: UsageCache[] = []
  const usage = createUsageRefresh({
    load: () => { calls++; if (calls === 1) return old.promise; started.resolve(); return fresh.promise },
    write: async value => { writes.push(value) },
  })
  const first = usage.refresh()
  const invalidated = usage.invalidate()
  expect(usage.get().providers).toBeUndefined()
  old.resolve([good])
  await started.promise
  expect(usage.get().providers).toBeUndefined()
  fresh.resolve([{ ...good, id: "two", windows: undefined, error: "Unauthorized" }])
  await Promise.all([first, invalidated])
  expect(calls).toBe(2)
  expect(usage.get().providers![0]!.windows).toBeUndefined()
  expect(writes.some(value => value.providers?.some(provider => provider.id === "one"))).toBe(false)
})

test("failed reads retain only the same resolved account's windows and success time", () => {
  const previous = mergeReadings([], [good], "first")
  const failed = { ...good, windows: undefined, error: "Request failed: 503" }
  const stale = mergeReadings(previous, [failed], "second")
  expect(stale[0]).toMatchObject({ stale: true, windows: good.windows, lastSuccessAt: "first", lastAttemptAt: "second", error: failed.error })
  expect(mergeReadings(stale, [failed], "third")[0]!.lastSuccessAt).toBe("first")
  expect(mergeReadings(stale, [good], "fourth")[0]).toMatchObject({ stale: false, lastSuccessAt: "fourth" })
  for (const changed of [{ id: "two" }, { account: "Personal" }, { integrationID: "other" }, { id: undefined }]) {
    expect(mergeReadings(previous, [{ ...failed, ...changed }], "second")[0]!.windows).toBeUndefined()
  }
  expect(mergeReadings(previous, [{ name: "Codex", error: "Discovery failed" }], "second")[0]!.windows).toBeUndefined()
  expect(mergeReadings(previous, [], "second")).toEqual([])
})

test("credential replacement clears existing last-good data even if connection ID is reused", async () => {
  let failed = false
  const usage = createUsageRefresh({ load: async () => [{ ...good, ...(failed ? { windows: undefined, error: "Unauthorized" } : {}) }], write: async () => {} })
  await usage.refresh()
  failed = true
  await usage.invalidate()
  expect(usage.get().providers![0]!.windows).toBeUndefined()
  expect(usage.get().providers![0]!.lastSuccessAt).toBeUndefined()
})

test("disk failures do not destroy successful RPC readings", async () => {
  const errors: unknown[] = []
  const usage = createUsageRefresh({ load: async () => [good], write: async () => { throw new Error("Disk full") }, onError: error => { errors.push(error) } })
  expect((await usage.refresh()).providers![0]!.windows).toEqual(good.windows)
  expect(errors).toHaveLength(1)
})

test("unexpected load failures are marked stale without exposing exception details", async () => {
  let failed = false
  const usage = createUsageRefresh({
    load: async () => { if (failed) throw new Error("private upstream details"); return [good] },
    write: async () => {},
  })
  await usage.refresh()
  failed = true
  const result = await usage.refresh()
  expect(result.error).toBe("Unable to refresh usage")
  expect(result.providers![0]).toMatchObject({ stale: true, windows: good.windows, error: result.error })
  expect(JSON.stringify(result)).not.toContain("private upstream details")
})

test("successful snapshots omit absent top-level errors for the RPC JSON encoder", async () => {
  const usage = createUsageRefresh({ load: async () => [good], write: async () => {} })
  const snapshot = await usage.refresh()
  expect(() => z.json().parse(snapshot)).not.toThrow()
  expect(snapshot).not.toHaveProperty("error")
})

test("RPC outputs strip nested undefined optionals in fresh and stale readings", () => {
  const reading = { ...good, account: undefined, windows: good.windows!.map(window => ({ ...window, label: undefined, durationSeconds: undefined })) }
  const fresh = mergeReadings([], [reading], "first")
  const stale = mergeReadings(fresh, [{ ...reading, windows: undefined, error: "503" }], "second")
  for (const providers of [fresh, stale]) {
    const output = usageOutput({ providers, error: undefined })
    expect(() => z.json().parse(output)).not.toThrow()
    expect(output.providers![0]).not.toHaveProperty("account")
    expect(output.providers![0]!.windows![0]).not.toHaveProperty("durationSeconds")
    expect(output.providers![0]!.windows![0]).not.toHaveProperty("label")
  }
  expect(usageOutput({ error: "Waiting for usage data" })).toEqual({ error: "Waiting for usage data" })
})

test("stopped plugins cannot publish a late result", async () => {
  const load = deferred<ProviderUsage[]>()
  const writes: UsageCache[] = []
  const usage = createUsageRefresh({ load: () => load.promise, write: async value => { writes.push(value) } })
  const pending = usage.refresh()
  usage.stop()
  load.resolve([good])
  await pending
  expect(usage.get().providers).toBeUndefined()
  expect(writes).toEqual([])
})

test("cache writes stay ordered when credentials change during a write", async () => {
  const writing = deferred<void>()
  const release = deferred<void>()
  const writes: UsageCache[] = []
  let first = true
  let failed = false
  const usage = createUsageRefresh({
    load: async () => [{ ...good, ...(failed ? { windows: undefined, error: "Unauthorized" } : {}) }],
    write: async value => {
      if (first) { first = false; writing.resolve(); await release.promise }
      writes.push(value)
    },
  })
  const pending = usage.refresh()
  await writing.promise
  failed = true
  const invalidated = usage.invalidate()
  expect(usage.get().providers).toBeUndefined()
  release.resolve()
  await Promise.all([pending, invalidated])
  expect(writes.at(-1)?.providers![0]!.windows).toBeUndefined()
})

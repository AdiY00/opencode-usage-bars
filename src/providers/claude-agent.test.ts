import { expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { claudeWindows, createClaudeAgent, readClaudeCredentials } from "./claude-agent"
import { loadProvider } from "./types"

const reset = "2026-11-06T06:00:00Z"
const payload = {
  five_hour: { utilization: 6, resets_at: reset },
  seven_day: { utilization: 20, resets_at: reset },
  seven_day_opus: null,
  seven_day_sonnet: { utilization: 30, resets_at: reset },
}
const credentials = { accessToken: "private-token", expiresAt: Date.now() + 60_000 }
function context(connections: unknown[] = [{ type: "credential", method: "external", id: "claude-login", label: "Personal" }]) {
  return { integration: { get: async ({ integrationID }: { integrationID: string }) => {
    expect(integrationID).toBe("claude-agent")
    return { data: { connections } }
  } } } as unknown as Plugin.Context
}

test("Claude windows map percentages, reset timestamps, and summary metadata", () => {
  expect(claudeWindows(payload)).toEqual([
    { label: "Session", usedPercent: 6, resetsAt: Date.parse(reset) / 1000, durationSeconds: 18000, summary: false },
    { label: "Weekly", usedPercent: 20, resetsAt: Date.parse(reset) / 1000, durationSeconds: 604800, summary: true },
    { label: "Weekly Sonnet", usedPercent: 30, resetsAt: Date.parse(reset) / 1000, durationSeconds: 604800, summary: false },
  ])
})

test("Claude ignores unknown and invalid windows without inventing zero usage", () => {
  expect(claudeWindows({ ...payload, five_hour: { utilization: "6", resets_at: reset }, seven_day_sonnet: { utilization: 3, resets_at: "invalid" }, mystery: payload.five_hour })).toHaveLength(1)
  for (const invalid of [null, {}, { five_hour: { utilization: -1, resets_at: reset } }, { seven_day: { utilization: NaN, resets_at: reset } }]) {
    expect(() => claudeWindows(invalid)).toThrow()
  }
})

test("Claude requests use local OAuth credentials and reread them on each fetch", async () => {
  let reads = 0
  const provider = createClaudeAgent({
    readCredentials: async () => { reads++; return { ...credentials, accessToken: `token-${reads}` } },
    request: (async (url, options) => {
      expect(url).toBe("https://api.anthropic.com/api/oauth/usage")
      const headers = new Headers(options?.headers)
      expect(headers.get("Authorization")).toBe(`Bearer token-${reads}`)
      expect(headers.get("anthropic-beta")).toBe("oauth-2025-04-20")
      expect(options?.signal).toBeInstanceOf(AbortSignal)
      return Response.json(payload)
    }),
  })
  const sources = await provider.sources(context())
  expect(sources[0]).toMatchObject({ account: "Personal", id: "claude-login", integrationID: "claude-agent" })
  await sources[0]!.fetch()
  await sources[0]!.fetch()
  expect(reads).toBe(2)
})

test("Claude authentication errors stay scoped to its provider", async () => {
  const provider = createClaudeAgent({ readCredentials: async () => ({ ...credentials, expiresAt: 1 }), request: async () => { throw new Error("Must not fetch") } })
  expect((await loadProvider(provider, context()))[0]).toMatchObject({ name: "Claude Agent", id: "claude-login", error: expect.stringContaining("expired") })
  for (const connections of [[], [{ type: "env", name: "ANTHROPIC_API_KEY" }], [{ type: "credential", method: "key", id: "key", label: "API key" }]]) {
    expect((await loadProvider(provider, context(connections)))[0]!.error).toContain("Connect Claude Agent")
  }
})

test("Claude reports rejected tokens, HTTP failures, and malformed responses without response bodies", async () => {
  for (const [status, body, message] of [[401, "private details", "login was rejected"], [429, "private details", "429"], [500, "private details", "500"], [200, "private details", "Invalid Claude usage response"], [200, "{}", "No supported Claude usage windows"]] as const) {
    const provider = createClaudeAgent({ readCredentials: async () => credentials, request: async () => new Response(body, { status }) })
    const result = await loadProvider(provider, context())
    expect(result[0]!.error).toContain(message)
    expect(JSON.stringify(result)).not.toContain("private")
    expect(result[0]!.windows).toBeUndefined()
  }
})

test("Claude reads custom credential files and sanitizes file and JSON errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "usage-bars-claude-"))
  const previous = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = directory
  try {
    await expect(readClaudeCredentials()).rejects.toThrow("Cannot read Claude Code subscription credentials")
    await writeFile(join(directory, ".credentials.json"), JSON.stringify({ claudeAiOauth: credentials }))
    expect(await readClaudeCredentials()).toEqual(credentials)
    for (const contents of ["private-token", "{}", '{"claudeAiOauth":{"accessToken":"private-token"}}']) {
      await writeFile(join(directory, ".credentials.json"), contents)
      await expect(readClaudeCredentials()).rejects.toThrow("Cannot read Claude Code subscription credentials")
    }
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
    await rm(directory, { recursive: true, force: true })
  }
})

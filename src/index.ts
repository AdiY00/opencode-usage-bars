import { Plugin } from "@opencode-ai/plugin"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

const cacheFile = `${process.env.XDG_CACHE_HOME ?? `${process.env.HOME}/.cache`}/opencode/usage-bars.json`

type Window = {
  used_percent?: number
  limit_window_seconds?: number
  reset_at?: number
}

export default Plugin.define({
  id: "usage-bars",
  tui: true,
  setup: async (ctx) => {
    const refresh = async () => {
      const [codex, go] = await Promise.all([
        (async () => {
          const integration = await ctx.integration.get({ integrationID: "openai" })
          const accounts = (await Promise.all((integration.data?.connections ?? []).map(async (connection) => {
            if (connection.type !== "credential") return
            const credential = await ctx.integration.connection.resolve(connection).catch(() => undefined)
            const accountID = credential?.metadata?.accountID
            if (credential?.type !== "oauth" || typeof accountID !== "string") return
            return { connection, credential, accountID }
          }))).filter((account) => account !== undefined)

          if (accounts.length === 0) {
            return [await load("Codex", async () => {
              throw new Error("Connect OpenAI with ChatGPT OAuth")
            })]
          }

          return Promise.all(accounts.map(({ connection, credential, accountID }) => load("Codex", async () => {
            const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
              headers: {
                Authorization: `Bearer ${credential.access}`,
                "ChatGPT-Account-Id": accountID,
                Accept: "application/json",
                "User-Agent": "opencode-usage-bars/1",
              },
              signal: AbortSignal.timeout(10_000),
            })
            if (!response.ok) throw new Error(`Usage request failed: ${response.status}`)

            const payload = (await response.json()) as {
              rate_limit?: { primary_window?: Window | null; secondary_window?: Window | null }
            }
            return [payload.rate_limit?.primary_window, payload.rate_limit?.secondary_window]
              .filter((window): window is Window => window !== null && window !== undefined)
              .map((window) => ({
                usedPercent: Number(window.used_percent ?? 0),
                durationSeconds: Number(window.limit_window_seconds ?? 0),
                resetsAt: Number(window.reset_at ?? 0),
              }))
              .filter((window) => Number.isFinite(window.usedPercent) && window.resetsAt > 0)
          }, connection.label, connection.id)))
        })(),
        load("OpenCode Go", async () => {
          const connection = await ctx.integration.connection.active("opencode-go")
          const credential = connection ? await ctx.integration.connection.resolve(connection) : undefined
          if (credential?.type !== "key") throw new Error("Connect OpenCode Go with an API key")

          const response = await fetch("https://opencode.ai/zen/go/v1/usage", {
            headers: {
              Authorization: `Bearer ${credential.key}`,
              Accept: "application/json",
              "User-Agent": "opencode-usage-bars/1",
            },
            signal: AbortSignal.timeout(10_000),
          })
          if (!response.ok) throw new Error(`Usage request failed: ${response.status}`)

          const payload = (await response.json()) as { usage?: Record<string, GoWindow | undefined> }
          const windows: Array<[string, number, GoWindow | undefined]> = [
            ["Rolling", 5 * 60 * 60, payload.usage?.rolling],
            ["Weekly", 7 * 24 * 60 * 60, payload.usage?.weekly],
            ["Monthly", 30 * 24 * 60 * 60, payload.usage?.monthly],
          ]
          return windows.flatMap(([label, durationSeconds, window]) => {
            const resetsAt = window ? Date.parse(window.resetsAt) / 1000 : 0
            if (!window || !Number.isFinite(window.percent) || !Number.isFinite(resetsAt)) return []
            return [{ label, usedPercent: window.percent, durationSeconds, resetsAt }]
          })
        }),
      ])

      await write({ providers: [...codex, go], updatedAt: new Date().toISOString() })
    }

    const safeRefresh = () => void refresh().catch((error) =>
      write({
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      }),
    )

    safeRefresh()
    const timer = setInterval(safeRefresh, 60 * 1000)
    return () => clearInterval(timer)
  },
})

async function write(value: unknown) {
  await mkdir(dirname(cacheFile), { recursive: true })
  await Bun.write(cacheFile, JSON.stringify(value))
}

type GoWindow = {
  percent: number
  resetsAt: string
}

async function load(name: string, fetchWindows: () => Promise<unknown[]>, account?: string, id?: string) {
  try {
    return { name, account, id, windows: await fetchWindows() }
  } catch (error) {
    return { name, account, id, error: error instanceof Error ? error.message : String(error) }
  }
}

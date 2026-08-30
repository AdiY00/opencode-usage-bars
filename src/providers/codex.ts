import type { UsageProvider } from "./types"

type Window = {
  used_percent?: number
  limit_window_seconds?: number
  reset_at?: number
}

export const codex: UsageProvider = {
  name: "Codex",
  async sources(context) {
    const integration = await context.integration.get({ integrationID: "openai" })
    const accounts = (await Promise.all((integration.data?.connections ?? []).map(async (connection) => {
      if (connection.type !== "credential") return
      const credential = await context.integration.connection.resolve(connection).catch(() => undefined)
      const accountID = credential?.metadata?.accountID
      if (credential?.type !== "oauth" || typeof accountID !== "string") return
      return { connection, credential, accountID }
    }))).filter((account) => account !== undefined)

    if (accounts.length === 0) throw new Error("Connect OpenAI with ChatGPT OAuth")

    return accounts.map(({ connection, credential, accountID }) => ({
      account: connection.label,
      id: connection.id,
      async fetch() {
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
            summary: window.limit_window_seconds === 7 * 24 * 60 * 60,
          }))
          .filter((window) => Number.isFinite(window.usedPercent) && window.resetsAt > 0)
      },
    }))
  },
}

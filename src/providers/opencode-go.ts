import type { UsageProvider } from "./types"

type GoWindow = {
  percent: number
  resetsAt: string
}

export const opencodeGo: UsageProvider = {
  name: "OpenCode Go",
  async sources(context) {
    const integration = await context.integration.get({ integrationID: "opencode-go" })
    const accounts = (await Promise.all((integration.data?.connections ?? []).map(async (connection) => {
      if (connection.type !== "credential") return
      const credential = await context.integration.connection.resolve(connection).catch(() => undefined)
      if (credential?.type !== "key") return
      return { connection, credential }
    }))).filter((account) => account !== undefined)

    if (accounts.length === 0) throw new Error("Connect OpenCode Go with an API key")

    return accounts.map(({ connection, credential }) => ({
      account: connection.label,
      id: connection.id,
      integrationID: "opencode-go",
      summaryPace: "worst",
      async fetch() {
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
          return [{ label, usedPercent: window.percent, durationSeconds, resetsAt, summary: label === "Rolling" }]
        })
      },
    }))
  },
}

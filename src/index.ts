import { Plugin } from "@opencode-ai/plugin"
import { writeCache } from "./cache"
import { loadProvider, providers } from "./providers"

export default Plugin.define({
  id: "usage-bars",
  tui: true,
  setup: async (ctx) => {
    const refresh = async () => {
      const usage = await Promise.all(providers.map((provider) => loadProvider(provider, ctx)))
      await writeCache({ providers: usage.flat(), updatedAt: new Date().toISOString() })
    }

    const safeRefresh = () => void refresh().catch((error) =>
      writeCache({
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      }),
    )

    safeRefresh()
    const timer = setInterval(safeRefresh, 60 * 1000)
    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type === "credential.updated") safeRefresh()
      }
    })().catch((error) => {
      if (!controller.signal.aborted) console.error("Usage bars event subscription failed", error)
    })
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  },
})

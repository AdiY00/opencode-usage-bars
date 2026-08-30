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
    return () => clearInterval(timer)
  },
})

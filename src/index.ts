import { Plugin } from "@opencode/plugin"
import { writeCache } from "./cache"
import { loadProvider, providers } from "./providers"
import { Usage } from "./rpc"
import type { UsageCache } from "./types"

export default Plugin.define({
  id: "usage-bars",
  setup: async (ctx) => {
    let latest: UsageCache = { error: "Waiting for usage data" }
    await ctx.rpc.register(Usage, { get: async () => latest })
    const refresh = async () => {
      const usage = await Promise.all(providers.map((provider) => loadProvider(provider, ctx)))
      latest = { providers: usage.flat(), updatedAt: new Date().toISOString() }
      await writeCache(latest)
    }

    const safeRefresh = () => void refresh().catch((error) =>
      writeCache(latest = {
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      }).catch((error) => console.error("Usage bars cache write failed", error)),
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

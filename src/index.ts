import { Plugin } from "@opencode/plugin"
import { writeCache } from "./cache"
import { loadProvider, providers } from "./providers"
import { Usage, usageOutput } from "./rpc"
import { createUsageRefresh } from "./refresh"

export default Plugin.define({
  id: "usage-bars",
  setup: async (ctx) => {
    const usage = createUsageRefresh({
      load: async () => (await Promise.all(providers.map(provider => loadProvider(provider, ctx)))).flat(),
      write: writeCache,
      onError: error => console.error("Usage bars cache write failed", error),
    })
    await ctx.rpc.register(Usage, {
      get: async () => usageOutput(usage.get()),
      refresh: async () => usageOutput(await usage.refresh()),
    })
    const safeRefresh = () => void usage.refresh()

    safeRefresh()
    const timer = setInterval(safeRefresh, 60 * 1000)
    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type === "credential.updated") void usage.invalidate()
      }
    })().catch((error) => {
      if (!controller.signal.aborted) console.error("Usage bars event subscription failed", error)
    })
    return () => {
      controller.abort()
      clearInterval(timer)
      usage.stop()
    }
  },
})

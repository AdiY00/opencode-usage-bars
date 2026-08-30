import type { Plugin } from "@opencode-ai/plugin"
import type { ProviderUsage, UsageWindow } from "../types"

export type UsageSource = Pick<ProviderUsage, "account" | "id" | "summaryPace"> & {
  fetch: () => Promise<UsageWindow[]>
}

export type UsageProvider = {
  name: string
  sources: (context: Plugin.Context) => Promise<UsageSource[]>
}

export async function loadProvider(provider: UsageProvider, context: Plugin.Context): Promise<ProviderUsage[]> {
  try {
    const sources = await provider.sources(context)
    return Promise.all(sources.map(async ({ fetch, ...source }) => {
      try {
        return { name: provider.name, ...source, windows: await fetch() }
      } catch (error) {
        return { name: provider.name, ...source, error: message(error) }
      }
    }))
  } catch (error) {
    return [{ name: provider.name, error: message(error) }]
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

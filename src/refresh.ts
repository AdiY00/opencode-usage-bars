import type { ProviderUsage, UsageCache } from "./types"

function sourceKey(provider: ProviderUsage) {
  // Discovery failures without a resolved connection must never inherit another account's usage.
  if (!provider.id || !provider.integrationID) return undefined
  return JSON.stringify([provider.name, provider.integrationID, provider.id, provider.account])
}

export function mergeReadings(previous: ProviderUsage[], readings: ProviderUsage[], attemptedAt: string): ProviderUsage[] {
  const lastGood = new Map(previous.flatMap(provider => {
    const key = sourceKey(provider)
    return key && provider.windows?.length ? [[key, provider] as const] : []
  }))
  return readings.map(provider => {
    if (!provider.error) return { ...provider, stale: false, lastSuccessAt: attemptedAt, lastAttemptAt: attemptedAt }
    const key = sourceKey(provider)
    const old = key ? lastGood.get(key) : undefined
    if (!old) return { ...provider, lastAttemptAt: attemptedAt }
    return {
      ...provider,
      windows: old.windows,
      stale: true,
      lastSuccessAt: old.lastSuccessAt,
      lastAttemptAt: attemptedAt,
    }
  })
}

export function createUsageRefresh(options: {
  load: () => Promise<ProviderUsage[]>
  write: (snapshot: UsageCache) => Promise<void>
  now?: () => string
  onError?: (error: unknown) => void
}) {
  const now = options.now ?? (() => new Date().toISOString())
  let latest: UsageCache = { error: "Waiting for usage data" }
  let generation = 0
  let stopped = false
  let pending: Promise<UsageCache> | undefined
  let writes = Promise.resolve()
  const persist = (snapshot: UsageCache) => {
    const version = generation
    writes = writes.then(async () => {
      if (!stopped && version === generation) await options.write(snapshot)
    }).catch(error => options.onError?.(error))
    return writes
  }
  const run = async () => {
    while (!stopped) {
      const version = generation
      let readings: ProviderUsage[]
      let error: string | undefined
      try {
        readings = await options.load()
      } catch {
        error = "Unable to refresh usage"
        readings = (latest.providers ?? []).map(provider => ({ ...provider, error, windows: undefined }))
      }
      if (stopped) break
      // A credential update invalidates both the previous readings and this in-flight result.
      if (version !== generation) continue
      const attemptedAt = now()
      latest = {
        providers: mergeReadings(latest.providers ?? [], readings, attemptedAt),
        ...(error ? { error } : {}),
        updatedAt: attemptedAt,
      }
      await persist(latest)
      if (version === generation) break
    }
    return latest
  }
  const refresh = () => {
    if (stopped) return Promise.resolve(latest)
    if (pending) return pending
    pending = run().finally(() => { pending = undefined })
    return pending
  }
  return {
    get: () => latest,
    refresh,
    invalidate: () => {
      generation++
      latest = { error: "Credentials changed; refreshing usage" }
      void persist(latest)
      return refresh()
    },
    stop: () => { stopped = true; generation++ },
  }
}

export type UsageWindow = {
  label?: string
  usedPercent: number
  durationSeconds?: number
  resetsAt: number
  summary?: boolean
}

export type ProviderUsage = {
  name: string
  account?: string
  id?: string
  integrationID?: string
  windows?: UsageWindow[]
  error?: string
  stale?: boolean
  lastSuccessAt?: string
  lastAttemptAt?: string
  summaryPace?: "window" | "worst"
}

export type UsageCache = {
  providers?: ProviderUsage[]
  error?: string
  updatedAt?: string
}

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
  windows?: UsageWindow[]
  error?: string
  summaryPace?: "window" | "worst"
}

export type UsageCache = {
  providers?: ProviderUsage[]
  error?: string
  updatedAt?: string
}

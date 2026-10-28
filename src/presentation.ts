import type { ProviderUsage, UsageWindow } from "./types"

export const clamp = (value: number) => Math.max(0, Math.min(100, value))
export const remaining = (window: UsageWindow) => 100 - clamp(window.usedPercent)

export function elapsedPercent(window: UsageWindow, now = Date.now()) {
  if (!window.durationSeconds || window.durationSeconds < 0) return undefined
  return clamp(100 - ((window.resetsAt * 1000 - now) / (window.durationSeconds * 1000)) * 100)
}

export function paceColor(window: UsageWindow, now = Date.now()) {
  const used = clamp(window.usedPercent)
  if (used >= 100) return "#ef5350"
  const elapsed = elapsedPercent(window, now)
  if (elapsed === undefined) return "#f5c542"
  const ahead = used - elapsed
  if (ahead <= -5) return "#4caf50"
  const mix = (from: number[], to: number[], amount: number) =>
    `rgb(${from.map((value, index) => Math.round(value + (to[index]! - value) * amount)).join(", ")})`
  if (ahead <= 20) return mix([76, 175, 80], [245, 197, 66], (ahead + 5) / 25)
  if (ahead <= 30) return mix([245, 197, 66], [239, 83, 80], (ahead - 20) / 10)
  return "#ef5350"
}

export function label(seconds: number) {
  if (seconds === 604800) return "Weekly"
  if (seconds > 0 && seconds % 3600 === 0) return `${seconds / 3600}h`
  return "Limit"
}

export function formatRemaining(timestamp: number, now = Date.now()) {
  const minutes = Math.max(0, Math.ceil((timestamp * 1000 - now) / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor(minutes / 60) % 24
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  return `${minutes}m`
}

export function resetCountdown(window: UsageWindow, now = Date.now()) {
  if (window.resetsAt * 1000 <= now) return "Reset due"
  if (window.resetsAt * 1000 - now < 60_000) return "Resets shortly"
  return formatRemaining(window.resetsAt, now)
}

export function paceDescription(window: UsageWindow, now = Date.now()) {
  if (window.resetsAt * 1000 <= now) return "Reset time reached; awaiting updated usage."
  const elapsed = elapsedPercent(window, now)
  if (elapsed === undefined) return "Pace unavailable: window duration is unknown."
  const ahead = clamp(window.usedPercent) - elapsed
  if (ahead > 5) return "Ahead of even pace: using quota faster than the window elapses."
  if (ahead < -5) return "Under even pace: more quota left than time left in the window."
  return "On even pace with the window."
}

export function formatUsageTime(timestamp: number | string, hour12: boolean, withDate = false, locale?: string) {
  return new Intl.DateTimeFormat(locale, {
    ...(withDate ? { month: "short", day: "numeric" } as const : {}),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: hour12 ? "h12" : "h23",
  }).format(new Date(timestamp))
}

export function providerSummary(provider: ProviderUsage, now = Date.now()) {
  const window = provider.windows?.find(window => window.summary)
  if (!window) return undefined
  const ahead = (window: UsageWindow) => {
    const elapsed = elapsedPercent(window, now)
    return elapsed === undefined ? Number.NEGATIVE_INFINITY : clamp(window.usedPercent) - elapsed
  }
  const pace = provider.summaryPace === "worst"
    ? provider.windows!.reduce((worst, next) => ahead(next) > ahead(worst) ? next : worst)
    : window
  return { remaining: Math.round(remaining(window)), color: paceColor(pace, now), label: window.label ?? label(window.durationSeconds ?? 0) }
}

export function windowDescription(window: UsageWindow, now = Date.now(), hour12 = false) {
  const elapsed = elapsedPercent(window, now)
  const time = elapsed === undefined ? "" : ` ${Math.round(100 - elapsed)}% of the window remains. The line marks even spending, not a burn-rate forecast.`
  return `${Math.round(remaining(window))}% quota left.${time} ${paceDescription(window, now)} Resets ${formatUsageTime(window.resetsAt * 1000, hour12, true)}.`
}

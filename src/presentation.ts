import type { UsageWindow } from "./types"

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

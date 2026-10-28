import { describe, expect, test } from "bun:test"
import { elapsedPercent, formatRemaining, formatUsageTime, label, paceColor, providerSummary, remaining, resetCountdown, paceDescription, windowDescription } from "./presentation"
import { usageSchema } from "./rpc"

const now = 1_800_000_000_000
const window = { usedPercent: 25, durationSeconds: 3600, resetsAt: now / 1000 + 1800 }

describe("desktop usage presentation", () => {
  test("remaining usage is clamped", () => {
    expect(remaining(window)).toBe(75)
    expect(remaining({ ...window, usedPercent: 120 })).toBe(0)
    expect(remaining({ ...window, usedPercent: -10 })).toBe(100)
  })
  test("time marker handles expired and unknown windows", () => {
    expect(elapsedPercent(window, now)).toBe(50)
    expect(elapsedPercent({ ...window, resetsAt: 1 }, now)).toBe(100)
    expect(elapsedPercent({ ...window, durationSeconds: undefined }, now)).toBeUndefined()
  })
  test("pace colors match terminal thresholds", () => {
    expect(paceColor(window, now)).toBe("#4caf50")
    expect(paceColor({ ...window, usedPercent: 100 }, now)).toBe("#ef5350")
    expect(paceColor({ ...window, durationSeconds: undefined }, now)).toBe("#f5c542")
    expect(paceColor({ ...window, usedPercent: 80 }, now)).toBe("rgb(239, 83, 80)")
  })
  test("reset countdowns and labels", () => {
    expect(formatRemaining(window.resetsAt, now)).toBe("30m")
    expect(formatRemaining(1, now)).toBe("0m")
    expect(formatRemaining(now / 1000 + 90000, now)).toBe("1d 1h")
    expect(label(604800)).toBe("Weekly")
    expect(label(18000)).toBe("5h")
  })
  test("RPC accepts provider errors and multiple accounts without credentials", () => {
    const data = usageSchema.parse({ providers: [
      { name: "Codex", id: "one", account: "Work", windows: [window], token: "must not cross RPC" },
      { name: "Codex", id: "two", error: "Authentication failed" },
    ] })
    expect(data.providers).toHaveLength(2)
    expect(data.providers![0]).not.toHaveProperty("token")
    expect(() => usageSchema.parse({ providers: [{ name: "Codex", windows: [{ usedPercent: "bad" }] }] })).toThrow()
  })
  test("tooltips distinguish even pace from a forecast and explain missing clocks", () => {
    expect(windowDescription(window, now)).toContain("75% quota left")
    expect(windowDescription(window, now)).toContain("not a burn-rate forecast")
    expect(paceDescription(window, now)).toStartWith("Under even pace")
    expect(paceDescription({ ...window, usedPercent: 50 }, now)).toStartWith("On even pace")
    expect(paceDescription({ ...window, usedPercent: 80 }, now)).toStartWith("Ahead of even pace")
    expect(paceDescription({ ...window, durationSeconds: undefined }, now)).toContain("unavailable")
    expect(paceDescription({ ...window, resetsAt: 1 }, now)).toContain("awaiting updated usage")
  })
  test("expired readings are not presented as a new allowance", () => {
    expect(resetCountdown({ ...window, resetsAt: 1 }, now)).toBe("Reset due")
    expect(resetCountdown({ ...window, resetsAt: now / 1000 + 20 }, now)).toBe("Resets shortly")
    expect(resetCountdown(window, now)).toBe("30m")
    expect(remaining({ ...window, resetsAt: 1, usedPercent: 100 })).toBe(0)
  })
  test("RPC preserves explicit freshness metadata", () => {
    expect(usageSchema.parse({ providers: [{ name: "Codex", stale: true, lastSuccessAt: "old", lastAttemptAt: "new", error: "503" }] }).providers![0])
      .toMatchObject({ stale: true, lastSuccessAt: "old", lastAttemptAt: "new", error: "503" })
  })
  test("12-hour and 24-hour preferences apply to timestamps and reset dates", () => {
    const afternoon = new Date(2026, 9, 28, 13, 5).getTime()
    expect(formatUsageTime(afternoon, false, false, "en-US")).toBe("13:05")
    expect(formatUsageTime(afternoon, true, false, "en-US")).toBe("01:05 PM")
    expect(formatUsageTime(new Date(2026, 9, 28, 0, 5).getTime(), false, false, "en-US")).toBe("00:05")
    expect(formatUsageTime(afternoon, false, true, "en-US")).toContain("13:05")
    expect(formatUsageTime(afternoon, true, true, "en-US")).toContain("01:05 PM")
    expect(formatUsageTime(new Date(afternoon).toISOString(), false, false, "en-US")).toBe("13:05")
  })
  test("collapsed summaries use the provider-designated window, not the first window", () => {
    const summary = { ...window, summary: true, usedPercent: 60, label: "Weekly" }
    const result = providerSummary({ name: "Codex", windows: [window, summary] }, now)
    expect(result).toEqual({ remaining: 40, color: paceColor(summary, now), label: "Weekly" })
    expect(providerSummary({ name: "Codex", error: "Unavailable" }, now)).toBeUndefined()
    expect(providerSummary({ name: "Codex", windows: [window] }, now)).toBeUndefined()
  })
  test("worst-window summary colors do not change the summary percentage", () => {
    const result = providerSummary({ name: "Go", summaryPace: "worst", windows: [
      { ...window, summary: true, label: "Rolling" },
      { ...window, usedPercent: 100, label: "Weekly" },
    ] }, now)
    expect(result).toEqual({ remaining: 75, color: "#ef5350", label: "Rolling" })
  })
})

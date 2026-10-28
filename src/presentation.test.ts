import { describe, expect, test } from "bun:test"
import { elapsedPercent, formatRemaining, label, paceColor, remaining } from "./presentation"
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
})

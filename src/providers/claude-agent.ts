import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type { UsageWindow } from "../types"
import { UsageDeferred, type UsageProvider } from "./types"

const login = "Run claude auth login on the OpenCode server"
const execute = promisify(execFile)

type Credentials = { accessToken: string; expiresAt: number }
type UsageState = {
  accessToken: string
  windows?: UsageWindow[]
  pending?: Promise<UsageWindow[]>
  nextRequestAt: number
  rateLimits: number
}

const cacheDuration = 10 * 60 * 1000
const retryDelay = 15 * 60 * 1000

export async function readClaudeCredentials(): Promise<Credentials> {
  let contents: string
  try {
    if (process.platform === "darwin" && !process.env.CLAUDE_CONFIG_DIR) {
      contents = (await execute("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], { timeout: 5_000 })).stdout
    } else {
      contents = await readFile(join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), ".credentials.json"), "utf8")
    }
    const credentials = JSON.parse(contents)?.claudeAiOauth
    if (typeof credentials?.accessToken !== "string" || !credentials.accessToken ||
      typeof credentials.expiresAt !== "number" || !Number.isFinite(credentials.expiresAt)) throw new Error()
    return { accessToken: credentials.accessToken, expiresAt: credentials.expiresAt }
  } catch {
    // File, JSON, and Keychain errors can contain private credential data.
    throw new Error(`Cannot read Claude Code subscription credentials. ${login}`)
  }
}

export function claudeWindows(payload: unknown): UsageWindow[] {
  if (!payload || typeof payload !== "object") throw new Error("Invalid Claude usage response")
  const fields: Array<[string, string, number, boolean]> = [
    ["five_hour", "Session", 5 * 60 * 60, false],
    ["seven_day", "Weekly", 7 * 24 * 60 * 60, true],
    ["seven_day_opus", "Weekly Opus", 7 * 24 * 60 * 60, false],
    ["seven_day_sonnet", "Weekly Sonnet", 7 * 24 * 60 * 60, false],
    ["seven_day_oauth_apps", "Weekly OAuth apps", 7 * 24 * 60 * 60, false],
  ]
  const windows = fields.flatMap(([key, label, durationSeconds, summary]) => {
    const window = (payload as Record<string, unknown>)[key]
    if (!window || typeof window !== "object") return []
    const { utilization, resets_at } = window as Record<string, unknown>
    const resetsAt = typeof resets_at === "string" ? Date.parse(resets_at) / 1000 : NaN
    if (typeof utilization !== "number" || !Number.isFinite(utilization) || utilization < 0 || !Number.isFinite(resetsAt) || resetsAt <= 0) return []
    return [{ label, usedPercent: utilization, durationSeconds, resetsAt, summary }]
  })
  if (windows.length === 0) throw new Error("No supported Claude usage windows returned")
  return windows
}

export function createClaudeAgent(dependencies: {
  readCredentials?: () => Promise<Credentials>
  request?: (url: string, options: RequestInit) => Promise<Response>
  now?: () => number
} = {}): UsageProvider {
  const now = dependencies.now ?? Date.now
  // All external connections use the same local Claude Code login. Share reads
  // across connections and source discovery, but discard them when tokens change.
  let state: UsageState | undefined
  const readUsage = async () => {
    const credentials = await (dependencies.readCredentials ?? readClaudeCredentials)()
    if (credentials.expiresAt <= now()) throw new Error("Claude Code login expired. Run claude to refresh it on the OpenCode server")
    if (!state || state.accessToken !== credentials.accessToken) {
      state = { accessToken: credentials.accessToken, nextRequestAt: 0, rateLimits: 0 }
    }
    const current = state
    if (current.pending) return current.pending
    if (now() < current.nextRequestAt) {
      if (current.rateLimits) throw new UsageDeferred()
      if (current.windows) return current.windows
    }
    const request = async () => {
      const response = await (dependencies.request ?? fetch)("https://api.anthropic.com/api/oauth/usage", {
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          Accept: "application/json",
          "User-Agent": "opencode-usage-bars/1",
        },
        signal: AbortSignal.timeout(10_000),
      })
      if (response.status === 429) {
        current.rateLimits++
        const retry = response.headers.get("retry-after")
        const retryAt = retry === null ? NaN : /^\d+(\.\d+)?$/.test(retry.trim()) ? now() + Number(retry) * 1000 : Date.parse(retry)
        const backoff = retryDelay * 2 ** Math.min(current.rateLimits - 1, 3)
        current.nextRequestAt = Math.max(now() + backoff, Number.isFinite(retryAt) ? retryAt : 0)
        throw new UsageDeferred()
      }
      if (response.status === 401) throw new Error(`Claude Code login was rejected. ${login}`)
      if (!response.ok) throw new Error(`Usage request failed: ${response.status}`)
      let payload: unknown
      try { payload = await response.json() } catch { throw new Error("Invalid Claude usage response") }
      current.windows = claudeWindows(payload)
      current.rateLimits = 0
      current.nextRequestAt = now() + cacheDuration
      return current.windows
    }
    current.pending = request()
    try { return await current.pending } finally { current.pending = undefined }
  }
  return {
    name: "Claude Agent",
    async sources(context) {
      const integration = await context.integration.get({ integrationID: "claude-agent" })
      const accounts = (integration.data?.connections ?? [])
        .filter(connection => connection.type === "credential")
        .filter(connection => connection.method === "external")
      if (accounts.length === 0) throw new Error(`Connect Claude Agent with Claude Code login. ${login}`)

      return accounts.map(connection => ({
        account: connection.label,
        id: connection.id,
        integrationID: "claude-agent",
        fetch: readUsage,
      }))
    },
  }
}

export const claudeAgent = createClaudeAgent()

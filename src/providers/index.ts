import { codex } from "./codex"
import { opencodeGo } from "./opencode-go"
import type { UsageProvider } from "./types"

export const providers: UsageProvider[] = [codex, opencodeGo]
export { loadProvider } from "./types"

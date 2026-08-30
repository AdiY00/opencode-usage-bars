import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { cacheFile } from "./paths"
import type { UsageCache } from "./types"

export async function writeCache(value: UsageCache) {
  await mkdir(dirname(cacheFile), { recursive: true })
  await Bun.write(cacheFile, JSON.stringify(value))
}

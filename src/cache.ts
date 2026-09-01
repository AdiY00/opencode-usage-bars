import { randomUUID } from "node:crypto"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { cacheFile } from "./paths"
import type { UsageCache } from "./types"

export async function writeCache(value: UsageCache) {
  await mkdir(dirname(cacheFile), { recursive: true })
  const temporary = `${cacheFile}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value))
    await rename(temporary, cacheFile)
  } finally {
    await rm(temporary, { force: true })
  }
}

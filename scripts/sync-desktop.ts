import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { watch } from "node:fs"
import { resolve, join } from "node:path"

const args = process.argv.slice(2)
const destination = args.find(arg => arg !== "--watch")
if (!destination) throw new Error("Usage: bun run sync:desktop <destination-directory> [--watch]")
const directory = resolve(destination)
const source = new URL("../dist/gui-experimental.cjs", import.meta.url)
const manifest = {
  name: "opencode-usage-bars-desktop-local",
  version: "0.0.0",
  private: true,
  exports: { "./gui-experimental": "./gui-experimental.cjs" },
}

await mkdir(directory, { recursive: true })
const existing = await readFile(join(directory, "package.json"), "utf8").catch(() => undefined)
if (existing && JSON.parse(existing).name !== manifest.name) {
  throw new Error(`Refusing to overwrite an unrelated package in ${directory}`)
}
await writeFile(join(directory, "package.json"), JSON.stringify(manifest, null, 2) + "\n")

async function sync() {
  const code = await readFile(source, "utf8")
  // Don't replace the last working bundle with a partially written build.
  new Function("require", "exports", "module", code)
  const temporary = join(directory, "gui-experimental.cjs.tmp")
  await writeFile(temporary, code)
  await rename(temporary, join(directory, "gui-experimental.cjs"))
  console.log(`Synced desktop GUI to ${directory}`)
}

await sync()
if (args.includes("--watch")) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let queue = Promise.resolve()
  watch(new URL("../dist/", import.meta.url), (_event, file) => {
    if (file !== "gui-experimental.cjs") return
    clearTimeout(timer)
    timer = setTimeout(() => {
      queue = queue.then(sync).catch(error => console.error("Desktop sync failed:", error))
    }, 200)
  })
  console.log("Watching GUI builds; run bun run dev:gui in another terminal.")
}

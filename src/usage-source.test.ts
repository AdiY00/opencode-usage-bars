import { expect, test } from "bun:test"
import { usageSource } from "./usage-source"

test("desktop is only the fallback when there is no session", () => {
  const desktop = { id: "windows" }
  expect(usageSource(desktop)).toEqual({ client: desktop, location: undefined, name: "Desktop server" })
})

test("WSL sessions use their own client and location, not the Windows host", () => {
  const desktop = { id: "windows" }
  const wsl = { id: "wsl" }
  const location = { directory: "/home/adiy/project" }
  expect(usageSource(desktop, { server: { client: wsl, name: "WSL" }, location }))
    .toEqual({ client: wsl, location, name: "WSL" })
})

test("an unresolved remote location must not fall back to Windows usage", () => {
  expect(usageSource({ id: "windows" }, {
    server: { client: { id: "wsl" }, name: "WSL" }, location: undefined,
  })).toBeUndefined()
})

test("switching projects and servers selects fresh routing information", () => {
  const desktop = { id: "windows" }
  const server = { client: { id: "wsl" }, name: "WSL" }
  const first = usageSource(desktop, { server, location: { directory: "/one" } })
  const next = usageSource(desktop, { server, location: { directory: "/two" } })
  const other = usageSource(desktop, { server: { client: { id: "remote" }, name: "Remote" }, location: { directory: "/one" } })
  expect(first?.location?.directory).not.toBe(next?.location?.directory)
  expect(other?.client).not.toBe(first?.client)
})

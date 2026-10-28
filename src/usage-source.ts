import type { SessionRef } from "@opencode/plugin/gui"

type Session<Client> = {
  server: { client: Client; name: string }
  location: SessionRef["location"]
}

// The desktop host loads the GUI, but usage belongs to the session's server and location.
export function usageSource<Client>(desktop: Client, session?: Session<Client>) {
  if (session && !session.location) return undefined
  return {
    client: session ? session.server.client : desktop,
    location: session?.location,
    name: session ? session.server.name : "Desktop server",
  }
}

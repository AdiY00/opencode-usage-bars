# opencode-usage-bars

Pace-aware Codex and OpenCode Go usage bars for the OpenCode TUI sidebar.

The filled bar shows remaining usage. The `|` marker shows how much time remains in the limit window. Bar color compares usage with elapsed time: green is safely on pace, yellow is ahead of pace, and red is substantially ahead or exhausted.

## Features

- Codex 5-hour and weekly limits
- Multiple Codex accounts with their stored OpenCode account labels
- OpenCode Go rolling, weekly, and monthly limits
- Pace-aware green-to-yellow-to-red color gradient
- Collapsible account summaries colored by their worst limit
- Reset timestamps with fixed-width day and time fields

The reset indicator uses a Nerd Font icon. Install a Nerd Font in your terminal for the intended appearance.

## Installation

Once published, install both the server and TUI entry points with one command:

```sh
opencode plugin opencode-usage-bars --global
```

The server entry point resolves connected credentials and fetches usage. The TUI entry point renders the sidebar. OpenCode detects the package's `./server` and `./tui` exports and configures both.

Codex requires an OpenAI connection using ChatGPT OAuth. OpenCode Go requires an OpenCode Go API key connection.

## Development

```sh
bun install
bun run check
```

For local development, reference `src/index.ts` as a server plugin and `src/tui.tsx` as a CLI plugin. Both processes share usage data through `$XDG_CACHE_HOME/opencode/usage-bars.json`, or `~/.cache/opencode/usage-bars.json` when `XDG_CACHE_HOME` is unset.

## Limitations

The server and TUI must run on the same machine because the usage cache is local. Remote-server TUI connections are not currently supported.

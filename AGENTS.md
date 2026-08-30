# Agent Instructions

## Adding A Provider

Use `src/providers/types.ts` as the provider contract and the existing files in `src/providers/` as examples.

1. Add the provider implementation to `src/providers/`.
2. Map its usage response to the shared types in `src/types.ts`, including the summary window metadata used by the TUI.
3. Register it in `src/providers/index.ts`.
4. Keep provider-specific authentication, requests, and response parsing inside its implementation; keep `src/index.ts` and `src/tui.tsx` provider-agnostic.
5. Run `bun run check`. The provider is complete when authentication failures are shown for that provider and valid usage renders without affecting the others.

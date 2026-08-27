/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode-ai/plugin/tui"
import { RGBA, parseColor, type ColorInput } from "@opentui/core"
import { For, Show, createSignal, onCleanup } from "solid-js"
import { readFileSync } from "node:fs"

const cacheFile = `${process.env.XDG_CACHE_HOME ?? `${process.env.HOME}/.cache`}/opencode/usage-bars.json`

type Limits = {
  providers?: Array<{
    name: string
    account?: string
    id?: string
    windows?: Array<{ label?: string; usedPercent: number; durationSeconds?: number; resetsAt: number }>
    error?: string
  }>
  error?: string
}

type Provider = NonNullable<Limits["providers"]>[number]
type UsageWindow = NonNullable<Provider["windows"]>[number]
type CollapseState = { open: Record<string, boolean> }

function ProviderView(props: {
  context: Plugin.Context
  provider: Provider
  showAccount: boolean
  open: boolean
  toggle: () => void
}) {
  const summaryWindow = () => props.provider.windows?.find((item) =>
      props.provider.name === "Codex"
        ? item.label === "Weekly" || item.durationSeconds === 7 * 24 * 60 * 60
        : item.label === "Rolling",
    )
  const summary = () => {
    const window = summaryWindow()
    return window ? `${Math.round(100 - Math.max(0, Math.min(100, window.usedPercent)))}%` : undefined
  }
  const summaryColor = () => {
    if (props.provider.name === "Codex") return windowPaceColor(summaryWindow())

    const worst = props.provider.windows?.reduce<UsageWindow | undefined>(
      (result, window) => paceAhead(window) > paceAhead(result) ? window : result,
      undefined,
    )
    return windowPaceColor(worst)
  }

  return (
    <box>
      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="row">
          <text fg={props.context.theme.text.default}>{props.provider.name}</text>
          <Show when={props.showAccount && props.provider.account}>
            <text fg={props.context.theme.text.subdued} attributes={0}> ({props.provider.account})</text>
          </Show>
        </box>
        <box flexDirection="row" gap={1}>
          <Show when={!props.open && summary()}>
            <text fg={summaryColor() ?? props.context.theme.text.subdued} selectable={false}>{summary()}</text>
          </Show>
          <text
            fg={props.context.theme.text.default}
            selectable={false}
            onMouseDown={props.toggle}
          >
            {props.open ? "▼" : "▶"}
          </text>
        </box>
      </box>
      <Show when={props.open}>
        <Show when={props.provider.windows?.length} fallback={
          <text fg={props.context.theme.text.subdued}>{props.provider.error ?? "No usage data"}</text>
        }>
          <For each={props.provider.windows}>
            {(window) => {
              const used = () => clamp(window.usedPercent, 0, 100)
              const remaining = () => 100 - used()
              const elapsed = () => elapsedPercent(window)
              const timeRemaining = () => {
                const value = elapsed()
                return value === undefined ? undefined : 100 - value
              }
              return (
                <box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={props.context.theme.text.subdued}>{window.label ?? label(window.durationSeconds ?? 0)}</text>
                    <text fg={props.context.theme.text.default}><b>{Math.round(remaining())}%</b></text>
                  </box>
                  <box
                    width="100%"
                    height={1}
                    position="relative"
                    backgroundColor={tint(
                      props.context.theme.background.default,
                      props.context.theme.text.default,
                      0.12,
                    )}
                  >
                    <Show when={remaining() > 0}>
                      <box
                        width={`${remaining()}%` as `${number}%`}
                        height={1}
                        backgroundColor={paceColor(used(), elapsed())}
                      />
                    </Show>
                    <Show when={timeRemaining() !== undefined}>
                      <text
                        position="absolute"
                        left={`${Math.min(timeRemaining() ?? 0, 99)}%` as `${number}%`}
                        fg={remaining() > 0 && (timeRemaining() ?? 0) < remaining() ? "#000000" : "#ffffff"}
                        selectable={false}
                      >|</text>
                    </Show>
                  </box>
                  <box flexDirection="row" justifyContent="flex-end">
                    <text fg={props.context.theme.text.subdued}>󱛡 {formatReset(window.resetsAt)}</text>
                  </box>
                </box>
              )
            }}
          </For>
        </Show>
      </Show>
    </box>
  )
}

function View(props: { context: Plugin.Context }) {
  const [limits, setLimits] = createSignal<Limits>(readLimits())
  const [collapse, setCollapse] = props.context.storage.store<CollapseState>("usage-bars-collapse", {
    initial: { open: {} },
  })
  const refresh = () => setLimits(readLimits())

  refresh()
  const timer = setInterval(refresh, 30_000)
  onCleanup(() => clearInterval(timer))

  return (
    <box>
      <text fg={props.context.theme.text.default}><b>Usage limits</b></text>
      <Show
        when={limits()?.providers?.length}
        fallback={<text fg={props.context.theme.text.subdued}>{limits()?.error ?? "Loading..."}</text>}
      >
        <For each={limits()?.providers}>
          {(provider) => {
            const key = provider.id ?? provider.name
            const showAccount = () => (limits()?.providers?.filter((item) => item.name === provider.name).length ?? 0) > 1
            return <ProviderView
              context={props.context}
              provider={provider}
              showAccount={showAccount()}
              open={collapse.open[key] ?? true}
              toggle={() => void setCollapse((state) => {
                state.open[key] = !(state.open[key] ?? true)
              })}
            />
          }}
        </For>
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "usage-bars-tui",
  setup(context) {
    context.ui.slot({
      replace: "sidebar.footer",
      render: () => <View context={context} />,
    })
  },
})

function label(seconds: number) {
  if (seconds === 7 * 24 * 60 * 60) return "Weekly"
  if (seconds > 0 && seconds % 3600 === 0) return `${seconds / 3600}h`
  return "Limit"
}

function readLimits(): Limits {
  try {
    return JSON.parse(readFileSync(cacheFile, "utf8")) as Limits
  } catch {
    return { error: "Waiting for usage data" }
  }
}

function tint(base: ColorInput, overlay: ColorInput, alpha: number) {
  const background = parseColor(base)
  const foreground = parseColor(overlay)
  return RGBA.fromInts(
    Math.round((background.r + (foreground.r - background.r) * alpha) * 255),
    Math.round((background.g + (foreground.g - background.g) * alpha) * 255),
    Math.round((background.b + (foreground.b - background.b) * alpha) * 255),
  )
}

function elapsedPercent(window: UsageWindow) {
  if (!window.durationSeconds) return undefined
  return clamp(100 - ((window.resetsAt * 1000 - Date.now()) / (window.durationSeconds * 1000)) * 100, 0, 100)
}

function paceAhead(window?: UsageWindow) {
  if (!window) return Number.NEGATIVE_INFINITY
  const elapsed = elapsedPercent(window)
  return elapsed === undefined ? Number.NEGATIVE_INFINITY : clamp(window.usedPercent, 0, 100) - elapsed
}

function windowPaceColor(window?: UsageWindow) {
  if (!window) return undefined
  return paceColor(clamp(window.usedPercent, 0, 100), elapsedPercent(window))
}

function paceColor(usedPercent: number, elapsedPercent?: number) {
  if (usedPercent >= 100) return RGBA.fromHex("#ef5350")
  if (elapsedPercent === undefined) return RGBA.fromHex("#f5c542")

  const ahead = usedPercent - elapsedPercent
  if (ahead <= -5) return RGBA.fromHex("#4caf50")
  if (ahead <= 20) return mix("#4caf50", "#f5c542", (ahead + 5) / 25)
  if (ahead <= 30) return mix("#f5c542", "#ef5350", (ahead - 20) / 10)
  return RGBA.fromHex("#ef5350")
}

function mix(from: ColorInput, to: ColorInput, amount: number) {
  const start = parseColor(from)
  const end = parseColor(to)
  return RGBA.fromInts(
    Math.round((start.r + (end.r - start.r) * amount) * 255),
    Math.round((start.g + (end.g - start.g) * amount) * 255),
    Math.round((start.b + (end.b - start.b) * amount) * 255),
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function formatReset(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp * 1000))
}

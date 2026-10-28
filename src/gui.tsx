/** @jsxImportSource solid-js */
import { Command, MenuItem, Panel, Plugin, SettingsPage, Style, createKeyed, usePlugin, type PanelTab, type SessionRef } from "@opencode/plugin/gui"
import { For, Show, createSignal, onCleanup } from "solid-js"
import { Usage } from "./rpc"
import type { UsageCache, UsageWindow } from "./types"
import { elapsedPercent, formatRemaining, label, paceColor, remaining } from "./presentation"
import { usageSource } from "./usage-source"

function WindowBar(props: { window: UsageWindow; now: number }) {
  const [date, setDate] = createSignal(false)
  const timeRemaining = () => {
    const elapsed = elapsedPercent(props.window, props.now)
    return elapsed === undefined ? undefined : 100 - elapsed
  }
  return <div class="usage-bars-window">
    <div class="usage-bars-row"><span>{props.window.label ?? label(props.window.durationSeconds ?? 0)}</span><strong>{Math.round(remaining(props.window))}%</strong></div>
    <div class="usage-bars-track" role="meter" aria-label={`${props.window.label ?? "Usage"} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining(props.window)}>
      <div class="usage-bars-fill" style={{ width: `${remaining(props.window)}%`, background: paceColor(props.window, props.now) }} />
      <Show when={timeRemaining() !== undefined}><span class="usage-bars-marker" style={{ left: `${Math.min(timeRemaining() ?? 0, 99)}%` }} /></Show>
    </div>
    <button class="usage-bars-reset" onClick={() => setDate(!date())} title="Toggle reset date and countdown">
      {date() ? `Resets ${new Date(props.window.resetsAt * 1000).toLocaleString()}` : `Resets in ${formatRemaining(props.window.resetsAt, props.now)}`}
    </button>
  </div>
}

function UsageView(props: { session?: SessionRef }) {
  const ctx = usePlugin()
  const [usage, setUsage] = createSignal<UsageCache>({ error: "Loading usage…" })
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())
  const [sourceName, setSourceName] = createSignal("")
  let refresh = () => {}
  createKeyed(() => usageSource(ctx.client, props.session ?? ctx.sessions.current()), source => {
    const controller = new AbortController()
    let pending = false
    setSourceName(source.name)
    setUsage({ error: "Loading usage…" })
    setError(undefined)
    const load = async () => {
      if (pending) return
      pending = true
      setBusy(true)
      try {
        const result = await source.client.rpc(Usage).get({}, { location: source.location, signal: controller.signal })
        if (!controller.signal.aborted) { setUsage(result); setError(undefined) }
      } catch {
        if (!controller.signal.aborted) setError("Unable to read usage. Check that usage-bars is installed on this session's server. Retrying automatically.")
      } finally {
        pending = false
        if (!controller.signal.aborted) setBusy(false)
      }
    }
    refresh = () => void load()
    refresh()
    const timer = setInterval(() => { setNow(Date.now()); refresh() }, 30_000)
    onCleanup(() => { controller.abort(); clearInterval(timer) })
  }, {
    equals: (previous, next) => previous.client === next.client
      && previous.location?.directory === next.location?.directory && previous.name === next.name,
    otherwise: () => {
      refresh = () => {}
      setBusy(false)
      setSourceName("")
      setUsage({ error: "Waiting for the session's server connection…" })
      setError(undefined)
    },
  })
  return <section class="usage-bars-view" aria-label="Usage limits">
    <div class="usage-bars-row">
      <div class="usage-bars-heading"><h2>Usage limits</h2><Show when={sourceName()}><span class="usage-bars-source">{sourceName()}</span></Show></div>
      <button disabled={busy()} onClick={() => void refresh()}>{busy() ? "Loading…" : "Refresh"}</button>
    </div>
    <Show when={error()}><p role="status">{error()}</p></Show>
    <Show when={usage().providers?.length} fallback={<p>{usage().error ?? "No connected usage providers"}</p>}>
      <For each={usage().providers}>{provider => <details open class="usage-bars-provider">
        <summary><strong>{provider.name}</strong><Show when={provider.account}> <span>({provider.account})</span></Show></summary>
        <Show when={provider.windows?.length} fallback={<p>{provider.error ?? "No usage data"}</p>}>
          <For each={provider.windows}>{window => <WindowBar window={window} now={now()} />}</For>
        </Show>
      </details>}</For>
    </Show>
    <Show when={usage().updatedAt}><p class="usage-bars-updated" title="Providers refresh every minute">Updated {new Date(usage().updatedAt!).toLocaleTimeString()}</p></Show>
  </section>
}

export default Plugin.define({
  setup(ctx) {
    ctx.add(Style, `
      .usage-bars-view { padding: 10px 12px; overflow: auto; height: 100%; color: inherit; font-size: 12px; line-height: 1.4; }
      .usage-bars-view h2 { margin: 0; font-size: 13px; font-weight: 600; }
      .usage-bars-view p { margin: 4px 0 0; }
      .usage-bars-heading { display: flex; align-items: baseline; flex-wrap: wrap; column-gap: 8px; }
      .usage-bars-source { font-size: 11px; }
      .usage-bars-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .usage-bars-view button { cursor: pointer; font: inherit; }
      .usage-bars-view button:disabled { opacity: .5; cursor: wait; }
      .usage-bars-provider { margin-top: 12px; }
      .usage-bars-provider summary { cursor: pointer; }
      .usage-bars-provider summary span, .usage-bars-reset, .usage-bars-updated, .usage-bars-source { opacity: .65; }
      .usage-bars-window { margin-top: 6px; }
      .usage-bars-track { position: relative; height: 6px; margin-top: 4px; border-radius: 3px; background: color-mix(in srgb, currentColor 12%, transparent); overflow: hidden; }
      .usage-bars-fill { height: 100%; }
      .usage-bars-marker { position: absolute; top: 0; bottom: 0; width: 2px; background: white; box-shadow: 0 0 0 1px #0008; }
      .usage-bars-reset { display: block; margin: 3px 0 0 auto; font-size: 11px !important; text-align: right; }
      .usage-bars-view .usage-bars-updated { margin-top: 12px; font-size: 11px; }
    `)
    const tab: PanelTab = { id: "limits", title: "Usage limits", closable: "compact", fallback: true }
    ctx.add(Panel, {
      id: "limits", region: "side",
      list: input => input.open.includes(tab.id) ? [tab] : [],
      render: props => <UsageView session={props.session} />,
    })
    const open = () => {
      const session = ctx.sessions.current()
      if (session) ctx.layout.open(`${ctx.id}:limits`, session)
      else ctx.layout.settings("usage-limits")
    }
    ctx.add(Command, { id: "open", title: "Open usage limits", keywords: "quota remaining codex go", run: open })
    ctx.add(MenuItem, (): MenuItem => ({ menu: "session.panel", id: "limits", title: "Usage limits", opened: !!ctx.sessions.current() && ctx.layout.state(`${ctx.id}:limits`, ctx.sessions.current()!) !== "closed", run: open }))
    ctx.add(SettingsPage, { id: "usage-limits", title: "Usage limits", render: () => <UsageView /> })
  },
})

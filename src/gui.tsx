/** @jsxImportSource solid-js */
import { Command, MenuItem, Panel, Plugin, SettingsPage, Store, Style, createKeyed, usePlugin, type PanelTab, type SessionRef } from "@opencode/plugin/gui"
import { Schema } from "effect"
import { For, Show, createSignal, createUniqueId, onCleanup, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Usage } from "./rpc"
import type { UsageCache, UsageWindow } from "./types"
import { elapsedPercent, formatUsageTime, label, paceColor, providerSummary, remaining, resetCountdown, windowDescription } from "./presentation"
import { usageSource } from "./usage-source"

const definition = Plugin.define({
  stores: {
    display: Store.global(Schema.Struct({ hour12: Schema.Boolean, showResetDate: Schema.Boolean }), {
      hour12: false,
      showResetDate: false,
    }),
  },
})

function UsageIcon(props: { kind: "hourglass" | "calendar" | "refresh" }) {
  const paths = {
    hourglass: "M4 2h8M4 14h8M5 2v3l3 3-3 3v3M11 2v3L8 8l3 3v3",
    calendar: "M5 1v4M11 1v4M2 7h12M3 3h10a1 1 0 0 1 1 1v10H2V4a1 1 0 0 1 1-1ZM5 10h2M9 10h2",
    refresh: "M13 6a5.5 5.5 0 1 0 .2 4M13 2v4H9",
  }
  return <svg class="usage-bars-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[props.kind]} /></svg>
}

function WindowBar(props: { window: UsageWindow; now: number }) {
  const prefs = usePlugin<typeof definition>().stores.display
  const date = () => prefs.value.showResetDate
  const resetDate = () => formatUsageTime(props.window.resetsAt * 1000, prefs.value.hour12, true)
  const description = () => windowDescription(props.window, props.now, prefs.value.hour12)
  const timeRemaining = () => {
    const elapsed = elapsedPercent(props.window, props.now)
    return elapsed === undefined ? undefined : 100 - elapsed
  }
  return <div class="usage-bars-window">
    <span class="usage-bars-window-label">{props.window.label ?? label(props.window.durationSeconds ?? 0)}</span>
    <div class="usage-bars-bar">
      <div class="usage-bars-meter" role="meter" aria-label={`${props.window.label ?? "Usage"} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining(props.window)} aria-valuetext={description()}>
        <div class="usage-bars-fill" style={{ width: `${remaining(props.window)}%`, background: paceColor(props.window, props.now) }} />
        <Show when={timeRemaining() !== undefined}><span class="usage-bars-marker" style={{ left: `clamp(2px, ${timeRemaining() ?? 0}%, calc(100% - 2px))` }} /></Show>
      </div>
      <div class="usage-bars-bar-content">
        <strong aria-hidden="true">{Math.round(remaining(props.window))}% left</strong>
        <button class="usage-bars-reset" onClick={() => prefs.update(state => { state.showResetDate = !state.showResetDate })} aria-label={`${date() ? "Reset date" : "Reset countdown"}: ${date() ? resetDate() : resetCountdown(props.window, props.now)}. Toggle reset date and countdown for all bars.`}>
          <UsageIcon kind={date() ? "calendar" : "hourglass"} />
          <span>{date() ? resetDate() : resetCountdown(props.window, props.now)}</span>
        </button>
      </div>
    </div>
  </div>
}

function DisplaySettings() {
  const ctx = usePlugin<typeof definition>()
  const prefs = ctx.stores.display
  const id = createUniqueId()
  const [open, setOpen] = createSignal(false)
  let trigger!: HTMLButtonElement
  let popup!: HTMLDivElement
  const position = () => {
    const rect = trigger.getBoundingClientRect()
    const width = popup.getBoundingClientRect().width
    popup.style.right = `${Math.max(8, Math.min(window.innerWidth - rect.right, window.innerWidth - width - 8))}px`
    const above = rect.top >= 120
    popup.style.bottom = above ? `${window.innerHeight - rect.top + 6}px` : "auto"
    popup.style.top = above ? "auto" : `${rect.bottom + 6}px`
  }
  return <>
    <button ref={trigger} type="button" class="usage-bars-settings-button" aria-label="Usage display settings" aria-expanded={open()} popovertarget={id} onClick={position}>
      <ctx.ui.Icon name="settings-gear" size="small" />
    </button>
    <div ref={popup} id={id} popover="auto" class="usage-bars-settings-popover" role="group" aria-label="Usage display settings" onToggle={() => { const shown = popup.matches(":popover-open"); setOpen(shown); if (shown) position() }}>
      <div class="usage-bars-settings">
        <div class="usage-bars-settings-row">
          <span aria-hidden="true">12-hour clock</span>
          <div class="usage-bars-settings-control"><ctx.ui.Switch label="12-hour clock" hideLabel checked={prefs.value.hour12} onChange={checked => prefs.update(state => { state.hour12 = checked })} /></div>
        </div>
        <div class="usage-bars-settings-row">
          <span aria-hidden="true">Show reset date</span>
          <div class="usage-bars-settings-control"><ctx.ui.Switch label="Show reset date" hideLabel checked={prefs.value.showResetDate} onChange={checked => prefs.update(state => { state.showResetDate = checked })} /></div>
        </div>
      </div>
    </div>
  </>
}

function UsageView(props: { session?: SessionRef }) {
  const ctx = usePlugin<typeof definition>()
  const time = (timestamp: string) => formatUsageTime(timestamp, ctx.stores.display.value.hour12)
  const [usage, setUsage] = createStore<UsageCache>({ error: "Loading usage…" })
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())
  const [sourceName, setSourceName] = createSignal("")
  const [resetTextWidth, setResetTextWidth] = createSignal(0)
  let resetMeasure!: HTMLDivElement
  const resetTexts = () => usage.providers?.flatMap(provider => provider.windows?.map(window =>
    ctx.stores.display.value.showResetDate
      ? formatUsageTime(window.resetsAt * 1000, ctx.stores.display.value.hour12, true)
      : resetCountdown(window, now()),
  ) ?? []) ?? []
  onMount(() => {
    const observer = new ResizeObserver(entries => setResetTextWidth(entries[0]?.contentRect.width ?? 0))
    observer.observe(resetMeasure)
    onCleanup(() => observer.disconnect())
  })
  let refresh = () => {}
  createKeyed(() => usageSource(ctx.client, props.session ?? ctx.sessions.current()), source => {
    const controller = new AbortController()
    let pending = false
    setSourceName(source.name)
    setUsage(reconcile({ error: "Loading usage…" }))
    setError(undefined)
    const load = async (force = false) => {
      if (pending) return
      pending = true
      setBusy(true)
      try {
        const client = source.client.rpc(Usage)
        const options = { location: source.location, signal: controller.signal }
        const result = await (force ? client.refresh({}, options) : client.get({}, options))
        if (!controller.signal.aborted) { setUsage(reconcile(result)); setError(undefined); setNow(Date.now()) }
      } catch {
        if (!controller.signal.aborted) setError("Unable to update usage; any displayed readings may be stale. Check usage-bars on this session's server. Retrying automatically.")
      } finally {
        pending = false
        if (!controller.signal.aborted) setBusy(false)
      }
    }
    refresh = () => void load(true)
    void load()
    const timer = setInterval(() => { setNow(Date.now()); void load() }, 30_000)
    onCleanup(() => { controller.abort(); clearInterval(timer) })
  }, {
    equals: (previous, next) => previous.client === next.client
      && previous.location?.directory === next.location?.directory && previous.name === next.name,
    otherwise: () => {
      refresh = () => {}
      setBusy(false)
      setSourceName("")
      setUsage(reconcile({ error: "Waiting for the session's server connection…" }))
      setError(undefined)
    },
  })
  return <section class="usage-bars-view" aria-label="Usage limits" style={{ "--usage-bars-reset-width": `calc(18px + ${resetTextWidth()}px)` }}>
    <div ref={resetMeasure} class="usage-bars-reset-measure" aria-hidden="true"><For each={resetTexts()}>{text => <span>{text}</span>}</For></div>
    <div class="usage-bars-row">
      <div class="usage-bars-heading"><h2>Usage limits</h2><Show when={sourceName()}><span class="usage-bars-source">{sourceName()}</span></Show></div>
      <button class="usage-bars-refresh" disabled={busy()} aria-busy={busy()} onClick={() => refresh()} title="Fetch fresh usage from the selected session's server"><UsageIcon kind="refresh" />{busy() ? "Loading…" : "Refresh"}</button>
    </div>
    <Show when={error()}><p role="status">{error()}</p></Show>
    <Show when={usage.providers?.length} fallback={<p>{usage.error ?? "No connected usage providers"}</p>}>
      <For each={usage.providers}>{provider => <details open class="usage-bars-provider">
        <summary>
          <strong>{provider.name}</strong><Show when={provider.account}> <span>({provider.account})</span></Show><Show when={provider.stale}> <span class="usage-bars-stale">Stale</span></Show>
          <Show when={providerSummary(provider, now())}>{summary =>
            <strong class="usage-bars-provider-percent" style={{ color: summary().color }} aria-label={`${summary().label}: ${summary().remaining}% left${provider.summaryPace === "worst" ? "; color reflects the worst window pace" : ""}`}>
              {summary().remaining}% left
            </strong>
          }</Show>
        </summary>
        <Show when={provider.error && provider.windows?.length}>
          <p class="usage-bars-notice" role="status">{provider.error} · Showing last known usage<Show when={provider.lastSuccessAt}> from {time(provider.lastSuccessAt!)}</Show>.</p>
        </Show>
        <Show when={provider.windows?.length} fallback={<p>{provider.error ?? "No usage data"}</p>}>
          <For each={provider.windows}>{window => <WindowBar window={window} now={now()} />}</For>
        </Show>
      </details>}</For>
    </Show>
    <Show when={usage.error && usage.providers?.length}><p role="status">{usage.error}</p></Show>
    <div class="usage-bars-footer">
      <Show when={usage.updatedAt} fallback={<span />}>
        <button class="usage-bars-updated" onClick={() => ctx.stores.display.update(state => { state.hour12 = !state.hour12 })} aria-label={`Last checked ${time(usage.updatedAt!)}. Switch to ${ctx.stores.display.value.hour12 ? "24" : "12"}-hour clock.`}>
          Last checked {time(usage.updatedAt!)}
        </button>
      </Show>
      <DisplaySettings />
    </div>
  </section>
}

export default Plugin.define({
  ...definition,
  setup(ctx) {
    ctx.add(Style, `
      .usage-bars-view { position: relative; container-type: inline-size; padding: 10px 12px; overflow: auto; height: 100%; color: inherit; font-size: 12px; line-height: 1.4; }
      .usage-bars-reset-measure { position: absolute; left: 0; top: 0; display: grid; grid-template-columns: max-content; width: max-content; visibility: hidden; pointer-events: none; font-size: 11px; font-variant-numeric: tabular-nums; }
      .usage-bars-view h2 { margin: 0; font-size: 13px; font-weight: 600; }
      .usage-bars-view p { margin: 4px 0 0; }
      .usage-bars-heading { display: flex; align-items: baseline; flex-wrap: wrap; column-gap: 8px; }
      .usage-bars-source { font-size: 11px; }
      .usage-bars-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .usage-bars-view button { cursor: pointer; font: inherit; }
      .usage-bars-view button:disabled { opacity: .5; cursor: wait; }
      .usage-bars-icon { flex-shrink: 0; }
      .usage-bars-refresh, .usage-bars-reset { display: inline-flex; align-items: center; gap: 5px; }
      .usage-bars-provider { margin-top: 12px; }
      .usage-bars-provider summary { cursor: pointer; }
      .usage-bars-provider-percent { float: right; margin-left: 8px; font-variant-numeric: tabular-nums; }
      .usage-bars-provider[open] > summary > .usage-bars-provider-percent { display: none; }
      .usage-bars-provider summary span, .usage-bars-updated, .usage-bars-source { opacity: .65; }
      .usage-bars-window { display: grid; grid-template-columns: 3.25rem minmax(0, 1fr); align-items: center; gap: 6px; margin-top: 6px; }
      .usage-bars-window-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .usage-bars-bar { position: relative; height: 28px; min-width: 0; }
      .usage-bars-meter { position: absolute; inset: 0; border-radius: 4px; background: color-mix(in srgb, currentColor 10%, transparent); overflow: hidden; }
      .usage-bars-fill { height: 100%; opacity: .4; }
      .usage-bars-marker { position: absolute; top: 4px; bottom: 4px; width: 2px; background: currentColor; opacity: .7; }
      .usage-bars-bar-content { position: relative; display: flex; align-items: center; justify-content: space-between; height: 100%; padding: 0 8px; gap: 8px; font-variant-numeric: tabular-nums; }
      .usage-bars-bar-content strong { flex-shrink: 0; white-space: nowrap; }
      .usage-bars-reset { display: grid; grid-template-columns: 13px minmax(0, 1fr); width: min(var(--usage-bars-reset-width), calc(100% - 64px)); flex-shrink: 0; min-width: 0; font-size: 11px !important; text-align: right; white-space: nowrap; }
      .usage-bars-reset span { overflow: hidden; text-overflow: ellipsis; }
      .usage-bars-stale { font-size: 10px; text-transform: uppercase; border: 1px solid currentColor; border-radius: 3px; padding: 0 3px; }
      .usage-bars-notice { font-size: 11px; opacity: .8; }
      @container (max-width: 300px) {
        .usage-bars-window { grid-template-columns: minmax(0, 1fr); gap: 3px; }
      }
      .usage-bars-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; }
      .usage-bars-settings { display: grid; gap: 12px; }
      .usage-bars-settings-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; }
      .usage-bars-settings-row > span { white-space: nowrap; }
      .usage-bars-settings-control { display: flex; align-items: center; justify-content: flex-end; }
      .usage-bars-settings-button { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; opacity: .65; }
      .usage-bars-settings-button { background: none; border: 0; }
      .usage-bars-settings-button:hover, .usage-bars-settings-button[aria-expanded="true"] { opacity: 1; background: none; }
      .usage-bars-settings-popover { position: fixed; inset: auto; margin: 0; box-sizing: border-box; width: max-content; max-width: calc(100vw - 16px); padding: 16px; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 6px; background: Canvas; color: CanvasText; font-size: 12px; box-shadow: 0 4px 16px #0004; }
      .usage-bars-view .usage-bars-updated { margin: 0; font-size: 11px; }
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

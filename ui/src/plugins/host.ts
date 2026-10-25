/** Объект `host`, который получает `activate` плагина (host-api.md; типы — api.ts).
 *
 *  Один объект на плагин: у него свои слоты (владелец записи — id плагина), свой rpc
 *  `splify2.p.<id>`, свои словари, свои подписки. Всё, что плагин зарегистрировал, снимается
 *  вызовом `cleanup()` — при отключении, ошибке в `activate` и удалении. */
import * as preact from 'preact'
import * as hooks from 'preact/hooks'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Hint } from '@/components/ui/hint'
import { Block, CardHead, Empty, FieldRow, Group, KV, Meter, ScreenHeader, Segmented, StateLine, TapRow, ToggleRow, DangerButton } from '@/components/ui/layout'
import { Spark } from '@/components/ui/spark'
import { Chip, Field, FileButton, inputCls } from '@/components/formbits'
import Flag from '@/components/Flag'
import { notify as panelNotify } from '@/lib/notify'
import { pending, usePending } from '@/lib/pending'
import { decodeSpec, encodeSpec } from '@/lib/specv2'
import { rpc as panelRpc } from '@/lib/rpc'
import { S } from '@/copy'
import { HOST_API_VERSION } from './api'
import type {
    Dispose, Host, PluginEntry, PluginState, PreactExports, SpecV2, UiKit, CoreEventName, CoreEvent,
} from './api'
import { registry } from './registry'
import { pluginRpc } from './rpc'
import { makeI18n, type PluginDicts } from './i18n'
import { currentTheme, registerTheme, styleHost } from './themes'
import { confirmFromPlugin } from './confirmHost'
import { getHostLive, useHostLive } from './hostlive'
import { pluginsState } from './runtime'
import { normalizePlugins, normalizeRepos, PLUGIN_ROOT } from './normalize'


export const preactExports: PreactExports = {
    h: preact.h,
    Fragment: preact.Fragment,
    render: preact.render,
    hooks: hooks as unknown as PreactExports['hooks'],
}

/** Компоненты панели для плагинов: те же, что внутри (`host.ui`). */
export const uiKit = {
    Button, Badge, Card, CardContent, Switch, Hint, ScreenHeader, CardHead, Block, Group, TapRow, KV,
    ToggleRow, Segmented, Empty, FieldRow, Field, Chip, FileButton, DangerButton, Meter, Spark, StateLine,
    Flag, inputClass: inputCls,
} as unknown as UiKit

// События ядра: сокет `steerd` до панели пока не доведён (бэкенд отдаёт состояние опросом), поэтому
// шина своя; `emitCoreEvent` — единственное место, откуда события пойдут, когда rpcd начнёт их отдавать.
const busListeners = new Map<string, Set<(e: CoreEvent<CoreEventName>) => void>>()
export function emitCoreEvent(ev: CoreEventName, data: Record<string, unknown> = {}): void {
    const e = { v: 1 as const, ev, ...data }
    for (const cb of [...(busListeners.get(ev) ?? [])]) {
        try { cb(e) } catch (err) { console.error('[plugin event]', err) }
    }
}

export function pluginRoot(e: Pick<PluginEntry, 'id' | 'root'>): string {
    return e.root ?? `${PLUGIN_ROOT}${e.id}/`
}

export interface HostEnv {
    platform: 'luci' | 'desktop'
    hostVersion: string
    apiVersion?: string
}

export interface MadeHost {
    host: Host
    cleanup(): void
}

export function createHost(entry: PluginEntry, dicts: PluginDicts, env: HostEnv): MadeHost {
    const id = entry.id
    const root = pluginRoot(entry)
    const base = entry.ui?.base ?? `${root}ui/`
    const cleanups: Dispose[] = []
    const track = (d: Dispose): Dispose => {
        cleanups.push(d)
        return () => {
            const i = cleanups.indexOf(d)
            if (i >= 0) cleanups.splice(i, 1)
            d()
        }
    }
    const i18n = makeI18n(dicts)
    const reg = <T,>(slot: Parameters<typeof registry.register>[0], key: string, value: T, order?: number) =>
        track(registry.register(slot, id, key, value, order))

    const host: Host = {
        apiVersion: env.apiVersion ?? HOST_API_VERSION,
        hostVersion: env.hostVersion,
        platform: env.platform,
        plugin: { id, version: entry.version, repo: entry.repo, trust: entry.trust, base },
        preact: preactExports,
        ui: uiKit,
        rpc: pluginRpc(id),
        core: {
            useLive: useHostLive,
            getLive: getHostLive,
            useSpec() {
                const p = usePending()
                const spec = useMemo(() => (p.spec ? (encodeSpec(p.spec) as unknown as SpecV2) : null), [p.spec])
                return { spec, dirty: p.count > 0, applying: p.applying }
            },
            edit(fn) {
                const cur = pending.saved
                if (!cur) return Promise.reject(new Error(S.pending.specNeZagruzhena))
                const draft = JSON.parse(JSON.stringify(encodeSpec(cur))) as SpecV2
                fn(draft)
                pending.edit(decodeSpec(draft))
                return Promise.resolve()
            },
            on(ev, cb) {
                let set = busListeners.get(ev)
                if (!set) busListeners.set(ev, (set = new Set()))
                const f = cb as (e: CoreEvent<CoreEventName>) => void
                set.add(f)
                return track(() => { set!.delete(f) })
            },
            async plugins(): Promise<PluginState[]> {
                const r = await panelRpc.pluginsList()
                return normalizePlugins(r.plugins, normalizeRepos(r.repos)).map((p) => ({
                    id: p.id, repo: p.repo, version: p.version, state: p.state, why: p.why ?? null, update: p.update,
                }))
            },
        },
        i18n,
        styles: {
            add(css) {
                const el = document.createElement('style')
                el.setAttribute('data-plugin', id)
                el.textContent = css
                styleHost().appendChild(el)
                return track(() => el.remove())
            },
            link(path) {
                const el = document.createElement('link')
                el.rel = 'stylesheet'
                el.setAttribute('data-plugin', id)
                el.href = new URL(path, new URL(base, location.href)).href + `?v=${encodeURIComponent(entry.version)}`
                styleHost().appendChild(el)
                return track(() => el.remove())
            },
        },
        slots: {
            pluginSettings: (p) => reg('pluginSettings', 'settings', p),
            railSection: (s) => {
                // Раздел в полосе — исключение: манифест обязан объявить `rail`, и человек может его снять.
                if (!entry.ui?.rail || entry.rail_shown === false) return () => {}
                return reg('section', s.id, { ...s, plugin: id }, s.order ?? 900)
            },
            boardTile: (t) => reg('boardTile', t.id, t, t.order ?? 1000),
            outputKind: (k) => reg('outputKind', k.kind, k),
            setupVia: (v) => reg('setupVia', v.id, v),
            badge: (b) => reg('badge', b.id, b, b.rank ?? 1000),
            diag: (d) => reg('diag', d.id, d),
        },
        themes: {
            register: (t) => track(registerTheme(id, t)),
            current: () => currentTheme(),
        },
        nav: {
            open(section) {
                window.dispatchEvent(new CustomEvent('splify:section', { detail: section }))
            },
            openPlugin(target = id) {
                pluginsState.requestOpen(target)
                window.dispatchEvent(new CustomEvent('splify:section', { detail: 'plugins' }))
            },
        },
        // Настройки интерфейса плагина. По спецификации они лежат на роутере (у каждого плагина свои);
        // метода бэкенда для них пока нет, поэтому — память браузера по плагину и ключу.
        prefs: {
            async get<T = unknown>(key: string) {
                try {
                    const raw = localStorage.getItem(`splify2.pref.${id}.${key}`)
                    return raw === null ? undefined : (JSON.parse(raw) as T)
                } catch {
                    return undefined
                }
            },
            async set(key, value) {
                localStorage.setItem(`splify2.pref.${id}.${key}`, JSON.stringify(value))
            },
        },
        notify(text, tone = 'info') {
            panelNotify(text, tone === 'warn' ? 'warning' : tone === 'error' ? 'error' : 'info')
        },
        confirm: (req) => confirmFromPlugin(req),
    }

    return {
        host,
        cleanup() {
            registry.clearOwner(id)
            i18n.cleanup()
            for (const d of cleanups.splice(0)) {
                try { d() } catch (e) { console.error(`[plugin ${id}] cleanup`, e) }
            }
        },
    }
}

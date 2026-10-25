/** Состояние плагинов в этой сессии панели: что вернул бэкенд и что вышло при загрузке.
 *
 *  Отдельно от реестра слотов: реестр знает, что плагины встроили, а здесь — почему плагин не
 *  загрузился (несовместим, упал при запуске) и о чём карточка должна сказать человеку. */
import { useSyncExternalStore } from 'react'
import type { PluginEntry } from './api'

export type RuntimeStatus =
    | { status: 'off' }                          // выключен
    | { status: 'none' }                         // интерфейса у плагина нет
    | { status: 'loading' }
    | { status: 'active' }
    | { status: 'safe' }                         // панель открыта без плагинов (?safe=1)
    | { status: 'skipped'; reason: string }      // не для этой оболочки (приложение для ПК)
    | { status: 'incompatible'; reason: string } // версия host API не подходит: не загружен
    | { status: 'failed'; reason: string }       // упал при загрузке или запуске

export interface PluginsSnapshot {
    entries: PluginEntry[]
    /** Список от бэкенда пришёл (хоть раз). */
    loaded: boolean
    /** Бэкенд не отдал список: текст для человека. */
    error: string | null
    runtime: Record<string, RuntimeStatus>
    /** Карточка, которую просили раскрыть (`host.nav.openPlugin`); считывается один раз. */
    openRequest: string | null
}

let snap: PluginsSnapshot = { entries: [], loaded: false, error: null, runtime: {}, openRequest: null }
const listeners = new Set<() => void>()

function set(next: Partial<PluginsSnapshot>) {
    snap = { ...snap, ...next }
    for (const l of [...listeners]) l()
}

export const pluginsState = {
    get: () => snap,
    subscribe(l: () => void) {
        listeners.add(l)
        return () => listeners.delete(l)
    },
    setEntries(entries: PluginEntry[]) { set({ entries, loaded: true, error: null }) },
    setError(error: string) { set({ error }) },
    setRuntime(id: string, st: RuntimeStatus) {
        const cur = snap.runtime[id]
        if (cur && cur.status === st.status && (cur as { reason?: string }).reason === (st as { reason?: string }).reason) return
        set({ runtime: { ...snap.runtime, [id]: st } })
    },
    dropRuntime(id: string) {
        if (!(id in snap.runtime)) return
        const { [id]: _gone, ...rest } = snap.runtime
        set({ runtime: rest })
    },
    requestOpen(id: string | null) { set({ openRequest: id }) },
    reset() { snap = { entries: [], loaded: false, error: null, runtime: {}, openRequest: null }; for (const l of [...listeners]) l() },
}

export function usePlugins(): PluginsSnapshot {
    return useSyncExternalStore(pluginsState.subscribe, pluginsState.get)
}

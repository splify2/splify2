import { createContext, useContext, type ReactNode } from 'react'
import type { Live as HostLive } from './api'
import type { Live } from '@/lib/live'

/** Живые данные для плагинов: один опрос панели (`useLive` в Console) раздаётся контекстом, а
 *  `host.core.useLive()` читает его же — второго опроса нет. Форма — `Live` из plugin-api: гарантированные
 *  поля плюс всё остальное, что есть у панели (оно может меняться между minor). */
const LiveCtx = createContext<Live | null>(null)
let latest: Live | null = null

const memo = new WeakMap<Live, HostLive>()

/** Один объект на один снимок панели: плагин может класть его в зависимости хуков. */
export function toHostLive(live: Live): HostLive {
    let h = memo.get(live)
    if (!h) { h = { ...live, speed: live.rawSpeed } as unknown as HostLive; memo.set(live, h) }
    return h
}

export function HostLiveProvider({ live, children }: { live: Live; children?: ReactNode }) {
    latest = live
    return <LiveCtx.Provider value={live}>{children}</LiveCtx.Provider>
}

const EMPTY: HostLive = {
    status: null, error: null, errorKind: null, stale: false, phase: null,
    speed: { ch: {}, dev: {} }, refresh() {},
}

export function useHostLive(): HostLive {
    const live = useContext(LiveCtx)
    return live ? toHostLive(live) : EMPTY
}

export function getHostLive(): HostLive {
    return latest ? toHostLive(latest) : EMPTY
}

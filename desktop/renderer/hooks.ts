import { useEffect, useState } from 'react'
import { desk, type AppSettings, type MonitorState } from './desk'

/** Настройки приложения: копия из главного процесса и правка частью. */
export function useSettings(): [AppSettings | null, (patch: Parameters<typeof desk.settings.set>[0]) => void] {
    const [s, setS] = useState<AppSettings | null>(null)
    useEffect(() => {
        desk.settings.get().then(setS, () => {})
        return desk.settings.onChanged(setS)
    }, [])
    const set = (patch: Parameters<typeof desk.settings.set>[0]) => { desk.settings.set(patch).then(setS, () => {}) }
    return [s, set]
}

/** Сводка сторожа роутера. */
export function useMonitor(): MonitorState | null {
    const [m, setM] = useState<MonitorState | null>(null)
    useEffect(() => {
        desk.monitor.state().then(setM, () => {})
        return desk.monitor.onState(setM)
    }, [])
    return m
}

/** «5 минут назад» — для списка устройств. */
export function ago(unix: number): string {
    const s = Math.max(0, Math.round(Date.now() / 1000 - unix))
    if (s < 90) return 'только что'
    const m = Math.round(s / 60)
    if (m < 60) return `${m} мин назад`
    const h = Math.round(m / 60)
    if (h < 36) return `${h} ч назад`
    return `${Math.round(h / 24)} дн назад`
}

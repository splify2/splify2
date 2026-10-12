// Мост к главному процессу (electron/preload.cjs). Токенов здесь нет — только действия.

export interface ApiState {
    connected: boolean
    base: string | null
    hostname: string
    device: { id: string; name: string } | null
}

export interface WinState {
    maximized: boolean
    focused: boolean
}

/** Настройки приложения — зеркало electron/backend/settings.cjs. */
export interface AppSettings {
    theme: 'system' | 'light' | 'dark'
    zoom: number
    motion: boolean
    launchAtLogin: boolean
    startHidden: boolean
    closeToTray: boolean
    notify: {
        enabled: boolean
        sound: boolean
        router: boolean
        engine: boolean
        outputs: boolean
        recover: boolean
        diag: boolean
    }
    pollHidden: number
    wizardDone: boolean
}

/** Сводка сторожа (electron/backend/monitor.cjs). null — ещё не знает. */
export interface MonitorState {
    reachable: boolean | null
    engine: boolean | null
    outputs: Record<string, 'up' | 'down'>
    diagFail: number
    at: number
}

export interface RouterDevice {
    id: string
    name: string
    platform?: string
    created: number
    seen: number
    ip?: string
    current: boolean
}

export interface RouterInfo {
    product: string
    api: number
    version: string
    hostname: string
}

type Off = () => void
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

interface Desk {
    platform: string
    win: {
        minimize(): void
        toggleMaximize(): void
        close(): void
        state(): Promise<WinState>
        onState(cb: (s: WinState) => void): Off
        onNav(cb: (section: string) => void): Off
        onOpenSettings(cb: () => void): Off
    }
    api: {
        state(): Promise<ApiState>
        connect(address: string, password: string): Promise<ApiState>
        disconnect(): Promise<void>
        call(method: string, params: Record<string, unknown>): Promise<unknown>
        devices(): Promise<RouterDevice[]>
        revoke(id: string): Promise<void>
        info(): Promise<RouterInfo | null>
        onLost(cb: (message: string) => void): Off
        onChanged(cb: (s: ApiState) => void): Off
    }
    settings: {
        get(): Promise<AppSettings>
        set(patch: DeepPartial<AppSettings>): Promise<AppSettings>
        onChanged(cb: (s: AppSettings) => void): Off
    }
    monitor: {
        state(): Promise<MonitorState>
        onState(cb: (s: MonitorState) => void): Off
    }
    app: {
        info(): Promise<{ version: string; electron: string; chrome: string; platform: string }>
        testNotification(): Promise<boolean>
        open(url: string): Promise<void>
    }
}

declare global {
    interface Window {
        splifyDesktop: Desk
    }
}

export const desk = window.splifyDesktop

/** Адрес, к которому подключались последним: подставляется в форму после отключения. */
const LAST = 'desktop:last-base'

export function lastBase(): string {
    try { return localStorage.getItem(LAST) || '' } catch { return '' }
}

/** Память панели (снимки состояния, lib/cache.ts) принадлежит роутеру: у другого роутера она
 *  показала бы чужие правила до первого ответа. Стирается при смене роутера и отключении. */
export function resetMemory(base: string | null) {
    try {
        localStorage.clear()
        if (base) localStorage.setItem(LAST, base)
    } catch { /* память недоступна — нечего и стирать */ }
}

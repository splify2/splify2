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

/** Найденный в сети роутер (electron/backend/discover.cjs). */
export interface FoundRouter {
    address: string
    kind: 'splify2' | 'openwrt'
    version?: string
    hostname: string
    gateway?: boolean
}

/** Что стоит на роутере (осмотр по SSH). */
export interface RouterInventory {
    release: string
    arch: string
    splify2: string | null
    steer: string | null
}

/** Точка входа WARP из подбора (`steer warp-scan`). class: 0 — годна, 1 — колония занята, 2 — без HTTPS. */
export interface WarpPoint {
    ip: string
    port: number
    class: number
    loss: number
    rtt: number
    colo: string
    cc: string
    seen?: string
    warp: boolean
}

export interface WarpScan {
    running: boolean
    at: number
    result: { ok: boolean; points: WarpPoint[]; torn?: number; filtered?: number; error?: string } | null
}

/** Ответ шлюза GET /v1/warp. */
export interface WarpState {
    module: boolean
    kernel: 'awg' | 'wg' | null
    groups: {
        name: string
        count?: number
        transport?: string
        pick?: string
        countries?: string[]
        exclude_countries?: string[]
        members: { name: string; endpoint: string | null; conf: boolean; reg: boolean }[]
        mask?: number | null
    }[]
    scans: Record<string, WarpScan>
}

type Off = () => void
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

interface Desk {
    platform: string
    win: {
        minimize(): void
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
    warp: {
        state(): Promise<WarpState>
        scan(group: string): Promise<{ started?: boolean; running?: boolean }>
        scanState(group: string): Promise<WarpScan>
    }
    wizard: {
        discover(): Promise<FoundRouter[]>
        probe(address: string): Promise<FoundRouter | null>
        inspect(address: string, password: string): Promise<RouterInventory>
        install(address: string, password: string): Promise<{ code: number }>
        onLog(cb: (line: string) => void): Off
    }
    update: {
        onReady(cb: () => void): Off
        install(): Promise<void>
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

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

interface Desk {
    platform: string
    win: {
        minimize(): void
        toggleMaximize(): void
        close(): void
        state(): Promise<WinState>
        onState(cb: (s: WinState) => void): () => void
    }
    api: {
        state(): Promise<ApiState>
        connect(address: string, password: string): Promise<ApiState>
        disconnect(): Promise<void>
        call(method: string, params: Record<string, unknown>): Promise<unknown>
        onLost(cb: (message: string) => void): () => void
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

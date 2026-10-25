import { useEffect, useState } from 'react'
/** Память браузера для того, что роутер отдаёт не мгновенно.
 *
 *  ЗАЧЕМ. Страница splify2 открывается внутри LuCI: сначала грузится сама LuCI, потом наш
 *  загрузчик, потом бандл, и только потом уходят вызовы ubus — каждый из них поднимает на
 *  роутере shell. От нажатия на пункт меню до первых чисел на обзоре проходит несколько
 *  секунд, и всё это время карточки пусты. Между «пусто» и «прошлое значение, помеченное как
 *  прошлое» второе честнее: человек открывает страницу, чтобы посмотреть на числа, а не на
 *  крутилку.
 *
 *  ЧТО СЮДА МОЖНО. Только то, что не вредит, устарев: остаток трафика и точка выхода. Ничего,
 *  на чём принимается решение (состояние движка, правила, применённая спека), здесь не
 *  хранится — устаревшее «работает» было бы ложью, а устаревшее «800 ГБ» просто прошлым
 *  замером, который через секунду сменится настоящим.
 *
 *  Всё завёрнуто в try/catch: в приватном окне и при запрете хранения обращение к
 *  localStorage бросает, и падать из-за кеша страница не должна. */

const PREFIX = 'splify2:'

/** Память приложения для ПК (главный процесс, desktop/electron/backend/memory.cjs): переживает
 *  закрытие без сохранения, которое теряет localStorage. Снимок берётся один раз при загрузке модуля
 *  и дальше живёт здесь — объекты моста при каждом обращении приходят копией. Под LuCI её нет. */
type DeskMemory = { snapshot: Record<string, unknown> | null; set(k: string, v: unknown): void }
const desk = (globalThis as { splifyDesktop?: { memory?: DeskMemory } }).splifyDesktop?.memory
const deskSnap: Record<string, unknown> | null = desk ? { ...(desk.snapshot || {}) } : null

export function cacheGet<T>(key: string): T | null {
    if (deskSnap) return key in deskSnap ? (deskSnap[key] as T) : null
    try {
        const raw = window.localStorage.getItem(PREFIX + key)
        return raw ? (JSON.parse(raw) as T) : null
    } catch {
        return null
    }
}

export function cacheSet(key: string, value: unknown): void {
    if (deskSnap && desk) {
        deskSnap[key] = value
        try { desk.set(key, value) } catch { /* неклонируемое значение — не беда */ }
        return
    }
    try {
        window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
        /* приватное окно, запрет хранения, переполнение — не наша беда */
    }
}

/** Память окна: последний ответ роутера по ключу — сразу, без localStorage-разбора. */
const mem = new Map<string, unknown>()

/** Ответ роутера, который экран показывает СРАЗУ из памяти (окна, затем браузера), а свежий
 *  подставляет, когда придёт. Кнопки и пилюли не ждут опроса: открытие правила, вкладки DNS —
 *  с тем, что роутер отдавал прошлый раз. `null` — ни ответа, ни памяти. `persist` — класть ли
 *  в localStorage (большие и частые ответы — только в память окна). */
export function useRemembered<T>(key: string, fetch: () => Promise<T>, opts: { persist?: boolean; deps?: unknown[] } = {}): T | null {
    const persist = opts.persist ?? true
    const [v, setV] = useState<T | null>(() => (mem.has(key) ? (mem.get(key) as T) : persist ? cacheGet<T>(key) : null))
    useEffect(() => {
        let stop = false
        if (mem.has(key)) setV(mem.get(key) as T)
        else if (persist) { const c = cacheGet<T>(key); if (c !== null) setV(c) }
        fetch().then((r) => {
            if (stop) return
            mem.set(key, r)
            if (persist) cacheSet(key, r)
            setV(r)
        }).catch(() => undefined)
        return () => { stop = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, ...(opts.deps || [])])
    return v
}

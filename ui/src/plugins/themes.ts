/** Темы: наборы значений переменных панели (host-api.md, «Темы»).
 *
 *  Тема — это `--sp-*`/`--an-*` для светлого и (необязательно) тёмного вида плюс немного CSS.
 *  Сами переменные лежат в index.css (`:root` и `.dark`); тема перекрывает их встроенными
 *  свойствами на корне панели, поэтому светлый и тёмный режим работают сами.
 *
 *  Режим `auto` — как было: по фону LuCI (main.tsx, syncTheme). `light`/`dark` — выбор человека,
 *  syncTheme его уважает (`forcedDark`). Выбор хранится в памяти браузера. */
import type { Dispose, ManifestTheme, Theme } from './api'

const KEY = 'splify2.theme'
const BASE_ID = 'default'

type Mode = 'auto' | 'light' | 'dark'
interface Choice { id: string; mode: Mode }

function store(): Storage | null {
    try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

export function readChoice(): Choice {
    try {
        const raw = store()?.getItem(KEY)
        if (raw) {
            const c = JSON.parse(raw) as Partial<Choice>
            return {
                id: typeof c.id === 'string' ? c.id : BASE_ID,
                mode: c.mode === 'light' || c.mode === 'dark' ? c.mode : 'auto',
            }
        }
    } catch { /* память недоступна или испорчена — тема по умолчанию */ }
    return { id: BASE_ID, mode: 'auto' }
}

let choice: Choice = readChoice()
const registered = new Map<string, Theme>()
const listeners = new Set<() => void>()
let target: HTMLElement | null = null
let extra: HTMLStyleElement | null = null
let styleRoot: ParentNode | null = null
const applied = new Set<string>()

const emit = () => { for (const l of [...listeners]) l() }

export function subscribeThemes(l: () => void): () => void {
    listeners.add(l)
    return () => listeners.delete(l)
}

/** Тема из манифеста плагина: id — `<плагин>:<имя>`. */
export function manifestTheme(plugin: string, t: ManifestTheme): Theme {
    return { id: `${plugin}:${t.name}`, name: t.name, light: t.light, dark: t.dark, css: t.css }
}

export function registerTheme(owner: string, t: Theme): Dispose {
    const id = t.id.includes(':') ? t.id : `${owner}:${t.id}`
    registered.set(id, { ...t, id })
    apply()
    emit()
    return () => {
        if (registered.delete(id)) { apply(); emit() }
    }
}

export function listThemes(): { id: string; name: string }[] {
    return [{ id: BASE_ID, name: '' }, ...[...registered.values()].map((t) => ({ id: t.id, name: t.name }))]
}

export function currentTheme(): { id: string; mode: Mode } {
    return { ...choice }
}

export function setTheme(next: Partial<Choice>): void {
    choice = { ...choice, ...next }
    try { store()?.setItem(KEY, JSON.stringify(choice)) } catch { /* без памяти выбор не запомнится */ }
    apply()
    emit()
}

/** Режим задан человеком явно: true — тёмный, false — светлый, null — по фону страницы. */
export function forcedDark(): boolean | null {
    return choice.mode === 'dark' ? true : choice.mode === 'light' ? false : null
}

/** Куда класть стили плагинов: корень панели (shadow root), а без него — `<head>` (стенд, старый WebView). */
export function styleHost(): ParentNode {
    return styleRoot ?? document.head
}

/** Где ставить переменные (корень панели в shadow root) и куда класть CSS темы. */
export function bindTheme(el: HTMLElement | null, root?: ParentNode | null): void {
    target = el
    styleRoot = root ?? null
    extra = null
    applied.clear()
    apply()
}

function isDark(): boolean {
    const f = forcedDark()
    if (f !== null) return f
    return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

/** Пересчитать переменные темы; зовётся при смене темы, режима и класса `.dark` на странице. */
export function apply(): void {
    const el = target ?? (typeof document !== 'undefined' ? document.documentElement : null)
    if (!el) return
    // Только то, что изменилось: запись такого же значения всё равно будит наблюдателя за атрибутом `style`
    // на странице (main.tsx), а тот зовёт эту функцию снова.
    const t = registered.get(choice.id)
    const want: Record<string, string> = {}
    if (t) {
        for (const [k, v] of Object.entries({ ...t.light, ...(isDark() ? (t.dark ?? {}) : {}) })) {
            if (/^--[\w-]+$/.test(k)) want[k] = String(v)
        }
    }
    for (const k of [...applied]) {
        if (k in want) continue
        el.style.removeProperty(k)
        applied.delete(k)
    }
    for (const [k, v] of Object.entries(want)) {
        if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v)
        applied.add(k)
    }
    const host = styleRoot ?? (typeof document !== 'undefined' ? document.head : null)
    if (!host) return
    if (t?.css) {
        if (!extra) { extra = document.createElement('style'); extra.setAttribute('data-sp-theme', '') }
        extra.textContent = t.css
        if (!extra.isConnected) host.appendChild(extra)
    } else if (extra?.isConnected) extra.remove()
}

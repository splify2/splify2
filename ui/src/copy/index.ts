/** Точка входа текстового слоя.
 *
 *  Русский вшит кодом (`ru.ts`) и остаётся запасным: строки, которых нет в словаре выбранного
 *  языка, показываются по-русски. Другие языки — плоские JSON «ns.key → строка» (формат шаблонов —
 *  `format.ts`, список ключей — `ru.json`, его строит `scripts/copy-dict.mjs`): английский пока
 *  вшит файлом `en.json`; по спецификации (host-api.md, i18n; PLUGINS.md, В9) это плагин `lang-en`,
 *  а словарь из плагина языка кладётся в память браузера (`registerHostDict`) и подхватывается при
 *  следующей загрузке панели — читается он здесь, синхронно, потому что модули панели держат строки
 *  в константах и узнают язык при подключении.
 *
 *  Язык меняется перезагрузкой панели (`setLang`). */
import { ru } from './ru'
import en from './en.json'
import { format } from './format'

export type Copy = typeof ru
type Dict = Record<string, string>

const LANG_KEY = 'splify2.lang'
const DICT_KEY = 'splify2.hostdict.'

/** Вшитые словари. Ключ — код языка. Вынос в плагин `lang-en`: убрать запись отсюда, когда плагин
 *  входит в семя splify2 (его loader кладёт словарь в память через `registerHostDict`). */
export const EMBEDDED_LANGS: Record<string, { name: string; dict: Dict }> = {
    en: { name: 'English', dict: en as Dict },
}

function store(): Storage | null {
    try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/** Язык, выбранный человеком; по умолчанию русский. */
export function currentLang(): string {
    return store()?.getItem(LANG_KEY) || 'ru'
}

function cached(lang: string): Dict | null {
    try {
        const raw = store()?.getItem(DICT_KEY + lang)
        return raw ? (JSON.parse(raw) as Dict) : null
    } catch { return null }
}

/** Языки, словарь которых есть сейчас: русский, вшитые и принесённые плагинами языка. */
export function availableLangs(): { id: string; name: string }[] {
    const out = [{ id: 'ru', name: 'Русский' }]
    for (const [id, e] of Object.entries(EMBEDDED_LANGS)) out.push({ id, name: e.name })
    const s = store()
    if (s) {
        try {
            for (let i = 0; i < s.length; i++) {
                const k = s.key(i)
                if (!k?.startsWith(DICT_KEY)) continue
                const id = k.slice(DICT_KEY.length)
                if (!out.some((l) => l.id === id)) out.push({ id, name: s.getItem('splify2.langname.' + id) || id })
            }
        } catch { /* память недоступна — остаются вшитые */ }
    }
    return out
}

/** Словарь плагина языка → в память браузера; подействует после смены языка и перезагрузки. */
export function registerHostDict(lang: string, name: string, dict: Dict): void {
    const s = store()
    if (!s) return
    try {
        s.setItem(DICT_KEY + lang, JSON.stringify(dict))
        s.setItem('splify2.langname.' + lang, name)
    } catch { /* память полна — язык не появится в списке */ }
}

/** Выбрать язык и перезагрузить панель: строки в модулях читаются при подключении. */
export function setLang(lang: string): void {
    const s = store()
    try {
        if (lang === 'ru') s?.removeItem(LANG_KEY)
        else s?.setItem(LANG_KEY, lang)
    } catch { /* без памяти язык не запомнится */ }
    if (typeof location !== 'undefined' && typeof location.reload === 'function') location.reload()
}

export const LANG = currentLang()

const dict: Dict | null = LANG === 'ru' ? null : { ...(EMBEDDED_LANGS[LANG]?.dict ?? {}), ...(cached(LANG) ?? {}) }

const wrapped = new Map<string, unknown>()

function wrap(node: object, prefix: string): unknown {
    const hit = wrapped.get(prefix)
    if (hit) return hit
    const p = new Proxy(node, {
        get(t, k, r) {
            if (typeof k !== 'string') return Reflect.get(t, k, r)
            const v = (t as Record<string, unknown>)[k]
            const key = prefix ? `${prefix}.${k}` : k
            if (v && typeof v === 'object' && !Array.isArray(v)) return wrap(v, key)
            const tr = dict?.[key]
            if (tr === undefined) return v
            if (typeof v === 'string') return tr
            if (typeof v === 'function') return (...a: unknown[]) => format(tr, a, LANG)
            return v
        },
    })
    wrapped.set(prefix, p)
    return p
}

/** Строки панели. Русский — сам объект; другой язык — тот же объект с подменой по словарю. */
export const S: Copy = dict ? (wrap(ru, '') as Copy) : ru

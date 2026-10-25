/** Словари плагина (`i18n/<язык>.json`, плоский «ключ → строка» с `{имя}`) и `host.i18n`.
 *
 *  Строка ищется в языке человека, затем в `ru`, затем отдаётся сам ключ (host-api.md, i18n).
 *  Словари читаются до `activate`, чтобы `t()` работала сразу и синхронно. Нет файла — нет словаря:
 *  плагин без переводов показывает ключи, а не падает. */
import { LANG } from '@/copy'
import { fill, pluralForm } from '@/copy/format'
import type { Dispose, I18n } from './api'

export type PluginDict = Record<string, string>
export interface PluginDicts { lang: PluginDict | null; ru: PluginDict | null }

export type JsonFetcher = (url: string) => Promise<unknown | null>

export const fetchJson: JsonFetcher = async (url) => {
    try {
        const r = await fetch(url, { credentials: 'same-origin' })
        return r.ok ? await r.json() : null
    } catch {
        return null
    }
}

const asDict = (v: unknown): PluginDict | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as PluginDict) : null

/** Прочитать словари языка человека и русский. `have` — какие языки заявлены в манифесте
 *  (нет списка — пробуем). */
export async function loadDicts(root: string, have: readonly string[] | undefined, get: JsonFetcher, lang = LANG): Promise<PluginDicts> {
    const want = (l: string) => !have || have.includes(l)
    const [own, ru] = await Promise.all([
        lang !== 'ru' && want(lang) ? get(`${root}i18n/${lang}.json`) : null,
        want('ru') ? get(`${root}i18n/ru.json`) : null,
    ])
    return { lang: asDict(own), ru: asDict(ru) }
}

const handlers = new Set<(lang: string) => void>()

/** Смена языка панели: сейчас она идёт перезагрузкой, и подписчики не зовутся; точка для того дня,
 *  когда язык станет меняться без перезагрузки. */
export function notifyLang(lang: string): void {
    for (const h of [...handlers]) h(lang)
}

export function makeI18n(dicts: PluginDicts, lang = LANG): I18n & { cleanup(): void } {
    const mine = new Set<(l: string) => void>()
    return {
        lang,
        t(key, vars) {
            const s = dicts.lang?.[key] ?? dicts.ru?.[key] ?? key
            return fill(s, vars)
        },
        plural: (n, forms) => pluralForm(lang, n, forms),
        onChange(cb): Dispose {
            handlers.add(cb)
            mine.add(cb)
            return () => { handlers.delete(cb); mine.delete(cb) }
        },
        cleanup() { for (const c of mine) handlers.delete(c); mine.clear() },
    }
}

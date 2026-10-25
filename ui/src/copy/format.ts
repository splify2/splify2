/** Шаблоны строк словаря хоста (scripts/copy-dict.mjs; host-api.md, i18n).
 *
 *  `{0}`, `{1}` — параметры по порядку; `{0#один|два|много}` — число и слово нужной формы
 *  («3 подписки»); `\{`, `\}`, `\|`, `\#`, `\\` — сами знаки. Число форм зависит от языка:
 *  две — «один / другое» (en, de…), три — «один / несколько / много» (ru, uk, be). */

/** Номер формы по правилам языка при `count` формах. */
export function pluralIndex(_lang: string, n: number, count: number): number {
    if (count <= 1) return 0
    if (count === 2) return Math.abs(n) === 1 ? 0 : 1
    const a = Math.abs(n)
    const m10 = a % 10, m100 = a % 100
    return m10 === 1 && m100 !== 11 ? 0 : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2
}

/** Слово нужной формы: `forms` — ["узел", "узла", "узлов"] для ru, ["node", "nodes"] для en. */
export function pluralForm(lang: string, n: number, forms: readonly string[]): string {
    return forms[Math.min(pluralIndex(lang, n, forms.length), forms.length - 1)] ?? ''
}

const TOKEN = /\\(.)|\{(\d+)(?:#((?:\\.|[^}\\])*))?\}/g

function splitForms(s: string): string[] {
    const out: string[] = []
    let cur = ''
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '\\' && i + 1 < s.length) { cur += s[++i]; continue }
        if (s[i] === '|') { out.push(cur); cur = ''; continue }
        cur += s[i]
    }
    out.push(cur)
    return out
}

export function format(template: string, args: readonly unknown[], lang: string): string {
    return template.replace(TOKEN, (_m, lit: string | undefined, idx: string | undefined, forms: string | undefined) => {
        if (lit !== undefined) return lit
        const v = args[Number(idx)]
        if (forms === undefined) return String(v ?? '')
        return `${v} ${pluralForm(lang, Number(v), splitForms(forms))}`
    })
}

/** Подстановка `{имя}` в строках словарей плагинов (плоский «ключ → строка»). */
export function fill(template: string, vars?: Record<string, string | number>): string {
    return vars ? template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : template
}

/** Сверка версий по синтаксису npm: `=`, `^`, `~`, `>=`, `>`, `<=`, `<`, пробел — «и», `||` — «или»
 *  (manifest.md, compat). Хватает того, что пишут в `compat`: числа через точку, без пред-релизов. */

type V = [number, number, number]

function parse(s: string): V | null {
    const m = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(s.trim())
    if (!m) return null
    const n = (x: string | undefined) => (x === undefined || x === 'x' || x === '*' ? 0 : Number(x))
    return [n(m[1]), n(m[2]), n(m[3])]
}

function cmp(a: V, b: V): number {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
    return 0
}

/** Сколько частей версии названо явно: «1.2» — две, «1» — одна. */
function named(s: string): number {
    return s.trim().replace(/^[v=]/, '').split('.').filter((p) => p !== '' && p !== 'x' && p !== '*').length
}

function one(v: V, term: string): boolean {
    const m = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(term.trim())
    if (!m) return false
    const op = m[1] ?? '='
    const t = parse(m[2])
    if (!t) return false
    const k = named(m[2])
    switch (op) {
        case '>=': return cmp(v, t) >= 0
        case '>': return cmp(v, t) > 0
        case '<=': return cmp(v, t) <= 0
        case '<': return cmp(v, t) < 0
        case '^': {
            // Первая ненулевая часть не меняется: ^1.2.3 → <2.0.0, ^0.2.3 → <0.3.0, ^0.0.3 → <0.0.4.
            const hi: V = t[0] > 0 || k <= 1 ? [t[0] + 1, 0, 0] : t[1] > 0 || k <= 2 ? [0, t[1] + 1, 0] : [0, 0, t[2] + 1]
            return cmp(v, t) >= 0 && cmp(v, hi) < 0
        }
        case '~': {
            const hi: V = k <= 1 ? [t[0] + 1, 0, 0] : [t[0], t[1] + 1, 0]
            return cmp(v, t) >= 0 && cmp(v, hi) < 0
        }
        default: {
            // «1.2» — любая 1.2.x
            if (k >= 3) return cmp(v, t) === 0
            if (k === 2) return v[0] === t[0] && v[1] === t[1]
            return v[0] === t[0]
        }
    }
}

/** Годится ли `version` под `range`. Пустой диапазон — любая версия; непонятный — нет. */
export function satisfies(version: string, range: string | undefined): boolean {
    if (range === undefined || range.trim() === '' || range.trim() === '*') return true
    const v = parse(version)
    if (!v) return false
    return range.split('||').some((alt) => {
        // «>= 1.2» с пробелом после знака склеивается в один член.
        const terms = alt.trim().replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1').split(/\s+/).filter(Boolean)
        return terms.length > 0 && terms.every((t) => one(v, t))
    })
}

/** Разбор того, что отдаёт `recheck_info`: файл памяти движка ReCheck (`DPI7`, src/state.c в его
 *  репозитории) и строки событий из журнала. Только чтение: движок пишет, экран показывает. */

/** Способы обхода по номеру `enum dpi_mod_kind` движка. */
const MOD_NAMES = [
    'Разрез', 'Перестановка', 'Ложный TLS', 'Ложный хост', 'Ложный QUIC',
    'Фрагменты IP', 'Разрез QUIC', 'Перестановка QUIC', 'Ложный STUN',
] as const
const MOD_KINDS = MOD_NAMES.length

type Transport = 'TCP' | 'QUIC' | 'STUN' | 'Discord'

export interface Learned {
    host: string
    ip: string
    port: number
    transport: Transport
    /** Обход проверен полной загрузкой, а не только рукопожатием. */
    confirmed: boolean
    /** Способы найденного обхода; пусто — сайт открывается без обхода или обход не найден. */
    mods: string[]
    /** До какого времени движок это помнит (мс, часы стены). */
    until: number
}

export interface Family {
    suffix: string
    transport: Transport
    /** Проверен на сайте семейства, а не только по рукопожатию. */
    confirmed: boolean
    mods: string[]
    members: number
    until: number
}

export interface Memory {
    saved: number
    sites: Learned[]
    families: Family[]
}

function transportOf(proto: number, variant: number): Transport {
    if (proto === 6) return 'TCP'
    if (variant === 3) return 'STUN'
    if (variant === 4) return 'Discord'
    return 'QUIC'
}

/** Рецепт `id count [kind repeats fooling position overlap]*`; null — строка оборвана. */
function recipe(f: string[], at: number): { mods: string[]; next: number } | null {
    const count = Number(f[at + 1])
    if (!Number.isInteger(count) || count < 0 || count > 8) return null
    const mods: string[] = []
    for (let i = 0; i < count; i++) {
        const kind = Number(f[at + 2 + i * 5])
        if (!Number.isInteger(kind)) return null
        const name = MOD_NAMES[kind] ?? `#${kind}`
        if (!mods.includes(name)) mods.push(name)
    }
    const next = at + 2 + count * 5
    return next <= f.length ? { mods, next } : null
}

export function parseMemory(text: string): Memory {
    const out: Memory = { saved: 0, sites: [], families: [] }
    const lines = text.split('\n')
    const head = /^DPI7 (\d+)$/.exec(lines[0]?.trim() ?? '')
    if (!head) return out
    out.saved = Number(head[1])
    for (const line of lines.slice(1)) {
        const f = line.trim().split(/\s+/)
        if (f.length < 2) continue
        if (f[0] === 'F') {
            // F expiry family proto variant port epoch suffix members conflicts recipe…
            const r = recipe(f, 10)
            if (!r) continue
            out.families.push({
                suffix: f[7],
                transport: transportOf(Number(f[3]), Number(f[4])),
                confirmed: Number(f[4]) === 0 || Number(f[3]) === 17,
                mods: r.mods,
                members: Number(f[8]) || 0,
                until: Number(f[1]) || 0,
            })
            continue
        }
        // expiry confirmed family proto port epoch variant ip host recipe [succ trials]×9 learned …
        const r = recipe(f, 9)
        if (!r) continue
        const learned = Number(f[r.next + MOD_KINDS * 2])
        if (!Number.isFinite(learned)) continue
        out.sites.push({
            host: f[8] === '-' ? '' : f[8],
            ip: f[7],
            port: Number(f[4]) || 0,
            transport: transportOf(Number(f[3]), Number(f[6])),
            confirmed: f[1] === '1',
            mods: r.mods,
            until: Math.max(learned, Number(f[0]) || 0),
        })
    }
    return out
}

/** Сайты по имени: у одного имени бывает много адресов (CDN) — строкой на имя и транспорт. */
export interface SiteRow {
    host: string
    transport: Transport
    ips: string[]
    confirmed: boolean
    mods: string[]
    until: number
}

export function groupSites(sites: Learned[]): SiteRow[] {
    const by = new Map<string, SiteRow>()
    for (const s of sites) {
        const key = `${s.host || s.ip}\u0000${s.transport}`
        const row = by.get(key)
        if (!row) {
            by.set(key, { host: s.host, transport: s.transport, ips: [s.ip], confirmed: s.confirmed, mods: [...s.mods], until: s.until })
            continue
        }
        if (!row.ips.includes(s.ip)) row.ips.push(s.ip)
        row.confirmed ||= s.confirmed
        for (const m of s.mods) if (!row.mods.includes(m)) row.mods.push(m)
        row.until = Math.max(row.until, s.until)
    }
    return [...by.values()].sort((a, b) =>
        Number(b.mods.length > 0) - Number(a.mods.length > 0) || Number(b.confirmed) - Number(a.confirmed) ||
        (a.host || a.ips[0]).localeCompare(b.host || b.ips[0]))
}

/** Семейство одно на суффикс и транспорт: пробная запись рядом с подтверждённой — та же. */
export function groupFamilies(list: Family[]): Family[] {
    const by = new Map<string, Family>()
    for (const f of list) {
        const key = `${f.suffix}\u0000${f.transport}`
        const was = by.get(key)
        if (!was || (f.confirmed && !was.confirmed)) by.set(key, f)
    }
    return [...by.values()].sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || a.suffix.localeCompare(b.suffix))
}

/** Что событие значит для человека; событий без перевода экран не показывает. */
const EVENT_TEXT: Record<string, { text: string; tone: 'ok' | 'bad' | 'wait' }> = {
    'direct-ok': { text: 'открывается напрямую', tone: 'ok' },
    'direct-failed': { text: 'напрямую не открывается', tone: 'bad' },
    'probe-start': { text: 'подбор обхода', tone: 'wait' },
    'switch-provisional': { text: 'обход найден', tone: 'ok' },
    'provisional-only': { text: 'обход найден, ждёт проверки', tone: 'wait' },
    'confirmed': { text: 'обход подтверждён', tone: 'ok' },
    'bulk-switch-confirmed': { text: 'обход подтверждён загрузкой', tone: 'ok' },
    'bulk-stall-suspected': { text: 'загрузка зависла', tone: 'bad' },
    'warm-escalated': { text: 'загрузка зависла, подбор заново', tone: 'wait' },
    'rollback': { text: 'обход снят', tone: 'bad' },
    'learning-exhausted': { text: 'обход не найден', tone: 'bad' },
    'udp-learning-exhausted': { text: 'обход не найден', tone: 'bad' },
}

export interface EventRow {
    time: string
    text: string
    tone: 'ok' | 'bad' | 'wait'
    host: string
    ip: string
    port: number
    /** Сколько таких же подряд. */
    times: number
}

/** Строки «ЧЧ:ММ:СС event=… host=… ip=… port=…», новые — первыми, повторы подряд — одной. */
export function parseEvents(text: string): EventRow[] {
    const rows: EventRow[] = []
    for (const line of text.split('\n')) {
        const m = /^(\S+) event=([a-z-]+) .*?host=(\S*) ip=(\S+) port=(\d+)/.exec(line.trim())
        if (!m) continue
        const t = EVENT_TEXT[m[2]]
        if (!t) continue
        const last = rows[rows.length - 1]
        if (last && last.text === t.text && last.host === m[3] && last.ip === m[4]) {
            last.times++
            last.time = m[1]
            continue
        }
        rows.push({ time: m[1], text: t.text, tone: t.tone, host: m[3], ip: m[4], port: Number(m[5]), times: 1 })
    }
    return rows.reverse()
}

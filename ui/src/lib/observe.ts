import type { Spec } from '@/lib/model'

import { S } from '@/copy'
/** Соединение, которое ядро steer повело в свой выход (`steer conns`, steer docs/ctl.md, «conns»):
 *  запись conntrack с непустым полем метки ядра. Направление — исходное: кто начал и куда. */
export interface Conn {
    family: 'ipv4' | 'ipv6'
    /** tcp, udp, icmp, icmpv6, sctp, udplite, dccp, gre; иначе номер протокола строкой. */
    proto: string
    src: string
    sport?: number
    dst: string
    dport?: number
    mark: string
    /** Имя выхода по реестру меток применённой спеки; null — выход убран, соединение доживает. */
    out: string | null
    /** Только TCP. */
    state?: string
    /** Счётчики — только если ядро Linux их ведёт (nf_conntrack_acct). */
    packets?: number
    bytes?: number
    reply_packets?: number
    reply_bytes?: number
}

export interface ConnsReply {
    schema?: number
    conns?: Conn[]
    /** В ответе не больше 2000 записей — это предел ядра steer; `total` — сколько подошло всего. */
    shown?: number
    total?: number
    truncated?: boolean
    /** Отказ бэкенда: conntrack недоступен или ядро не ответило. */
    error?: string
}

/** Правила, которые ведут в выход: по включённым правилам спеки. Ядро называет у соединения
 *  только выход (метка у соединения — метка выхода, а не правила), поэтому правило известно
 *  точно, только когда в выход ведёт одно правило; иначе — перечень тех, что ведут. */
export function rulesOf(spec: Spec | null | undefined, out: string | null): string[] {
    if (!spec || !out) return []
    return spec.channels.filter((c) => c.out === out && c.enabled !== false).map((c) => c.name)
}

/** Слово о TCP-соединении, которое не в обычном состоянии: устанавливается или закрывается.
 *  Установленное — без слова: это обычный случай, и слово на каждой строке было бы шумом. */
export function tcpWord(state?: string): string | null {
    if (!state) return null
    if (state === 'syn_sent' || state === 'syn_recv' || state === 'syn_sent2') return S.observe.ustanavlivaetsya
    if (state === 'fin_wait' || state === 'close_wait' || state === 'last_ack' || state === 'time_wait' || state === 'close')
        return S.observe.zakryvaetsya
    return null
}

/** Адрес с портом: у IPv6 — в квадратных скобках, как пишут адрес с портом. */
export function hostPort(addr: string, port?: number): string {
    if (port === undefined) return addr
    return addr.includes(':') ? `[${addr}]:${port}` : `${addr}:${port}`
}

/** Сколько секунд назад — человеческим сроком. */
export function agoText(sec: number): string {
    if (sec < 60) return S.observe.sNazad(Math.max(0, Math.round(sec)))
    if (sec < 3600) return S.observe.minNazad(Math.round(sec / 60))
    if (sec < 86400) return S.observe.chNazad(Math.round(sec / 3600))
    return S.observe.dnNazad(Math.round(sec / 86400))
}

/** Строка поиска совпадает с любым из слов (без учёта регистра). Пустая — совпадает всегда. */
export function matches(q: string, words: (string | number | null | undefined)[]): boolean {
    const s = q.trim().toLowerCase()
    if (!s) return true
    return words.some((w) => w !== null && w !== undefined && String(w).toLowerCase().includes(s))
}

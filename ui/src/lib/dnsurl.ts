import type { Upstream } from '@/lib/model'

/** Годится ли адрес для `fragment: true` (спека v2): только DoT (`tls://`) и DoH (`https://`).
 *  На `udp://`, `tcp://`, `quic://`, `h3://` и на группу ядро ключ отвергает, и спека не
 *  применяется целиком. */
export function fragmentApplies(url: string | undefined): boolean {
    return /^(tls|https):\/\//i.test((url ?? '').trim())
}

/** Сервер с новым адресом: `fragment` остаётся, только пока схема его допускает. */
export function withUrl(u: Upstream, url: string): Upstream {
    const next: Upstream = { ...u, url }
    if (!fragmentApplies(url)) delete next.fragment
    return next
}

/** Сервер с включённым или выключенным `fragment` (выключенный ключа не оставляет). */
export function withFragment(u: Upstream, on: boolean): Upstream {
    const { fragment: _f, ...rest } = u
    return on && fragmentApplies(u.url) ? { ...rest, fragment: true } : rest
}

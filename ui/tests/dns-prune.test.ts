import { describe, expect, it } from 'vitest'
import { pruneDnsPresets } from '@/lib/dnspresets'
import type { Spec } from '@/lib/model'

/* Готовый сервер, на который никто не ссылается, из спеки уходит: иначе вкладка DNS показывает
 * «DNS провайдера», а в спеке висит cloudflare (поймал владелец на стенде). */
const CF = { url: 'https://cloudflare-dns.com/dns-query', ips: ['1.1.1.1', '1.0.0.1'] }
const OWN = { url: 'https://dns.example/dns-query' }
const base = (over: Partial<Spec> = {}): Spec => ({
    version: 2,
    outputs: { direct: { name: 'direct', kind: 'direct' } },
    lists: {},
    channels: [],
    ...over,
} as unknown as Spec)

describe('уборка готовых серверов DNS', () => {
    it('правило без DNS — готовый сервер уходит, свой остаётся', () => {
        const s = pruneDnsPresets(base({ dns: { upstreams: { cloudflare: CF, mine: OWN } }, channels: [{ name: 'a', out: 'direct' }] as Spec['channels'] }))
        expect(s.dns).toEqual({ upstreams: { mine: OWN } })
    })

    it('ничего не осталось — блока dns нет', () => {
        expect(pruneDnsPresets(base({ dns: { upstreams: { cloudflare: CF } } })).dns).toBeUndefined()
    })

    it('на сервер ссылаются — остаётся', () => {
        const ref = base({ dns: { upstreams: { cloudflare: CF } }, channels: [{ name: 'a', out: 'direct', dns: 'cloudflare' }] as Spec['channels'] })
        expect(pruneDnsPresets(ref)).toBe(ref)
        const common = base({ dns: { upstreams: { cloudflare: CF }, other: 'cloudflare' } })
        expect(pruneDnsPresets(common)).toBe(common)
    })

    it('удаление правила уносит его готовый сервер', () => {
        const full = base({ dns: { upstreams: { cloudflare: CF } }, channels: [{ name: 'a', out: 'direct', dns: 'cloudflare' }] as Spec['channels'] })
        const s = pruneDnsPresets({ ...full, channels: full.channels.filter((_, k) => k !== 0) })
        expect(s.dns).toBeUndefined()
    })
})

import { describe, expect, it } from 'vitest'
import { decodeSpec, encodeSpec, wasV1 } from '@/lib/specv2'
import type { Spec } from '@/lib/model'

// Кодек спеки v2 без движка: форма записи и чтения. Совпадение с настоящим движком проверяет
// specv2-engine.test.ts; здесь — то, что не зависит от бинарника: какие ключи пишутся, как
// узнаются пулы и спутники, что не теряется при круге.

const base = (p: Partial<Spec>): Spec => ({ outputs: { direct: { name: 'direct', kind: 'direct' } }, channels: [], ...p })

describe('запись v2', () => {
    it('пишет version: 2 и не пишет ни schema, ни channels', () => {
        const d = encodeSpec(base({}))
        expect(d.version).toBe(2)
        expect('schema' in d).toBe(false)
        expect('channels' in d).toBe(false)
    })

    it('VLESS и hysteria2 — kind: tunnel с protocol, подписка и узлы своими ключами', () => {
        const d = encodeSpec(base({
            outputs: {
                direct: { name: 'direct', kind: 'direct' },
                nl: { name: 'nl', kind: 'vless', sub_file: '/etc/steer/sub.txt', nodes: [3, 5], transport: ['ws', 'httpupgrade'], over: 'wg0', on_fail: 'drop' },
                hy: { name: 'hy', kind: 'hysteria2', sub_file: '/etc/steer/subs/hy.txt', node: 2 },
            },
        })) as { outputs: Record<string, Record<string, unknown>> }
        expect(d.outputs.nl).toEqual({
            kind: 'tunnel', protocol: 'vless', subscription: '/etc/steer/sub.txt', nodes: [3, 5],
            transport: ['ws', 'httpupgrade'], on_fail: 'drop', over: 'wg0',
        })
        /* У hysteria2 ключа transport нет вовсе, а одиночный `node` — это nodes: [N]. */
        expect(d.outputs.hy).toEqual({ kind: 'tunnel', protocol: 'hysteria2', subscription: '/etc/steer/subs/hy.txt', nodes: [2] })
    })

    it('один транспорт пишется строкой', () => {
        const d = encodeSpec(base({
            outputs: { direct: { name: 'direct', kind: 'direct' }, nl: { name: 'nl', kind: 'vless', sub_file: '/s', transport: ['ws'] } },
        })) as { outputs: Record<string, Record<string, unknown>> }
        expect(d.outputs.nl.transport).toBe('ws')
    })

    it('группа пишет только ключи своего способа выбора', () => {
        const d = encodeSpec(base({
            outputs: {
                direct: { name: 'direct', kind: 'direct' },
                a: { name: 'a', kind: 'interface', device: 'wg0' },
                b: { name: 'b', kind: 'interface', device: 'wg1' },
                eu: { name: 'eu', kind: 'group', pick: 'manual', members: ['a', 'b'], default: 'b', tolerance: 10, weights: [1, 2] },
                fast: { name: 'fast', kind: 'group', pick: 'latency', members: ['a', 'b'], tolerance: 50, default: 'a' },
            },
        })) as { outputs: Record<string, Record<string, unknown>> }
        expect(d.outputs.eu).toEqual({ kind: 'group', pick: 'manual', members: ['a', 'b'], default: 'b' })
        expect(d.outputs.fast).toEqual({ kind: 'group', pick: 'latency', members: ['a', 'b'], tolerance: 50 })
    })

    it('IPv6: prefix пишется только вместе с routed', () => {
        const d = encodeSpec(base({
            outputs: {
                direct: { name: 'direct', kind: 'direct' },
                h: { name: 'h', kind: 'interface', device: 'wg1', ipv6: 'routed', prefix: '2001:db8:1::/56' },
                n: { name: 'n', kind: 'interface', device: 'wg2', ipv6: 'nat', prefix: '2001:db8:2::/56' },
            },
        })) as { outputs: Record<string, Record<string, unknown>> }
        expect(d.outputs.h).toMatchObject({ ipv6: 'routed', prefix: '2001:db8:1::/56' })
        expect(d.outputs.n.ipv6).toBe('nat')
        expect('prefix' in d.outputs.n).toBe(false)
    })

    it('пул — группа с членами «<пул>.<устройство>» в конце списка выходов', () => {
        const d = encodeSpec(base({
            outputs: {
                direct: { name: 'direct', kind: 'direct' },
                vpn: { name: 'vpn', kind: 'interface', devices: ['wg0', 'wg1'], on_fail: 'direct', pick: 'latency', tolerance: 30 },
                solo: { name: 'solo', kind: 'interface', device: 'wg2' },
            },
        })) as { outputs: Record<string, Record<string, unknown>> }
        expect(Object.keys(d.outputs)).toEqual(['direct', 'vpn', 'solo', 'vpn.wg0', 'vpn.wg1'])
        expect(d.outputs.vpn).toEqual({ kind: 'group', pick: 'latency', members: ['vpn.wg0', 'vpn.wg1'], tolerance: 30, on_fail: 'direct' })
        expect(d.outputs['vpn.wg0']).toEqual({ kind: 'interface', device: 'wg0' })
    })

    it('клиенты, списки и правила — отдельными разделами', () => {
        const d = encodeSpec(base({
            lan_devices: ['br-lan', 'tailscale0'],
            outputs: { direct: { name: 'direct', kind: 'direct' }, wg0: { name: 'wg0', kind: 'interface', device: 'wg0' } },
            channels: [
                { name: 'Новости', out: 'wg0', from: ['192.168.1.50', '192.168.2.0/24'], match: { domains_files: ['/l/a.lst'], mode: 'realip' }, dns: 'g' },
                { name: 'Телефон', out: 'direct', from: ['aa:bb:cc:dd:ee:01'], scope: 'device', enabled: false, match: { any: true } },
            ],
            dns: { upstream: 'g', upstreams: { g: { url: 'https://dns.google/dns-query', out: 'wg0' } }, cache: 100 },
        })) as Record<string, unknown>
        expect(d.lan).toEqual({ devices: ['br-lan', 'tailscale0'] })
        /* Имена клиентов и списков — идентификаторы: русское имя правила в них не годится, и берётся
         * номер. Само правило имя сохраняет. */
        expect(d.clients).toEqual({ c1: { addr: ['192.168.1.50', '192.168.2.0/24'] }, c2: { mac: ['aa:bb:cc:dd:ee:01'] } })
        expect(d.rules).toEqual([
            { name: 'Новости', for: expect.any(String), to: [expect.any(String)], out: 'wg0', resolve: 'realip', dns: 'g' },
            { name: 'Телефон', for: expect.any(String), to: 'all', out: 'direct', enabled: false, scope: 'device' },
        ])
        expect(d.dns).toEqual({ cache: 100, upstream: 'g', upstreams: { g: { url: 'https://dns.google/dns-query', out: 'wg0' } } })
    })
})

describe('чтение v2 и круг', () => {
    it('v1 узнаётся, v2 — нет', () => {
        expect(wasV1(decodeSpec({ schema: 1, outputs: {}, channels: [] }))).toBe(true)
        expect(wasV1(decodeSpec({ version: 2 }))).toBe(false)
    })

    it('via из v1 становится over', () => {
        const s = decodeSpec({ schema: 1, outputs: { nl: { kind: 'vless', sub_file: '/s', via: 'wg0' } }, channels: [] })
        expect(s.outputs.nl.over).toBe('wg0')
        expect('via' in s.outputs.nl).toBe(false)
    })

    it('пул узнаётся по именам членов; чужая группа остаётся группой', () => {
        const s = decodeSpec({
            version: 2,
            outputs: {
                wg0: { kind: 'interface', device: 'wg0' }, wg1: { kind: 'interface', device: 'wg1' },
                res: { kind: 'group', pick: 'order', members: ['wg0', 'wg1'] },
                vpn: { kind: 'group', pick: 'order', members: ['vpn.wg0', 'vpn.wg1'], on_fail: 'direct' },
                'vpn.wg0': { kind: 'interface', device: 'wg0' }, 'vpn.wg1': { kind: 'interface', device: 'wg1' },
            },
        })
        expect(s.outputs.res.kind).toBe('group')
        expect(s.outputs.vpn).toMatchObject({ kind: 'interface', devices: ['wg0', 'wg1'], on_fail: 'direct' })
        expect('vpn.wg0' in s.outputs).toBe(false)
    })

    it('туннель, чьё устройство названо членом пула, становится его частью; ссылка из правила — нет', () => {
        const doc = (ruleOut: string) => ({
            version: 2,
            outputs: {
                vpn: { kind: 'group', pick: 'order', members: ['vpn.t1', 'vpn.wg0'] },
                'vpn.t1': { kind: 'interface', device: 't1' }, 'vpn.wg0': { kind: 'interface', device: 'wg0' },
                t1: { kind: 'tunnel', protocol: 'vless', subscription: '/s', nodes: [1] },
            },
            lists: { a: { domains_file: ['/l/a.lst'] } },
            rules: [{ name: 'x', to: ['a'], out: ruleOut }],
        })
        expect(decodeSpec(doc('vpn')).outputs.t1.part_of).toBe('vpn')
        expect(decodeSpec(doc('t1')).outputs.t1.part_of).toBeUndefined()
    })

    it('спутник с портами складывается в родителя и разворачивается обратно', () => {
        const ui: Spec = base({
            outputs: { direct: { name: 'direct', kind: 'direct' }, wg0: { name: 'wg0', kind: 'interface', device: 'wg0' } },
            channels: [{
                name: 'Discord', out: 'wg0',
                match: { domains_files: ['/l/dom.lst'], prefixes_files: ['/l/dc.lst'] },
                narrow: { '/l/dc.lst': { proto: 'udp', ports: ['50000-65535'] } },
            }],
        })
        const d = encodeSpec(ui) as { rules: { name: string }[] }
        expect(d.rules.map((r) => r.name)).toEqual(['Discord', 'Discord (порты)'])
        const back = decodeSpec(d)
        expect(back.channels).toHaveLength(1)
        expect(back.channels[0].match.prefixes_files).toEqual(['/l/dc.lst'])
        expect(back.channels[0].narrow).toEqual({ '/l/dc.lst': { proto: 'udp', ports: ['50000-65535'] } })
        expect(encodeSpec(back)).toEqual(d)
    })

    it('неизвестные ключи выхода доезжают обратно', () => {
        const s = decodeSpec({ version: 2, outputs: { w: { kind: 'interface', device: 'wg0', будущее: 7 } } })
        expect((encodeSpec(s).outputs as Record<string, Record<string, unknown>>).w.будущее).toBe(7)
    })
})

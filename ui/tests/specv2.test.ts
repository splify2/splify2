import { describe, expect, it } from 'vitest'
import { decodeSpec, encodeSpec, foldStatus, wasV1 } from '@/lib/specv2'
import type { Spec, Status } from '@/lib/model'

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

    it('режим раздачи by — только у balance и только не случайный', () => {
        const d = encodeSpec(base({
            outputs: {
                direct: { name: 'direct', kind: 'direct' },
                a: { name: 'a', kind: 'interface', device: 'wg0' },
                b: { name: 'b', kind: 'interface', device: 'wg1' },
                s: { name: 's', kind: 'group', pick: 'balance', members: ['a', 'b'], by: 'site' },
                sc: { name: 'sc', kind: 'group', pick: 'balance', members: ['a', 'b'], by: 'site_client', weights: [1, 2] },
                c: { name: 'c', kind: 'group', pick: 'balance', members: ['a', 'b'], by: 'connection' },
                o: { name: 'o', kind: 'group', pick: 'order', members: ['a', 'b'], by: 'site' },
            },
        })) as { outputs: Record<string, Record<string, unknown>> }
        expect(d.outputs.s).toEqual({ kind: 'group', pick: 'balance', members: ['a', 'b'], by: 'site' })
        expect(d.outputs.sc).toEqual({ kind: 'group', pick: 'balance', members: ['a', 'b'], weights: [1, 2], by: 'site_client' })
        expect('by' in d.outputs.c).toBe(false)
        expect('by' in d.outputs.o).toBe(false)
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

    it('состояние: пул-группа сворачивается в выход со списком устройств, члены уходят', () => {
        const st = {
            schema: 1, channels: [],
            outputs: {
                vpn: { kind: 'group', up: true, device: 'wg0', devices: ['wg0', 'wg1'], group: { pick: 'order', members: ['vpn.wg0', 'vpn.wg1'], selected: 'vpn.wg0', alive: ['vpn.wg0'] } },
                'vpn.wg0': { kind: 'interface', device: 'wg0', up: true },
                'vpn.wg1': { kind: 'interface', device: 'wg1', up: false },
                eu: { kind: 'group', group: { pick: 'manual', members: ['a', 'b'], selected: 'a', alive: ['a'] } },
                a: { kind: 'interface', device: 'wg2' }, b: { kind: 'interface', device: 'wg3' },
            },
        } as unknown as Status
        const f = foldStatus(st)
        expect(Object.keys(f.outputs)).toEqual(['vpn', 'eu', 'a', 'b'])
        expect(f.outputs.vpn).toMatchObject({ kind: 'interface', devices: ['wg0', 'wg1'], up: true })
        expect('group' in f.outputs.vpn).toBe(false)
        expect(f.outputs.eu.kind).toBe('group')
    })

    it('by группы — поле модели, а не незнакомый ключ', () => {
        const v2 = {
            version: 2,
            outputs: {
                a: { kind: 'interface', device: 'wg0' },
                b: { kind: 'interface', device: 'wg1' },
                s: { kind: 'group', pick: 'balance', members: ['a', 'b'], by: 'site_client' },
            },
            rules: [],
        }
        const ui = decodeSpec(v2)
        expect(ui.outputs.s.by).toBe('site_client')
        expect(ui.outputs.s.extra).toBeUndefined()
        expect((encodeSpec(ui) as { outputs: Record<string, unknown> }).outputs.s).toEqual(v2.outputs.s)
    })

    it('неизвестные ключи выхода доезжают обратно', () => {
        const s = decodeSpec({ version: 2, outputs: { w: { kind: 'interface', device: 'wg0', будущее: 7 } } })
        expect((encodeSpec(s).outputs as Record<string, Record<string, unknown>>).w.будущее).toBe(7)
    })

    it('туннель прокси-протокола (trojan, shadowsocks, socks, http, vmess, незнакомый) доезжает обратно как есть', () => {
        for (const protocol of ['trojan', 'shadowsocks', 'socks', 'http', 'vmess', 'будущий']) {
            const t = {
                kind: 'tunnel', protocol, subscription: '/etc/steer/subs/p.txt', nodes: [2, 0], device: 'px0',
                insecure: true, on_fail: 'direct', over: 'wg0',
            }
            const s = decodeSpec({ version: 2, outputs: { wg0: { kind: 'interface', device: 'wg0' }, p: t } })
            expect(s.outputs.p.kind).not.toBe('vless')
            expect((encodeSpec(s).outputs as Record<string, Record<string, unknown>>).p).toEqual(t)
        }
    })

    it('прокси steer-proxy — свои виды выхода: подписка, узлы и insecure в модели, а не в extra', () => {
        for (const protocol of ['trojan', 'vmess', 'http']) {
            const s = decodeSpec({ version: 2, outputs: {
                p: { kind: 'tunnel', protocol, subscription: '/etc/steer/subs/p.txt', nodes: [1], insecure: true },
            } })
            expect(s.outputs.p).toMatchObject({ kind: protocol, sub_file: '/etc/steer/subs/p.txt', nodes: [1], insecure: true })
            expect(s.outputs.p.extra).toBeUndefined()
            /* Снятый переключатель — ключа нет: ядро читает отсутствие как «проверять». */
            const off = encodeSpec({ ...s, outputs: { ...s.outputs, p: { ...s.outputs.p, insecure: false } } })
            expect((off.outputs as Record<string, Record<string, unknown>>).p.insecure).toBeUndefined()
        }
        for (const protocol of ['shadowsocks', 'socks']) {
            const s = decodeSpec({ version: 2, outputs: { p: { kind: 'tunnel', protocol, subscription: '/s.txt' } } })
            expect(s.outputs.p.kind).toBe(protocol)
            /* У ss и socks TLS нет — insecure им модель не пишет, даже если поле стоит. */
            const doc = encodeSpec({ ...s, outputs: { ...s.outputs, p: { ...s.outputs.p, insecure: true } } })
            expect((doc.outputs as Record<string, Record<string, unknown>>).p).toEqual({ kind: 'tunnel', protocol, subscription: '/s.txt' })
        }
        const v = decodeSpec({ version: 2, outputs: { v: { kind: 'tunnel', protocol: 'vless', subscription: '/s.txt', insecure: true } } })
        expect(v.outputs.v.insecure).toBe(true)
    })

    it('часть пула на подписке прокси узнаётся частью, как у vless', () => {
        const doc = {
            version: 2,
            outputs: {
                'vpn-1': { kind: 'tunnel', protocol: 'trojan', subscription: '/s.txt', nodes: [0] },
                'vpn-2': { kind: 'tunnel', protocol: 'shadowsocks', subscription: '/s.txt' },
                'vpn.vpn-1': { kind: 'interface', device: 'vpn-1' },
                'vpn.vpn-2': { kind: 'interface', device: 'vpn-2' },
                vpn: { kind: 'group', members: ['vpn.vpn-1', 'vpn.vpn-2'], pick: 'order' },
            },
            rules: [{ name: 'r', lists: [], out: 'vpn' }],
        }
        const s = decodeSpec(doc)
        expect(s.outputs.vpn.devices).toEqual(['vpn-1', 'vpn-2'])
        expect(s.outputs['vpn-1']).toMatchObject({ kind: 'trojan', part_of: 'vpn' })
        expect(s.outputs['vpn-2']).toMatchObject({ kind: 'shadowsocks', part_of: 'vpn' })
    })
})

describe('ключи, которых модель не знает, доезжают обратно', () => {
    /* Документ в той форме, в какой его пишет encodeSpec (имена списков и клиентов — по имени
     * правила), поэтому круг обязан вернуть его дословно. */
    const doc = {
        version: 2,
        lan: { devices: ['br-lan'], будущее_lan: 1 },
        outputs: { direct: { kind: 'direct' }, wg0: { kind: 'interface', device: 'wg0' } },
        clients: { yt: { addr: ['192.168.1.50'] }, phone: { uid: ['10123', '10200-10299'] } },
        lists: {
            yt: { domains_file: ['/l/yt.lst'], override_port: 8443 },
            inl: { domains: ['corp.example'], prefixes: ['10.20.0.0/16'] },
            all1: { all: true, proto: 'udp', ports: ['443'], будущее_all: 2 },
        },
        dns: {
            mode: 'fakeip', будущее_dns: true, cache_ttl: { min: 5, будущее_ttl: 1 },
            upstream: 'g', upstreams: { g: { url: 'https://dns.google/dns-query', будущее_up: 2 } },
        },
        rules: [
            { name: 'yt', for: 'yt', to: ['yt'], out: 'wg0', будущее_правила: 'x', dns: { url: 'tls://one.one.one.one', будущее_up: 3 } },
            { name: 'app', for: 'phone', to: ['inl'], out: 'wg0' },
            { name: 'all1', to: ['all1'], out: 'wg0' },
        ],
        будущее: { a: 1 },
    }

    it('lists, clients, rules, dns, upstreams, lan и верхний уровень — круг без потерь', () => {
        expect(encodeSpec(decodeSpec(doc))).toEqual(doc)
    })

    it('override_port списка не теряется и не растекается на соседние файлы правила', () => {
        const ui: Spec = base({
            outputs: { direct: { name: 'direct', kind: 'direct' }, wg0: { name: 'wg0', kind: 'interface', device: 'wg0' } },
            channels: [decodeSpec(doc).channels[0]],
        })
        ui.channels[0].match.domains_files = ['/l/yt.lst', '/l/other.lst']
        const d = encodeSpec(ui) as { lists: Record<string, Record<string, unknown>>; rules: { name: string; to: string[] }[] }
        /* Списки с разной подменой порта ядро в одном правиле не сводит — у второго своё правило. */
        expect(d.rules).toHaveLength(2)
        const lists = d.rules.map((r) => d.lists[r.to[0]])
        expect(lists).toContainEqual({ domains_file: ['/l/other.lst'] })
        expect(lists).toContainEqual({ domains_file: ['/l/yt.lst'], override_port: 8443 })
        const back = decodeSpec(d)
        expect(back.channels).toHaveLength(1)
        expect(encodeSpec(back)).toEqual(d)
    })

    it('сужение у набора .srs не теряется', () => {
        const v = {
            version: 2,
            outputs: { wg0: { kind: 'interface', device: 'wg0' } },
            lists: { dc: { srs: ['/l/dc.srs'], proto: 'udp', ports: ['50000-65535'] } },
            rules: [{ name: 'dc', to: ['dc'], out: 'wg0' }],
        }
        const d = encodeSpec(decodeSpec(v)) as { lists: Record<string, unknown> }
        expect(Object.values(d.lists)).toEqual([{ srs: ['/l/dc.srs'], proto: 'udp', ports: ['50000-65535'] }])
    })
})

describe('правило и на адреса, и на MAC', () => {
    const ui = (narrow = false): Spec => base({
        outputs: { direct: { name: 'direct', kind: 'direct' }, wg0: { name: 'wg0', kind: 'interface', device: 'wg0' } },
        channels: [{
            name: 'dom', out: 'wg0', from: ['192.168.1.50', 'aa:bb:cc:dd:ee:01'],
            match: { domains_files: ['/l/a.lst'], ...(narrow ? { prefixes_files: ['/l/dc.lst'] } : {}) },
            ...(narrow ? { narrow: { '/l/dc.lst': { proto: 'udp' as const, ports: ['50000-65535'] } } } : {}),
        }],
    })

    it('ядру уходит двумя правилами — адреса и MAC, остальное одинаково', () => {
        const d = encodeSpec(ui()) as { clients: Record<string, Record<string, unknown>>; rules: Record<string, unknown>[] }
        expect(d.rules).toHaveLength(2)
        const [a, m] = d.rules
        expect(d.clients[a.for as string]).toEqual({ addr: ['192.168.1.50'] })
        expect(d.clients[m.for as string]).toEqual({ mac: ['aa:bb:cc:dd:ee:01'] })
        const { for: _a, ...ra } = a
        const { for: _m, ...rm } = m
        expect(rm).toEqual(ra)
    })

    it('при чтении склеивается обратно в одно правило, и круг ничего не меняет', () => {
        for (const narrow of [false, true]) {
            const d = encodeSpec(ui(narrow))
            const back = decodeSpec(d)
            expect(back.channels).toHaveLength(1)
            expect(back.channels[0].from).toEqual(['192.168.1.50', 'aa:bb:cc:dd:ee:01'])
            expect(encodeSpec(back)).toEqual(d)
        }
    })

    it('соседние правила с одним именем на одних адресах не склеиваются', () => {
        const back = decodeSpec({
            version: 2,
            outputs: { wg0: { kind: 'interface', device: 'wg0' } },
            clients: { a: { addr: ['192.168.1.50'] }, b: { addr: ['192.168.1.51'] } },
            lists: { l: { domains_file: ['/l/a.lst'] } },
            rules: [{ name: 'x', for: 'a', to: ['l'], out: 'wg0' }, { name: 'x', for: 'b', to: ['l'], out: 'wg0' }],
        })
        expect(back.channels).toHaveLength(2)
    })
})


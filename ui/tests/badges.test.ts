import { describe, expect, it } from 'vitest'
import {
    commonBadges, devKindsOf, devProto, nodeBadges, outNodes, outputBadges, outputProto, poolBadges, PROTO_NAME, PROTO_TONE,
    type ConfBadge,
} from '@/lib/badges'
import type { Spec } from '@/lib/model'

// Разбор полей узла и выхода в бейджи конфигурации (lib/badges.ts). Поля — как их печатает ядро:
// vlmain.c / hy2main.c / pxmain.c `node_json`, `steer status` (объекты hysteria2 и proxy).
// Данные синтетические.

const texts = (l: ConfBadge[]) => l.map((b) => b.text)

describe('бейджи узла VLESS', () => {
    it('TCP · Reality · Vision — в порядке протокол → транспорт → защита → особенности', () => {
        const l = nodeBadges({ type: 'tcp', security: 'reality', vision: true })
        expect(texts(l)).toEqual(['VLESS', 'TCP', 'Reality', 'Vision'])
        expect(l[0]).toMatchObject({ group: 'proto', proto: 'vless' })
        expect(l.map((b) => b.group)).toEqual(['proto', 'transport', 'security', 'feature'])
    })

    it('XHTTP с режимом: packet-up/stream-up/stream-one названы, auto — нет', () => {
        expect(texts(nodeBadges({ type: 'xhttp', security: 'reality', vision: false, mode: 'packet-up' })))
            .toEqual(['VLESS', 'XHTTP', 'packet-up', 'Reality'])
        expect(texts(nodeBadges({ type: 'xhttp', security: 'tls', mode: 'stream-one' })))
            .toEqual(['VLESS', 'XHTTP', 'stream-one', 'TLS'])
        expect(texts(nodeBadges({ type: 'xhttp', security: 'tls', mode: 'auto' }))).toEqual(['VLESS', 'XHTTP', 'TLS'])
    })

    it('режим grpc (multi/gun) отдельным бейджем не называется', () => {
        expect(texts(nodeBadges({ type: 'grpc', security: 'reality', mode: 'multi' }))).toEqual(['VLESS', 'gRPC', 'Reality'])
    })

    it('транспорты: WebSocket, HTTPUpgrade, незнакомый — как пришёл', () => {
        expect(texts(nodeBadges({ type: 'ws', security: 'tls' }))).toEqual(['VLESS', 'WebSocket', 'TLS'])
        expect(texts(nodeBadges({ type: 'httpupgrade', security: 'tls' }))).toEqual(['VLESS', 'HTTPUpgrade', 'TLS'])
        expect(texts(nodeBadges({ type: 'meek', security: 'tls' }))).toEqual(['VLESS', 'meek', 'TLS'])
    })

    it('без TLS и без encryption — «без шифрования»; с encryption mlkem — «постквантовое»', () => {
        expect(texts(nodeBadges({ type: 'tcp', security: 'none' }))).toEqual(['VLESS', 'TCP', 'без шифрования'])
        expect(texts(nodeBadges({ type: 'tcp', security: 'none', encryption: 'mlkem768x25519plus.native.0rtt' })))
            .toEqual(['VLESS', 'TCP', 'постквантовое'])
    })

    it('pqv у Reality — «постквантовое»', () => {
        expect(texts(nodeBadges({ type: 'tcp', security: 'reality', vision: true, pqv: true })))
            .toEqual(['VLESS', 'TCP', 'Reality', 'Vision', 'постквантовое'])
    })

    it('insecure выхода касается только узлов с TLS, и это предупреждение', () => {
        const tls = nodeBadges({ type: 'ws', security: 'tls' }, 'vless', { insecure: true })
        expect(texts(tls)).toEqual(['VLESS', 'WebSocket', 'TLS', 'сертификат не проверяется'])
        expect(tls[tls.length - 1].warn).toBe(true)
        expect(texts(nodeBadges({ type: 'tcp', security: 'reality' }, 'vless', { insecure: true })))
            .not.toContain('сертификат не проверяется')
    })

    it('поля отсутствуют (ядро постарше): только протокол и то, что есть', () => {
        expect(texts(nodeBadges({}))).toEqual(['VLESS'])
        expect(texts(nodeBadges({ type: 'grpc' }))).toEqual(['VLESS', 'gRPC'])
        expect(nodeBadges(null)).toEqual([])
        expect(nodeBadges(undefined)).toEqual([])
    })
})

describe('бейджи узла hysteria2', () => {
    const hy = { type: 'hysteria2', security: 'tls', vision: false, obfs: '', pinned: false, insecure: false, hop: false, up_bps: 0, down_bps: 0 }

    it('без полосы — BBR, с полосой — Brutal; TLS у hysteria2 не называется', () => {
        expect(texts(nodeBadges(hy))).toEqual(['Hysteria2', 'BBR'])
        expect(texts(nodeBadges({ ...hy, up_bps: 50_000_000 }))).toEqual(['Hysteria2', 'Brutal'])
        expect(texts(nodeBadges({ ...hy, down_bps: 1 }))).toEqual(['Hysteria2', 'Brutal'])
    })

    it('Salamander, Gecko, смена портов, закреплённый сертификат, insecure', () => {
        expect(texts(nodeBadges({ ...hy, obfs: 'salamander', hop: true, pinned: true })))
            .toEqual(['Hysteria2', 'Salamander', 'смена портов', 'BBR', 'сертификат закреплён'])
        const g = nodeBadges({ ...hy, obfs: 'gecko', insecure: true })
        expect(texts(g)).toEqual(['Hysteria2', 'Gecko', 'BBR', 'сертификат не проверяется'])
        expect(g.find((b) => b.warn)?.text).toBe('сертификат не проверяется')
    })

    it('протокол — по полю type, без подсказки вызывающего', () => {
        expect(nodeBadges(hy)[0]).toMatchObject({ proto: 'hysteria2', text: 'Hysteria2' })
    })

    it('ядро без полей полосы — управление перегрузкой не угадывается', () => {
        expect(texts(nodeBadges({ type: 'hysteria2' }))).toEqual(['Hysteria2'])
    })
})

describe('бейджи узла прокси steer-proxy', () => {
    it('Trojan: транспорт и TLS', () => {
        expect(texts(nodeBadges({ type: 'trojan', security: 'tls', transport: 'tcp' }))).toEqual(['Trojan', 'TCP', 'TLS'])
        expect(texts(nodeBadges({ type: 'trojan', security: 'tls', transport: 'grpc' }))).toEqual(['Trojan', 'gRPC', 'TLS'])
    })

    it('VMess без TLS — шифрование своё, «без шифрования» не пишется', () => {
        expect(texts(nodeBadges({ type: 'vmess', security: 'none', transport: 'ws' }))).toEqual(['VMess', 'WebSocket'])
    })

    it('Shadowsocks: TCP не называется; шифр — если ядро прислало method; 2022 — отдельной пометкой', () => {
        expect(texts(nodeBadges({ type: 'shadowsocks', security: 'none', transport: 'tcp' }))).toEqual(['Shadowsocks'])
        expect(texts(nodeBadges({ type: 'shadowsocks', security: 'none', transport: 'tcp', method: 'chacha20-ietf-poly1305' })))
            .toEqual(['Shadowsocks', 'ChaCha20-Poly1305'])
        expect(texts(nodeBadges({ type: 'shadowsocks', security: 'none', transport: 'tcp', method: '2022-blake3-aes-128-gcm' })))
            .toEqual(['Shadowsocks', '2022', 'AES-128-GCM'])
        expect(texts(nodeBadges({ type: 'shadowsocks', method: 'rc4-md5-x' }))).toEqual(['Shadowsocks', 'rc4-md5-x'])
        expect(texts(nodeBadges({ type: 'shadowsocks', method: 'none' }))).toEqual(['Shadowsocks', 'без шифрования'])
    })

    it('SOCKS и HTTP: без TLS — «без шифрования», HTTP с TLS — TLS', () => {
        expect(texts(nodeBadges({ type: 'socks', security: 'none', transport: 'tcp' }))).toEqual(['SOCKS', 'без шифрования'])
        expect(texts(nodeBadges({ type: 'http', security: 'tls', transport: 'tcp' }))).toEqual(['HTTP', 'TLS'])
        expect(texts(nodeBadges({ type: 'http', security: 'tls', transport: 'tcp' }, 'http', { insecure: true })))
            .toEqual(['HTTP', 'TLS', 'сертификат не проверяется'])
    })

    it('протокол вызывающего важнее поля type', () => {
        expect(nodeBadges({ type: 'tcp', security: 'tls' }, 'trojan')[0].proto).toBe('trojan')
        expect(nodeBadges({ type: 'ss' })[0].proto).toBe('shadowsocks')
    })
})

describe('общие бейджи и узлы выхода', () => {
    it('commonBadges — пересечение, порядок по первому набору', () => {
        const a = nodeBadges({ type: 'xhttp', security: 'reality', mode: 'packet-up' })
        const b = nodeBadges({ type: 'xhttp', security: 'reality' })
        const c = nodeBadges({ type: 'grpc', security: 'reality' })
        expect(texts(commonBadges([a, b]))).toEqual(['VLESS', 'XHTTP', 'Reality'])
        expect(texts(commonBadges([a, b, c]))).toEqual(['VLESS', 'Reality'])
        expect(commonBadges([])).toEqual([])
    })

    it('outNodes: узел из состояния, иначе выбранные, иначе все', () => {
        const r = {
            nodes: [
                { index: 0, name: 'A', type: 'tcp' },
                { index: 1, name: 'B', type: 'grpc' },
                { index: 2, name: 'C', type: 'xhttp' },
            ],
            chosen: [2],
            node: -1,
        }
        expect(outNodes(r, 'B')).toEqual([r.nodes[1]])
        expect(outNodes(r, 'нет такого')).toEqual([r.nodes[2]])
        expect(outNodes({ ...r, chosen: [], node: 0 })).toEqual([r.nodes[0]])
        expect(outNodes({ ...r, chosen: [] })).toEqual(r.nodes)
        expect(outNodes(null)).toEqual([])
    })
})

describe('бейджи выхода', () => {
    it('протокол по виду, по protocol туннеля и по устройству своего туннеля', () => {
        expect(outputProto({ kind: 'vless' })).toBe('vless')
        expect(outputProto({ kind: 'tunnel', protocol: 'trojan' })).toBe('trojan')
        expect(outputProto({ kind: 'awg' })).toBe('awg')
        expect(outputProto({ kind: 'xsteer' })).toBe('xsteer')
        expect(outputProto({ kind: 'interface' }, null, 'wireguard')).toBe('wireguard')
        expect(outputProto({ kind: 'interface' }, null, 'amneziawg')).toBe('awg')
        expect(outputProto({ kind: 'interface' }, null, 'tun')).toBeNull()
        expect(outputProto(null, { kind: 'tunnel', proxy: { node: 'x', protocol: 'vmess', up: true } })).toBe('vmess')
        expect(devProto('wireguard')).toBe('wireguard')
        expect(devProto(undefined)).toBeNull()
        expect(devKindsOf([{ name: 'wg0', kind: 'wireguard' }, { name: 'vpn', kind: 'tun' }, { name: 'x', kind: '' }]))
            .toEqual({ wg0: 'wireguard' })
        expect(devKindsOf([{ name: 'vpn', kind: 'tun' }])).toBeNull()
        expect(devKindsOf(undefined)).toBeNull()
    })

    it('VLESS без узлов: протокол и фильтр транспорта спеки', () => {
        expect(texts(outputBadges({ out: { name: 'v', kind: 'vless', transport: ['xhttp', 'grpc'] } })))
            .toEqual(['VLESS', 'XHTTP', 'gRPC'])
    })

    it('VLESS с узлами: общее у узлов, insecure выхода — предупреждением', () => {
        const nodes = [{ type: 'ws', security: 'tls' }, { type: 'ws', security: 'tls' }]
        const l = outputBadges({ out: { name: 'v', kind: 'vless', insecure: true }, nodes })
        expect(texts(l)).toEqual(['VLESS', 'WebSocket', 'TLS', 'сертификат не проверяется'])
        expect(texts(outputBadges({ out: { name: 'v', kind: 'vless' }, st: { name: 'v', insecure: true } })))
            .toEqual(['VLESS', 'сертификат не проверяется'])
    })

    it('hysteria2 под клиентом: обфускация, смена портов и BBR/Brutal из status', () => {
        const st = { name: 'hy', kind: 'hysteria2', hysteria2: { node: 'X', up: true, cc: 'brutal', obfs: 'salamander', hop: true } }
        expect(texts(outputBadges({ out: { name: 'hy', kind: 'hysteria2' }, st })))
            .toEqual(['Hysteria2', 'Salamander', 'смена портов', 'Brutal'])
        /* Узел из подписки говорил BBR — клиент знает лучше. */
        const nodes = [{ type: 'hysteria2', obfs: '', hop: false, up_bps: 0, down_bps: 0 }]
        expect(texts(outputBadges({ out: { name: 'hy', kind: 'hysteria2' }, st: { ...st, hysteria2: { node: 'X', up: true, cc: 'brutal' } }, nodes })))
            .toEqual(['Hysteria2', 'Brutal'])
    })

    it('особенности в постоянном порядке, откуда бы ни пришли: BBR из status — до «сертификат закреплён» узла', () => {
        const st = { name: 'hy', kind: 'hysteria2', hysteria2: { node: 'X', up: true, cc: 'bbr' } }
        const nodes = [{ type: 'hysteria2', obfs: 'salamander', hop: true, pinned: true }]
        expect(texts(outputBadges({ out: { name: 'hy', kind: 'hysteria2' }, st, nodes })))
            .toEqual(['Hysteria2', 'Salamander', 'смена портов', 'BBR', 'сертификат закреплён'])
    })

    it('trojan с insecure в спеке (ядро в status его не печатает) — предупреждение; shadowsocks — нет', () => {
        expect(texts(outputBadges({ out: { name: 't', kind: 'trojan', insecure: true } }))).toEqual(['Trojan', 'сертификат не проверяется'])
        expect(texts(outputBadges({ out: { name: 's', kind: 'shadowsocks', insecure: true } }))).toEqual(['Shadowsocks'])
    })

    it('выход без протокола (direct, группа, мост) — без бейджей; интерфейс с поддельным TCP — отметка', () => {
        expect(outputBadges({ out: { name: 'd', kind: 'direct' } })).toEqual([])
        expect(outputBadges({ out: { name: 'g', kind: 'group' } })).toEqual([])
        expect(texts(outputBadges({ out: { name: 'w', kind: 'interface', obfs: { server: '1.2.3.4:443', listen: '127.0.0.1:51821' } }, devKind: 'wireguard' })))
            .toEqual(['WireGuard', 'поддельный TCP'])
    })

    it('пул: протоколы строк без повторов, insecure части — предупреждением', () => {
        const spec: Spec = {
            outputs: {
                vpn: { name: 'vpn', kind: 'interface', devices: ['vpn-1', 'awg1', 'wg0', 'vpn-2'] },
                'vpn-1': { name: 'vpn-1', kind: 'vless', part_of: 'vpn', sub_file: '/a', insecure: true },
                'vpn-2': { name: 'vpn-2', kind: 'hysteria2', part_of: 'vpn', sub_file: '/a' },
                awg1: { name: 'awg1', kind: 'awg' },
            },
            channels: [],
        }
        expect(texts(poolBadges(spec, 'vpn', { wg0: 'wireguard' })))
            .toEqual(['VLESS', 'AmneziaWG', 'WireGuard', 'Hysteria2', 'сертификат не проверяется'])
        expect(poolBadges(spec, 'нет', {})).toEqual([])
        /* Один свой туннель — по виду устройства. */
        const one: Spec = { outputs: { w: { name: 'w', kind: 'interface', device: 'wg0' } }, channels: [] }
        expect(texts(poolBadges(one, 'w', { wg0: 'wireguard' }))).toEqual(['WireGuard'])
        expect(poolBadges(one, 'w', {})).toEqual([])
    })

    it('у каждого протокола имя и тон категориальной шкалы', () => {
        for (const p of Object.keys(PROTO_NAME) as (keyof typeof PROTO_NAME)[]) {
            expect(PROTO_NAME[p]).toBeTruthy()
            expect(PROTO_TONE[p]).toBeGreaterThanOrEqual(1)
            expect(PROTO_TONE[p]).toBeLessThanOrEqual(7)
        }
    })
})

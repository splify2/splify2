import { render, screen, waitFor, within } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PoolEditor from '@/components/PoolEditor'
import PoolList from '@/components/PoolList'
import { SubBlock, TunnelBlock } from '@/components/OutputCards'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import type { OutputStatus, Spec } from '@/lib/model'
import { live } from './fixtures'

// Бейджи конфигурации там, где человек видит и выбирает узел и выход: строки узлов подписки в
// редакторе выхода, порядок предпочтения, локации и свои туннели на главной, строки «Выходов».
// Поля узлов — как их печатает ядро (vlmain.c / hy2main.c / pxmain.c `node_json`). Данные
// синтетические.

const SUB = { name: 'main', title: 'Смешанная', path: '/etc/steer/sub.txt', present: true, kind: 'links' }
const vlessNodes = [
    { index: 0, name: '🇩🇪 Дэ-1', host: 'a', port: 443, type: 'tcp', security: 'reality', vision: true },
    { index: 1, name: '🇫🇮 Фи-1', host: 'b', port: 443, type: 'xhttp', security: 'reality', vision: false, mode: 'packet-up' },
]
const hyNodes = [
    { index: 0, name: '🇳🇱 Эн-1', host: 'c', port: 443, type: 'hysteria2', security: 'tls', vision: false, obfs: 'salamander', pinned: false, insecure: false, hop: true, up_bps: 0, down_bps: 0 },
]
const pxNodes = [
    { index: 0, name: '🇵🇱 Пэ-1', host: 'd', port: 443, type: 'trojan', security: 'tls', transport: 'grpc' },
    { index: 1, name: '🇸🇪 Эс-1', host: 'e', port: 8388, type: 'shadowsocks', security: 'none', transport: 'tcp', method: '2022-blake3-aes-256-gcm' },
]
const reply = (nodes: unknown[], extra: Record<string, unknown> = {}) =>
    ({ output: '', sub_file: SUB.path, node: -1, chosen: [], usable: nodes.length, skipped: 0, foreign: 0, nodes, ...extra }) as never

const withPools = live({
    status: { schema: 1, features: ['lan_devices', 'nodes', 'pool', 'groups'], outputs: {}, channels: [] },
    build: { modules: ['vless', 'hysteria2', 'proxy'] },
})

/** Тексты бейджей внутри элемента — по порядку. */
const badgeTexts = (el: HTMLElement) => Array.from(el.querySelectorAll('.sp-cb')).map((b) => b.textContent)

beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    document.body.innerHTML = ''
})

describe('редактор выхода: бейджи узлов подписки', () => {
    beforeEach(() => {
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [{ name: 'wg0', up: true, kind: 'wireguard' }] })
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [SUB] } as never)
        vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue(reply(vlessNodes, { foreign: 3 }))
        vi.spyOn(rpc, 'hysteria2NodesOfSub').mockResolvedValue(reply(hyNodes))
        vi.spyOn(rpc, 'proxyNodesOfSub').mockResolvedValue(reply(pxNodes))
    })

    it('у каждого узла — протокол, транспорт, защита и особенности в его строке', async () => {
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={withPools} onCancel={() => {}} onSave={() => {}} />)
        const de = await screen.findByRole('button', { name: /Дэ-1/ })
        expect(badgeTexts(de)).toEqual(['VLESS', 'TCP', 'Reality', 'Vision'])
        expect(badgeTexts(screen.getByRole('button', { name: /Фи-1/ }))).toEqual(['VLESS', 'XHTTP', 'packet-up', 'Reality'])
        expect(badgeTexts(screen.getByRole('button', { name: /Эн-1/ }))).toEqual(['Hysteria2', 'Salamander', 'смена портов', 'BBR'])
        expect(badgeTexts(screen.getByRole('button', { name: /Пэ-1/ }))).toEqual(['Trojan', 'gRPC', 'TLS'])
        expect(badgeTexts(screen.getByRole('button', { name: /Эс-1/ }))).toEqual(['Shadowsocks', '2022', 'AES-256-GCM'])
        /* Протокол — тоном категориальной шкалы, остальное нейтральное. */
        const proto = de.querySelector('.sp-cb')!
        expect(proto.className).toContain('sp-cb-proto')
        expect(proto.getAttribute('data-tone')).toBe('1')
        expect(de.querySelectorAll('.sp-cb-tag').length).toBe(3)
        /* Свой туннель — протокол по виду устройства. */
        expect(badgeTexts(screen.getByRole('button', { name: /wg0/ }))).toEqual(['WireGuard'])
    })

    it('поля ядра 2.0 у узла: шифр VMess, сертификат узла не проверяется, отпечаток — подсказкой у TLS', async () => {
        vi.spyOn(rpc, 'proxyNodesOfSub').mockResolvedValue(reply([
            { index: 0, name: '🇵🇱 Пэ-2', host: 'd', port: 443, type: 'trojan', security: 'tls', transport: 'tcp', fp: 'chrome', insecure: true },
            { index: 1, name: '🇸🇪 Вэ-2', host: 'e', port: 443, type: 'vmess', security: 'tls', transport: 'ws', cipher: 'chacha20-poly1305' },
        ]))
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={withPools} onCancel={() => {}} onSave={() => {}} />)
        const tr = await screen.findByRole('button', { name: /Пэ-2/ })
        expect(badgeTexts(tr)).toEqual(['Trojan', 'TCP', 'TLS', 'сертификат не проверяется'])
        expect(tr.querySelector('.sp-cb-warn')?.textContent).toBe('сертификат не проверяется')
        expect(Array.from(tr.querySelectorAll('.sp-cb')).find((b) => b.textContent === 'TLS')?.getAttribute('title')).toBe('отпечаток chrome')
        expect(badgeTexts(screen.getByRole('button', { name: /Вэ-2/ }))).toEqual(['VMess', 'WebSocket', 'TLS', 'ChaCha20-Poly1305'])
    })

    it('«любая рабочая» — общее у всех узлов протокола; в порядке предпочтения — бейджи строки', async () => {
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={withPools} onCancel={() => {}} onSave={() => {}} />)
        await screen.findByRole('button', { name: /Дэ-1/ })
        const any = screen.getAllByRole('button', { name: /^любая рабочая/ })[0]
        expect(badgeTexts(any)).toEqual(['VLESS', 'Reality'])
        ;(screen.getByRole('button', { name: /Фи-1/ })).click()
        const order = await screen.findByRole('list', { name: /порядок/i })
        await waitFor(() => expect(badgeTexts(order)).toEqual(['VLESS', 'XHTTP', 'packet-up', 'Reality']))
    })

    it('«не проверять сертификат» у выхода — предупреждение у узлов с TLS', async () => {
        const spec: Spec = {
            outputs: { vpn: { name: 'vpn', kind: 'trojan', sub_file: SUB.path, nodes: [0], insecure: true, on_fail: 'drop' } },
            channels: [],
        }
        render(<PoolEditor spec={spec} name="vpn" live={withPools} onCancel={() => {}} onSave={() => {}} />)
        const tr = await screen.findByRole('button', { name: /Пэ-1/ })
        await waitFor(() => expect(badgeTexts(tr)).toEqual(['Trojan', 'gRPC', 'TLS', 'сертификат не проверяется']))
        expect(tr.querySelector('.sp-cb-warn')?.textContent).toBe('сертификат не проверяется')
        /* У Reality проверять нечего — предупреждения нет. */
        expect(badgeTexts(screen.getByRole('button', { name: /Дэ-1/ }))).not.toContain('сертификат не проверяется')
    })
})

describe('главная: бейджи выходов', () => {
    it('локация VLESS — бейджи выбранного узла, insecure — предупреждением, а не припиской', async () => {
        vi.spyOn(rpc, 'subInfo').mockResolvedValue({ kind: 'links', path: SUB.path, present: true } as never)
        vi.spyOn(rpc, 'vlessNodes').mockResolvedValue(reply([{ ...vlessNodes[0], security: 'tls', type: 'ws', vision: false }], { chosen: [0], node: 0 }))
        const st: OutputStatus = { name: 'vpn', kind: 'vless', device: 'vpn', up: true, insecure: true }
        render(<SubBlock outs={[{ name: 'vpn', st, out: { name: 'vpn', kind: 'vless', sub_file: SUB.path } }]} />)
        await waitFor(() => expect(screen.getByText('WebSocket')).toBeInTheDocument())
        const row = screen.getByText('WebSocket').closest('li')!
        expect(badgeTexts(row)).toEqual(['VLESS', 'WebSocket', 'TLS', 'сертификат не проверяется'])
        expect(within(row).getByText('Германия')).toBeInTheDocument()
    })

    it('локация hysteria2 — по состоянию клиента и его узлу', async () => {
        vi.spyOn(rpc, 'subInfo').mockResolvedValue({ kind: 'links', path: SUB.path, present: true } as never)
        const hy = vi.spyOn(rpc, 'hysteria2Nodes').mockResolvedValue(reply(hyNodes))
        const st: OutputStatus = {
            name: 'hy', kind: 'hysteria2', device: 'hy', up: true,
            hysteria2: { node: '🇳🇱 Эн-1', up: true, cc: 'brutal', obfs: 'salamander', hop: true },
        }
        render(<SubBlock outs={[{ name: 'hy', st }]} />)
        await waitFor(() => expect(screen.getByText('Brutal')).toBeInTheDocument())
        expect(hy).toHaveBeenCalledWith('hy')
        expect(badgeTexts(screen.getByText('Brutal').closest('li')!)).toEqual(['Hysteria2', 'Salamander', 'смена портов', 'Brutal'])
    })

    it('бейджи стоят и у выхода, который не поднят', async () => {
        vi.spyOn(rpc, 'subInfo').mockResolvedValue({ kind: 'links', path: SUB.path, present: true } as never)
        vi.spyOn(rpc, 'proxyNodes').mockResolvedValue(reply([pxNodes[0]], { chosen: [0] }))
        const st: OutputStatus = { name: 'tr', kind: 'trojan', device: 'tr', up: false }
        render(<SubBlock outs={[{ name: 'tr', st }]} />)
        await waitFor(() => expect(screen.getByText('gRPC')).toBeInTheDocument())
        expect(screen.getByText('Нет соединения')).toBeInTheDocument()
    })

    it('свой туннель — WireGuard / AmneziaWG по виду устройства', () => {
        const spec: Spec = { outputs: { home: { name: 'home', kind: 'interface', devices: ['wg0', 'awg0'] } }, channels: [] }
        const st: OutputStatus = { name: 'home', kind: 'interface', device: 'wg0', up: true }
        const { container } = render(
            <TunnelBlock name="home" st={st} out={spec.outputs.home} spec={spec} devKinds={{ wg0: 'wireguard', awg0: 'amneziawg' }} />,
        )
        expect(badgeTexts(container)).toEqual(['WireGuard', 'AmneziaWG'])
    })
})

describe('«Выходы»: бейджи в строке выхода', () => {
    it('VLESS — общее у выбранных узлов, insecure — бейджем, а не словом в подписи', async () => {
        const spec: Spec = {
            outputs: { vpn: { name: 'vpn', kind: 'vless', sub_file: SUB.path, nodes: [0, 1], insecure: true, on_fail: 'drop' } },
            channels: [],
        }
        pending.saved = spec
        pending.applied = spec
        vi.spyOn(rpc, 'outboundGeo').mockRejectedValue(new Error('нет'))
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] })
        vi.spyOn(rpc, 'vlessNodes').mockResolvedValue(reply(vlessNodes, { chosen: [0, 1] }))
        render(<PoolList live={live({ build: { modules: ['vless'] } })} />)
        const row = await screen.findByRole('button', { name: /^vpn/ })
        await waitFor(() => expect(badgeTexts(row)).toEqual(['VLESS', 'Reality']))
        /* У Reality сертификат не проверяется вовсе — insecure выхода у таких узлов не пишется;
         * словом в подписи его тоже больше нет. */
        expect(row.textContent).not.toContain('сертификат не проверяется ·')
    })

    it('свой туннель — протокол по виду устройства', async () => {
        const spec: Spec = { outputs: { home: { name: 'home', kind: 'interface', device: 'awg0', on_fail: 'drop' } }, channels: [] }
        pending.saved = spec
        pending.applied = spec
        vi.spyOn(rpc, 'outboundGeo').mockRejectedValue(new Error('нет'))
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [{ name: 'awg0', up: true, kind: 'amneziawg' }] })
        render(<PoolList live={live({})} />)
        const row = await screen.findByRole('button', { name: /^home/ })
        await waitFor(() => expect(badgeTexts(row)).toEqual(['AmneziaWG']))
    })
})

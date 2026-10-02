import { render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PoolEditor from '@/components/PoolEditor'
import { decodeSpec, encodeSpec } from '@/lib/specv2'
import { rpc } from '@/lib/rpc'
import { type Spec } from '@/lib/model'
import { live } from './fixtures'

// Подписка с прокси steer-proxy: две ссылки vless://, а между ними trojan и shadowsocks. Ядро
// по файлу подписки нумерует узлы прокси СКВОЗЬ протоколы (tr-1 = 0, ss-1 = 1, tr-2 = 2), а у
// выхода — внутри его протокола (tr-2 у выхода trojan — 1). Редактор обязан писать в выход
// второй номер, а проверку по файлу звать первым. Данные синтетические.

const SUB = { name: 'main', title: 'Прокси', path: '/etc/steer/sub.txt', present: true, kind: 'links' }
const vlessNodes = [{ index: 0, name: '🇩🇪 Вэ-1' }, { index: 1, name: '🇩🇪 Вэ-2' }]
const pxNodes = [
    { index: 0, name: '🇳🇱 Троян-1', type: 'trojan' },
    { index: 1, name: '🇫🇮 Шэдоу-1', type: 'shadowsocks' },
    { index: 2, name: '🇳🇱 Троян-2', type: 'trojan' },
]
const EMPTY: Spec = { outputs: {}, channels: [] }
const withPools = live({
    status: { schema: 1, features: ['lan_devices', 'nodes', 'pool', 'groups'], outputs: {}, channels: [] },
    build: { modules: ['vless', 'hysteria2', 'proxy'] },
})

const reply = (nodes: unknown[], foreign = 0) =>
    ({ output: '', sub_file: SUB.path, node: -1, chosen: [], usable: nodes.length, skipped: 0, foreign, nodes }) as never

const click = async (name: RegExp | string) => {
    ;(await screen.findByRole('button', { name })).click()
    await new Promise((r) => setTimeout(r, 10))
}

function mount(spec = EMPTY, name?: string) {
    let saved: Spec | null = null
    render(<PoolEditor spec={spec} name={name} live={withPools} onCancel={() => {}} onSave={(n) => { saved = n }} />)
    return () => saved
}

describe('подписка с прокси steer-proxy', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] })
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [SUB] } as never)
        vi.spyOn(rpc, 'hysteria2NodesOfSub').mockResolvedValue(reply([], 5))
    })

    it('узлы прокси показаны рядом с VLESS, у каждого — протокол', async () => {
        vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue(reply(vlessNodes, 3))
        const px = vi.spyOn(rpc, 'proxyNodesOfSub').mockResolvedValue(reply(pxNodes, 2))
        mount()
        await waitFor(() => expect(screen.getByText('локаций: 5')).toBeInTheDocument())
        expect(px).toHaveBeenCalledWith(SUB.path)
        expect(screen.getByRole('button', { name: /Троян-2/ })).toBeInTheDocument()
        expect(screen.getAllByText(/Trojan/).length).toBeGreaterThan(0)
        expect(screen.getAllByText(/Shadowsocks/).length).toBeGreaterThan(0)
        /* «Любая рабочая» — своя у каждого протокола подписки. */
        expect(screen.getByRole('button', { name: /любая рабочая \(Trojan\)/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /любая рабочая \(Shadowsocks\)/ })).toBeInTheDocument()
    })

    it('второй узел trojan — выход protocol trojan с номером 1 (среди узлов trojan), а не 2', async () => {
        vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue(reply(vlessNodes, 3))
        vi.spyOn(rpc, 'proxyNodesOfSub').mockResolvedValue(reply(pxNodes, 2))
        const saved = mount()
        await click(/Троян-2/)
        await click(/Сохранить выход/)
        expect(saved()!.outputs.vpn).toMatchObject({ kind: 'trojan', sub_file: SUB.path, node: 1 })
        const doc = encodeSpec(saved()!) as { outputs: Record<string, Record<string, unknown>> }
        expect(doc.outputs.vpn).toMatchObject({ kind: 'tunnel', protocol: 'trojan', subscription: SUB.path, nodes: [1] })
    })

    it('trojan и shadowsocks в одном выходе — пул из частей своих видов', async () => {
        vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue(reply(vlessNodes, 3))
        vi.spyOn(rpc, 'proxyNodesOfSub').mockResolvedValue(reply(pxNodes, 2))
        const saved = mount()
        await click(/Шэдоу-1/)
        await click(/Троян-1/)
        await click(/Сохранить выход/)
        const out = saved()!.outputs
        expect(out.vpn.devices).toEqual(['vpn-1', 'vpn-2'])
        expect(out['vpn-1']).toMatchObject({ kind: 'shadowsocks', node: 0, part_of: 'vpn' })
        expect(out['vpn-2']).toMatchObject({ kind: 'trojan', node: 0, part_of: 'vpn' })
        const back = decodeSpec(encodeSpec(saved()!))
        expect(back.outputs['vpn-1'].kind).toBe('shadowsocks')
        expect(back.outputs['vpn-1'].part_of).toBe('vpn')
    })

    it('проверка узла прокси идёт по файлу СКВОЗНЫМ номером, а задержка — рукопожатие', async () => {
        vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue(reply(vlessNodes, 3))
        vi.spyOn(rpc, 'proxyNodesOfSub').mockResolvedValue(reply(pxNodes, 2))
        const pr = vi.spyOn(rpc, 'proxyProbeOfSub').mockResolvedValue({
            results: [{ index: 2, name: '🇳🇱 Троян-2', type: 'trojan', ok: true, handshake_ms: 123, ttfb_ms: -1, why: 'ok' }],
            working: 2,
        })
        const vp = vi.spyOn(rpc, 'vlessProbeOfSub')
        mount()
        await waitFor(() => expect(screen.getByText('локаций: 5')).toBeInTheDocument())
        const rows = screen.getAllByRole('listitem').filter((li) => li.textContent?.includes('Троян-2'))
        ;(rows[0].querySelector('button[aria-label]') as HTMLButtonElement).click()
        await waitFor(() => expect(screen.getByText('123 мс')).toBeInTheDocument())
        expect(pr).toHaveBeenCalledWith(SUB.path, 2)
        expect(vp).not.toHaveBeenCalled()
    })

    it('модуля VLESS нет — узлы прокси всё равно спрошены и выбираются', async () => {
        vi.spyOn(rpc, 'vlessNodesOfSub').mockRejectedValue(new Error('нужен пакет steer-vless'))
        vi.spyOn(rpc, 'proxyNodesOfSub').mockResolvedValue(reply(pxNodes, 0))
        const saved = mount()
        await waitFor(() => expect(screen.getByText('локаций: 3')).toBeInTheDocument())
        await click(/Троян-1/)
        await click(/Сохранить выход/)
        expect(saved()!.outputs.vpn).toMatchObject({ kind: 'trojan', node: 0 })
    })

    it('открытый заново выход shadowsocks возвращается в ту же строку и сохраняется тем же видом', async () => {
        vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue(reply(vlessNodes, 3))
        vi.spyOn(rpc, 'proxyNodesOfSub').mockResolvedValue(reply(pxNodes, 2))
        const spec: Spec = {
            outputs: { ss: { name: 'ss', kind: 'shadowsocks', sub_file: SUB.path, node: 0, on_fail: 'drop' } },
            channels: [],
        }
        const saved = mount(spec, 'ss')
        await waitFor(() => expect(screen.getByText(/локаций: 5 · взято: 1/)).toBeInTheDocument())
        await click(/Сохранить выход/)
        expect(saved()!.outputs.ss).toMatchObject({ kind: 'shadowsocks', node: 0 })
    })
})

describe('запасной ход по выходу — только у выхода VLESS', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] })
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [SUB] } as never)
    })

    it('бэкенд не знает узлов подписки, на ней стоит только выход trojan — vless_nodes по нему не зовётся', async () => {
        vi.spyOn(rpc, 'vlessNodesOfSub').mockRejectedValue(new Error('не указан выход'))
        vi.spyOn(rpc, 'hysteria2NodesOfSub').mockRejectedValue(new Error('не указан выход'))
        vi.spyOn(rpc, 'proxyNodesOfSub').mockRejectedValue(new Error('не указан выход'))
        const vn = vi.spyOn(rpc, 'vlessNodes').mockResolvedValue(reply([]))
        const spec: Spec = {
            outputs: { tr: { name: 'tr', kind: 'trojan', sub_file: SUB.path, node: 0, on_fail: 'drop' } },
            channels: [],
        }
        mount(spec, 'tr')
        await waitFor(() => expect(screen.getByText(/локации появятся после/)).toBeInTheDocument())
        expect(vn).not.toHaveBeenCalled()
    })
})

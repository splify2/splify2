import { render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PoolEditor from '@/components/PoolEditor'
import { decodeSpec, encodeSpec } from '@/lib/specv2'
import { rpc } from '@/lib/rpc'
import { type Spec } from '@/lib/model'
import { live } from './fixtures'

// Смешанная подписка: 51 ссылка, из них 46 vless:// и 5 hysteria2://, первая — vless. Владелец
// на роутере: узлы hysteria2 не появлялись, потому что редактор спрашивал клиента hysteria2
// ТОЛЬКО когда своих узлов VLESS нет вовсе. Теперь узлы обоих протоколов показываются вместе,
// у каждого подписан протокол, а выбор узла создаёт выход своего вида. Данные синтетические
// (имена и ключи выдуманы), устройство подписки — то же, что у живой: 46 + 5.

const SUB = { name: 'main', title: 'Смесь', path: '/etc/steer/sub.txt', present: true, kind: 'url' }
const vlessNodes = Array.from({ length: 46 }, (_, i) => ({ index: i, name: `🇩🇪 Вэ-узел ${i + 1}` }))
const hyNodes = Array.from({ length: 5 }, (_, i) => ({ index: i, name: `🇳🇱 Хай-узел ${i + 1}` }))
const EMPTY: Spec = { outputs: {}, channels: [] }
const withPools = live({
    status: { schema: 1, features: ['lan_devices', 'nodes', 'pool', 'groups'], outputs: {}, channels: [] },
    build: { modules: ['vless', 'hysteria2'] },
})

const reply = (nodes: typeof vlessNodes, foreign = 0) =>
    ({ output: '', sub_file: SUB.path, node: -1, chosen: [], usable: nodes.length, skipped: 0, foreign, nodes }) as never

const click = async (name: RegExp | string) => {
    ;(await screen.findByRole('button', { name })).click()
    await new Promise((r) => setTimeout(r, 10))
}

function mount(l = withPools) {
    let saved: Spec | null = null
    render(<PoolEditor spec={EMPTY} live={l} onCancel={() => {}} onSave={(n) => { saved = n }} />)
    return () => saved
}

describe('смешанная подписка: узлы обоих протоколов', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] })
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [SUB] } as never)
    })

    it('спрашивает оба клиента и показывает 46 + 5 с подписью протокола', async () => {
        const vn = vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue(reply(vlessNodes, 5))
        const hn = vi.spyOn(rpc, 'hysteria2NodesOfSub').mockResolvedValue(reply(hyNodes))
        mount()
        await waitFor(() => expect(screen.getByText('локаций: 51')).toBeInTheDocument())
        expect(vn).toHaveBeenCalledTimes(1)
        expect(hn).toHaveBeenCalledTimes(1)
        // Узлы hysteria2 свёрнуты после первых шести, пока подписку не развернули.
        await click(/показать все 51 локаций/)
        expect(screen.getByRole('button', { name: /Хай-узел 5/ })).toBeInTheDocument()
        expect(screen.getAllByText(/hysteria2/).length).toBeGreaterThan(0)
        expect(screen.getAllByText(/VLESS/).length).toBeGreaterThan(0)
    })

    it('один узел hysteria2 — выход protocol hysteria2 с номером среди узлов hysteria2', async () => {
        vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue(reply(vlessNodes, 5))
        vi.spyOn(rpc, 'hysteria2NodesOfSub').mockResolvedValue(reply(hyNodes))
        const saved = mount()
        await click(/показать все 51 локаций/)
        await click(/Хай-узел 3/)
        await click(/Сохранить выход/)
        expect(saved()!.outputs.vpn).toMatchObject({ kind: 'hysteria2', sub_file: SUB.path, node: 2 })
    })

    it('узлы двух протоколов в одном выходе — пул из частей разных видов, кодек его проносит', async () => {
        vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue(reply(vlessNodes, 5))
        vi.spyOn(rpc, 'hysteria2NodesOfSub').mockResolvedValue(reply(hyNodes))
        const saved = mount()
        await click(/Вэ-узел 2(?!\d)/)
        await click(/показать все 51 локаций/)
        await click(/Хай-узел 4/)
        await click(/Вэ-узел 3(?!\d)/)
        await click(/Сохранить выход/)
        const out = saved()!.outputs
        // Вэ-2 и Вэ-3 разделены узлом hysteria2 — значит три части, порядок человека дословно.
        expect(out.vpn.devices).toEqual(['vpn-1', 'vpn-2', 'vpn-3'])
        expect(out['vpn-1']).toMatchObject({ kind: 'vless', node: 1, part_of: 'vpn' })
        expect(out['vpn-2']).toMatchObject({ kind: 'hysteria2', node: 3, part_of: 'vpn' })
        expect(out['vpn-3']).toMatchObject({ kind: 'vless', node: 2, part_of: 'vpn' })

        // Кодек: члены группы ссылаются на именованные выходы, вид у каждого свой.
        const doc = encodeSpec(saved()!) as { outputs: Record<string, Record<string, unknown>> }
        expect(doc.outputs['vpn-2']).toMatchObject({ kind: 'tunnel', protocol: 'hysteria2', nodes: [3] })
        expect(doc.outputs['vpn-1']).toMatchObject({ kind: 'tunnel', protocol: 'vless', nodes: [1] })
        expect(doc.outputs.vpn).toMatchObject({ kind: 'group', pick: 'order', members: ['vpn.vpn-1', 'vpn.vpn-2', 'vpn.vpn-3'] })
        const back = decodeSpec(doc)
        expect(back.outputs.vpn.devices).toEqual(['vpn-1', 'vpn-2', 'vpn-3'])
        expect(back.outputs['vpn-2'].kind).toBe('hysteria2')
        expect(back.outputs['vpn-2'].part_of).toBe('vpn')
    })

    it('модуля hysteria2 нет — узлы VLESS доступны, а о недостающих сказано с числом и пакетом', async () => {
        vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue(reply(vlessNodes, 5))
        vi.spyOn(rpc, 'hysteria2NodesOfSub').mockRejectedValue(new Error('нужен пакет steer-hysteria2'))
        /* Клиент прокси стоит и чужих ему ссылок не принял — остаток (5) достаётся hysteria2. */
        vi.spyOn(rpc, 'proxyNodesOfSub').mockResolvedValue(reply([], 51))
        mount(live({
            status: { schema: 1, features: ['lan_devices', 'nodes', 'pool', 'groups'], outputs: {}, channels: [] },
            build: { modules: ['vless', 'proxy'] },
        }))
        await waitFor(() => expect(screen.getByText('локаций: 46')).toBeInTheDocument())
        expect(screen.getByText(/ещё 5 узлов hysteria2: нужен пакет steer-hysteria2/)).toBeInTheDocument()
    })

    it('нет ни hysteria2, ни прокси — названы оба пакета: чьи это ссылки, не узнать', async () => {
        vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue(reply(vlessNodes, 5))
        vi.spyOn(rpc, 'hysteria2NodesOfSub').mockRejectedValue(new Error('нужен пакет steer-hysteria2'))
        vi.spyOn(rpc, 'proxyNodesOfSub').mockRejectedValue(new Error('нужен пакет steer-proxy'))
        mount(live({
            status: { schema: 1, features: ['lan_devices', 'nodes', 'pool', 'groups'], outputs: {}, channels: [] },
            build: { modules: ['vless'] },
        }))
        await waitFor(() => expect(screen.getByText('локаций: 46')).toBeInTheDocument())
        expect(screen.getByText(/ещё 5 узлов: нужны пакеты steer-hysteria2 и steer-proxy/)).toBeInTheDocument()
    })

    it('открытый заново выход hysteria2 возвращается в те же строки с тем же протоколом', async () => {
        vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue(reply(vlessNodes, 5))
        vi.spyOn(rpc, 'hysteria2NodesOfSub').mockResolvedValue(reply(hyNodes))
        const spec: Spec = {
            outputs: { hy: { name: 'hy', kind: 'hysteria2', sub_file: SUB.path, node: 1, on_fail: 'drop' } },
            channels: [],
        }
        let saved: Spec | null = null
        render(<PoolEditor spec={spec} name="hy" live={withPools} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        await waitFor(() => expect(screen.getByText(/локаций: 51 · взято: 1/)).toBeInTheDocument())
        await click(/Сохранить выход/)
        expect(saved!.outputs.hy).toMatchObject({ kind: 'hysteria2', node: 1 })
    })
})

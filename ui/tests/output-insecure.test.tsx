import { render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PoolEditor from '@/components/PoolEditor'
import { encodeSpec } from '@/lib/specv2'
import { rpc } from '@/lib/rpc'
import { type Spec } from '@/lib/model'
import { live } from './fixtures'

// «Не проверять сертификат узла» (ключ insecure спеки v2) — в дополнительных настройках выхода, и
// только у видов с TLS: vless, trojan, vmess, http. У hysteria2 это параметр ссылки узла, у
// shadowsocks и socks TLS нет — ядро такой ключ отвергает, и переключателя там нет.

const SUB = { name: 'main', title: 'Смесь', path: '/etc/steer/sub.txt', present: true, kind: 'links' }
const reply = (nodes: unknown[], foreign = 0) =>
    ({ output: '', sub_file: SUB.path, node: -1, chosen: [], usable: nodes.length, skipped: 0, foreign, nodes }) as never
const withPools = live({
    status: { schema: 1, features: ['lan_devices', 'nodes', 'pool', 'groups'], outputs: {}, channels: [] },
    build: { modules: ['vless', 'hysteria2', 'proxy'] },
})
const click = async (name: RegExp | string) => {
    ;(await screen.findByRole('button', { name })).click()
    await new Promise((r) => setTimeout(r, 10))
}

describe('переключатель insecure у выхода', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] })
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [SUB] } as never)
        vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue(reply([{ index: 0, name: 'Вэ-1' }], 2))
        vi.spyOn(rpc, 'hysteria2NodesOfSub').mockResolvedValue(reply([], 3))
        vi.spyOn(rpc, 'proxyNodesOfSub').mockResolvedValue(reply([
            { index: 0, name: 'Троян-1', type: 'trojan' },
            { index: 1, name: 'Шэдоу-1', type: 'shadowsocks' },
        ], 1))
    })

    it('trojan: включённый переключатель пишет insecure: true в спеку', async () => {
        let saved: Spec | null = null
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={withPools} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        await click(/Троян-1/)
        ;(await screen.findByRole('switch', { name: /Не проверять сертификат узла/ })).click()
        await new Promise((r) => setTimeout(r, 10))
        await click(/Сохранить выход/)
        expect(saved!.outputs.vpn).toMatchObject({ kind: 'trojan', insecure: true })
        expect((encodeSpec(saved!).outputs as Record<string, Record<string, unknown>>).vpn.insecure).toBe(true)
    })

    it('shadowsocks: переключателя нет, ключ не пишется', async () => {
        let saved: Spec | null = null
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={withPools} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        await click(/Шэдоу-1/)
        expect(screen.queryByRole('switch', { name: /Не проверять сертификат/ })).toBeNull()
        expect(screen.queryByRole('button', { name: /Не проверять сертификат/ })).toBeNull()
        await click(/Сохранить выход/)
        expect(saved!.outputs.vpn.insecure).toBeUndefined()
    })

    it('vless с insecure открывается включённым, снятие убирает ключ', async () => {
        const spec: Spec = {
            outputs: { v: { name: 'v', kind: 'vless', sub_file: SUB.path, node: 0, insecure: true, on_fail: 'drop' } },
            channels: [],
        }
        let saved: Spec | null = null
        render(<PoolEditor spec={spec} name="v" live={withPools} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        await waitFor(() => expect(screen.getByText(/взято: 1/)).toBeInTheDocument())
        const sw = await screen.findByRole('switch', { name: /Не проверять сертификат узла/ })
        expect(sw.getAttribute('aria-checked')).toBe('true')
        sw.click()
        await new Promise((r) => setTimeout(r, 10))
        await click(/Сохранить выход/)
        expect(saved!.outputs.v.insecure).toBeUndefined()
    })
})

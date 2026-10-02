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

// Узлы TLS с allowInsecure ядро берёт только у выхода с insecure: true, а номера считает среди
// пригодных. Редактор спрашивает перечень и проверку по файлу с `insecure`, когда включено «Не
// проверять сертификат узла»: такие узлы видны и выбираются, номер — как у выхода. Переключили —
// номера уже взятых строк переписываются по узлу.
describe('узлы с allowInsecure в редакторе выхода', () => {
    const A = { name: 'Альфа', type: 'tcp', security: 'tls', host: 'a.example', port: 443 }
    const B = { name: 'Бета', type: 'tcp', security: 'tls', host: 'b.example', port: 443, insecure: true }
    const C = { name: 'Гамма', type: 'tcp', security: 'tls', host: 'c.example', port: 443 }
    const TA = { name: 'Тро-А', type: 'trojan', security: 'tls', host: 't.example', port: 443 }
    const TB = { name: 'Тро-Б', type: 'trojan', security: 'tls', host: 'u.example', port: 443, insecure: true }
    const TC = { name: 'Тро-В', type: 'trojan', security: 'tls', host: 'v.example', port: 443 }
    const idx = (l: object[]) => l.map((n, i) => ({ index: i, ...n }))
    let vl: ReturnType<typeof vi.spyOn>
    let px: ReturnType<typeof vi.spyOn>
    let vp: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] })
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [SUB] } as never)
        vl = vi.spyOn(rpc, 'vlessNodesOfSub').mockImplementation(((_p: string, ins?: boolean) =>
            Promise.resolve(reply(idx(ins ? [A, B, C] : [A, C]), 3))) as never)
        vi.spyOn(rpc, 'hysteria2NodesOfSub').mockResolvedValue(reply([], 3))
        px = vi.spyOn(rpc, 'proxyNodesOfSub').mockImplementation(((_p: string, ins?: boolean) =>
            Promise.resolve(reply(idx(ins ? [TA, TB, TC] : [TA, TC])))) as never)
        vp = vi.spyOn(rpc, 'vlessProbeOfSub').mockResolvedValue({ results: [] } as never)
    })

    it('без переключателя — перечень без insecure и без узла с allowInsecure', async () => {
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={withPools} onCancel={() => {}} onSave={() => {}} />)
        await screen.findAllByRole('button', { name: /Гамма/ })
        expect(vl).toHaveBeenCalledWith(SUB.path)
        expect(px).toHaveBeenCalledWith(SUB.path)
        expect(screen.queryByRole('button', { name: /Бета/ })).toBeNull()
    })

    it('включили — узел с allowInsecure виден, взятые номера переписаны по узлу', async () => {
        let saved: Spec | null = null
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={withPools} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        await click(/Гамма/)
        await click(/Тро-В/)
        ;(await screen.findByRole('switch', { name: /Не проверять сертификат узла/ })).click()
        await waitFor(() => expect(vl).toHaveBeenCalledWith(SUB.path, true))
        expect(px).toHaveBeenCalledWith(SUB.path, true)
        expect((await screen.findAllByRole('button', { name: /Бета/ })).length).toBeGreaterThan(0)
        await click(/Сохранить выход/)
        const parts = Object.values(saved!.outputs).filter((o) => o.part_of === 'vpn')
        /* Гамма была 1-й без ключа и стала 2-й с ним; Тро-В — так же внутри trojan. */
        expect(parts.find((p) => p.kind === 'vless')).toMatchObject({ node: 2, insecure: true })
        expect(parts.find((p) => p.kind === 'trojan')).toMatchObject({ node: 2, insecure: true })
    })

    it('выход с insecure открывается перечнем с ключом; выключили — узел с allowInsecure уходит из взятых', async () => {
        const spec: Spec = {
            outputs: { v: { name: 'v', kind: 'vless', sub_file: SUB.path, nodes: [1, 2], insecure: true, on_fail: 'drop' } },
            channels: [],
        }
        let saved: Spec | null = null
        render(<PoolEditor spec={spec} name="v" live={withPools} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        await waitFor(() => expect(screen.getByText(/взято: 2/)).toBeInTheDocument())
        expect(vl).toHaveBeenCalledWith(SUB.path, true)
        expect(vl).not.toHaveBeenCalledWith(SUB.path)
        ;(await screen.findByRole('switch', { name: /Не проверять сертификат узла/ })).click()
        await waitFor(() => expect(screen.getByText(/взято: 1/)).toBeInTheDocument())
        await click(/Сохранить выход/)
        expect(saved!.outputs.v).toMatchObject({ node: 1 })
        expect(saved!.outputs.v.insecure).toBeUndefined()
    })

    it('проверка узла по файлу — с тем же ключом', async () => {
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={withPools} onCancel={() => {}} onSave={() => {}} />)
        await click(/Гамма/)
        ;(await screen.findByRole('switch', { name: /Не проверять сертификат узла/ })).click()
        await waitFor(() => expect(vl).toHaveBeenCalledWith(SUB.path, true))
        await screen.findAllByRole('button', { name: /Бета/ })
        screen.getAllByRole('button', { name: /^проверить отклик$/ }).find((b) => b.title.endsWith('Гамма'))!.click()
        await waitFor(() => expect(vp).toHaveBeenCalledWith(SUB.path, 2, true))
    })
})

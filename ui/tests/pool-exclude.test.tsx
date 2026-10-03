import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PoolEditor from '@/components/PoolEditor'
import { encodeSpec } from '@/lib/specv2'
import { rpc } from '@/lib/rpc'
import { type Spec } from '@/lib/model'
import { live } from './fixtures'

// Исключение локаций в редакторе выхода (решение владельца 2026-10-02): флажки стран, которые есть в
// подписке, и поле «не брать узлы со словом в имени». Отмеченная страна — её узлы ядро не берёт ни
// «любой рабочей», ни выбранными (ключи `exclude`, `exclude_name` спеки v2 у каждого туннеля выхода);
// в перечне такие узлы приглушены и помечены. Выбор есть, только когда ядро называет умение
// `exclude`; уже записанное видно и без умения.

const SUB = { name: 'main', title: 'Смесь', path: '/etc/steer/sub.txt', present: true, kind: 'links' }
const reply = (nodes: unknown[], foreign = 0) =>
    ({ output: '', sub_file: SUB.path, node: -1, chosen: [], usable: nodes.length, skipped: 0, foreign, nodes }) as never
const status = (features: string[]) => live({
    status: { schema: 1, features, outputs: {}, channels: [] },
    build: { modules: ['vless', 'hysteria2', 'proxy'] },
})
const WITH = status(['lan_devices', 'nodes', 'pool', 'groups', 'balance_by', 'exclude'])
const WITHOUT = status(['lan_devices', 'nodes', 'pool', 'groups', 'balance_by'])
const tick = () => new Promise((r) => setTimeout(r, 10))
const click = async (name: RegExp | string) => {
    ;(await screen.findByRole('button', { name })).click()
    await tick()
}
const countries = async () => within(await screen.findByRole('group', { name: /не брать узлы стран/ }))
const nodeRow = (name: RegExp) => screen.getAllByRole('button', { name }).find((b) => b.closest('li'))!
const outs = (s: Spec) => encodeSpec(s).outputs as Record<string, Record<string, unknown>>

describe('исключение локаций в редакторе выхода', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] })
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [SUB] } as never)
        vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue(reply([
            { index: 0, name: '🇷🇺 Москва', type: 'tcp', security: 'reality' },
            { index: 1, name: '🇺🇸 Нью-Йорк', type: 'tcp', security: 'reality' },
            { index: 2, name: '🇳🇱 Амстердам LTE', type: 'grpc', security: 'reality' },
            /* Без флага в имени, но ядро назвало страну полем cc — берётся оно. */
            { index: 3, name: 'Франкфурт', type: 'tcp', security: 'reality', cc: 'DE' },
        ], 1))
        vi.spyOn(rpc, 'hysteria2NodesOfSub').mockResolvedValue(reply([], 1))
        vi.spyOn(rpc, 'proxyNodesOfSub').mockResolvedValue(reply([{ index: 0, name: '🇷🇺 Троян', type: 'trojan', security: 'tls' }]))
    })

    it('флажки — страны узлов подписки (по cc узла, без него — по флагу в имени)', async () => {
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={WITH} onCancel={() => {}} onSave={() => {}} />)
        const g = await countries()
        await waitFor(() => expect(g.getAllByRole('button')).toHaveLength(4))
        expect(g.getAllByRole('button').map((b) => b.textContent?.replace(/\p{RI}/gu, '').trim()))
            .toEqual(['Германия', 'Нидерланды', 'Россия', 'США'])
    })

    it('отмеченная страна: её узлы приглушены и помечены, выход пишет exclude', async () => {
        let saved: Spec | null = null
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={WITH} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        const g = await countries()
        ;(await g.findByRole('button', { name: /Россия/ })).click()
        await tick()
        expect(g.getByRole('button', { name: /Россия/ }).getAttribute('aria-pressed')).toBe('true')
        /* Узлы России — VLESS и Trojan — помечены и не выбираются; остальные как были. */
        const moscow = nodeRow(/Москва/)
        expect(moscow.textContent).toContain('не берётся')
        expect(moscow).toBeDisabled()
        expect(nodeRow(/Троян/).textContent).toContain('не берётся')
        expect(nodeRow(/Нью-Йорк/).textContent).not.toContain('не берётся')
        expect(nodeRow(/Нью-Йорк/)).not.toBeDisabled()
        /* «Любая рабочая» — и ядро возьмёт любой узел, кроме исключённых. */
        await click(/^любая рабочая(?! \()/)
        await click(/Сохранить выход/)
        expect(saved!.outputs.vpn).toMatchObject({ kind: 'vless', exclude: ['RU'] })
        expect(outs(saved!).vpn).toMatchObject({ kind: 'tunnel', protocol: 'vless', exclude: ['RU'] })
        expect(outs(saved!).vpn.exclude_name).toBeUndefined()
    })

    it('слово в имени: узлы с ним помечены (без учёта регистра), выход пишет exclude_name', async () => {
        let saved: Spec | null = null
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={WITH} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        await click(/Нью-Йорк/)
        const input = await screen.findByRole('textbox', { name: /не брать узлы со словом в имени/ })
        fireEvent.input(input, { target: { value: 'lte, LTE , ' } })
        await tick()
        expect(nodeRow(/Амстердам/).textContent).toContain('не берётся')
        expect(nodeRow(/Нью-Йорк/).textContent).not.toContain('не берётся')
        await click(/Сохранить выход/)
        expect(outs(saved!).vpn).toMatchObject({ nodes: [1], exclude_name: ['lte'] })
    })

    it('взятый узел отмеченной страны остаётся в порядке с пометкой; все исключены — так и сказано', async () => {
        const spec: Spec = {
            outputs: {
                v: { name: 'v', kind: 'vless', sub_file: SUB.path, nodes: [0], exclude: ['RU'], on_fail: 'drop' },
            },
            channels: [],
        }
        render(<PoolEditor spec={spec} name="v" live={WITH} onCancel={() => {}} onSave={() => {}} />)
        const order = await screen.findByRole('list', { name: /порядок предпочтения/ })
        /* Единственный узел части исключён — части не из чего брать, и это сказано до сохранения. */
        await waitFor(() => expect(within(order).getByText('все узлы исключены')).toBeInTheDocument())
        expect(screen.getByRole('alert').textContent).toContain('Часть пула останется без узлов')
        /* Взятый узел можно снять, хоть он и исключён. */
        expect(nodeRow(/Москва/)).not.toBeDisabled()
        /* Отметить все страны — «любая рабочая» говорит, что брать нечего. */
        const g = await countries()
        for (const c of [/Германия/, /Нидерланды/, /США/]) {
            g.getByRole('button', { name: c }).click()
            await tick()
        }
        expect(nodeRow(/^любая рабочая/).textContent).toContain('все узлы исключены')
    })

    it('часть пула без кандидатов: пока в ней есть неисключённый узел — только пометка узла', async () => {
        const spec: Spec = {
            outputs: {
                v: { name: 'v', kind: 'vless', sub_file: SUB.path, nodes: [0, 1], exclude: ['RU'], on_fail: 'drop' },
            },
            channels: [],
        }
        render(<PoolEditor spec={spec} name="v" live={WITH} onCancel={() => {}} onSave={() => {}} />)
        const order = await screen.findByRole('list', { name: /порядок предпочтения/ })
        await waitFor(() => expect(within(order).getByText('не берётся')).toBeInTheDocument())
        expect(within(order).queryByText('все узлы исключены')).toBeNull()
        expect(screen.queryByRole('alert')).toBeNull()
        /* США отмечены тоже — у части не осталось ни одного кандидата. */
        const g = await countries()
        g.getByRole('button', { name: /США/ }).click()
        await tick()
        await waitFor(() => expect(within(order).getAllByText('все узлы исключены')).toHaveLength(2))
        expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('пул: исключение пишется каждому туннелю выхода', async () => {
        let saved: Spec | null = null
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={WITH} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        await click(/Нью-Йорк/)
        const g = await countries()
        g.getByRole('button', { name: /Нидерланды/ }).click()
        await tick()
        /* Trojan той же подписки — второй частью пула. */
        await click(/^любая рабочая \(Trojan\)/)
        await click(/Сохранить выход/)
        const parts = Object.values(saved!.outputs).filter((o) => o.part_of === 'vpn')
        expect(parts.map((p) => p.kind).sort()).toEqual(['trojan', 'vless'])
        for (const p of parts) expect(p.exclude).toEqual(['NL'])
    })

    it('ядро без умения exclude: выбора нет и ключи не пишутся', async () => {
        let saved: Spec | null = null
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={WITHOUT} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        await click(/Нью-Йорк/)
        expect(screen.queryByRole('group', { name: /не брать узлы стран/ })).toBeNull()
        expect(screen.queryByRole('textbox', { name: /не брать узлы со словом/ })).toBeNull()
        expect(nodeRow(/Москва/).textContent).not.toContain('не берётся')
        await click(/Сохранить выход/)
        expect(saved!.outputs.vpn.exclude).toBeUndefined()
        expect(outs(saved!).vpn.exclude).toBeUndefined()
    })

    it('записанное видно и без умения: открывается отмеченным, снятие убирает ключ', async () => {
        const spec: Spec = {
            outputs: {
                v: { name: 'v', kind: 'vless', sub_file: SUB.path, exclude: ['US'], exclude_name: ['LTE'], on_fail: 'drop' },
            },
            channels: [],
        }
        let saved: Spec | null = null
        render(<PoolEditor spec={spec} name="v" live={WITHOUT} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        const g = await countries()
        const us = await g.findByRole('button', { name: /США/ })
        expect(us.getAttribute('aria-pressed')).toBe('true')
        expect((screen.getByRole('textbox', { name: /не брать узлы со словом/ }) as HTMLInputElement).value).toBe('LTE')
        us.click()
        await tick()
        fireEvent.input(screen.getByRole('textbox', { name: /не брать узлы со словом/ }), { target: { value: '' } })
        await tick()
        await click(/Сохранить выход/)
        expect('exclude' in outs(saved!).v).toBe(false)
        expect('exclude_name' in outs(saved!).v).toBe(false)
    })
})

import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PoolEditor from '@/components/PoolEditor'
import { PoolNowLine } from '@/components/OutputCards'
import { encodeSpec } from '@/lib/specv2'
import { outExtras, poolNow } from '@/lib/outstate'
import { notify } from '@/lib/notify'
import { rpc } from '@/lib/rpc'
import { type OutputStatus, type Spec, type Status } from '@/lib/model'
import { live } from './fixtures'

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

// Пул узлов туннеля в редакторе выхода (решение владельца 2026-10-02: «количество одновременно
// активных конфигураций настраиваемое и обработку при отвале vless»; выбран вариант «N узлов
// сразу, трафик делится»). Ключи `active`, `by`, `interval`, `silence` у `kind: tunnel` спеки v2;
// выбор есть, только когда ядро называет умение `active_nodes`; уже записанное видно и без него.
// Состояние — объект vless/proxy у выхода в status: какие узлы работают сейчас.

const SUB = { name: 'main', title: 'Смесь', path: '/etc/steer/sub.txt', present: true, kind: 'links' }
const HY = { name: 'hy', title: 'Хиси', path: '/etc/steer/subs/hy.txt', present: true, kind: 'links' }
const reply = (path: string, nodes: unknown[], foreign = 0) =>
    ({ output: '', sub_file: path, node: -1, chosen: [], usable: nodes.length, skipped: 0, foreign, nodes }) as never
const FEATS = ['lan_devices', 'nodes', 'pool', 'groups', 'balance_by', 'exclude']
const status = (features: string[], outputs: Record<string, unknown> = {}) => live({
    status: { schema: 1, features, outputs, channels: [] } as unknown as Status,
    build: { modules: ['vless', 'hysteria2', 'proxy'] },
})
const WITH = status([...FEATS, 'active_nodes'])
const WITHOUT = status(FEATS)
const tick = () => new Promise((r) => setTimeout(r, 10))
const click = async (name: RegExp | string) => {
    ;(await screen.findByRole('button', { name })).click()
    await tick()
}
const outs = (s: Spec) => encodeSpec(s).outputs as Record<string, Record<string, unknown>>
const card = () => screen.queryByRole('heading', { name: 'Сколько узлов работают сразу' })
const field = () => screen.getByRole('spinbutton', { name: 'узлов сразу' }) as HTMLInputElement
const setNum = async (el: HTMLElement, v: string) => {
    fireEvent.input(el, { target: { value: v } })
    await tick()
}

describe('пул узлов туннеля в редакторе выхода', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        vi.mocked(notify).mockClear()
        window.localStorage.clear()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] })
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [SUB, HY] } as never)
        vi.spyOn(rpc, 'vlessNodesOfSub').mockImplementation(async (path: string) => path === SUB.path
            ? reply(SUB.path, [
                { index: 0, name: '🇳🇱 Амстердам', type: 'tcp', security: 'reality' },
                { index: 1, name: '🇩🇪 Франкфурт', type: 'tcp', security: 'reality' },
                { index: 2, name: '🇫🇮 Хельсинки', type: 'ws', security: 'tls' },
                { index: 3, name: '🇷🇺 Москва', type: 'tcp', security: 'reality' },
            ], 1)
            : reply(HY.path, [], 1))
        vi.spyOn(rpc, 'hysteria2NodesOfSub').mockImplementation(async (path: string) => path === HY.path
            ? reply(HY.path, [{ index: 0, name: '🇵🇱 Варшава', type: 'hysteria2', security: 'tls' }])
            : reply(SUB.path, []))
        vi.spyOn(rpc, 'proxyNodesOfSub').mockImplementation(async (path: string) => path === SUB.path
            ? reply(SUB.path, [{ index: 0, name: '🇺🇸 Троян', type: 'trojan', security: 'tls' }])
            : reply(HY.path, []))
    })

    it('три взятых узла: сколько сразу — не больше трёх, раздача при двух и больше, пишется в выход', async () => {
        let saved: Spec | null = null
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={WITH} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        for (const n of [/Амстердам/, /Франкфурт/, /Хельсинки/]) await click(n)
        expect(card()).toBeInTheDocument()
        expect(screen.getByText('не больше 3')).toBeInTheDocument()
        /* Один узел — раздачи нет. */
        expect(screen.queryByRole('button', { name: 'Сайт — на одном узле' })).toBeNull()
        await click('больше узлов сразу')
        await click('больше узлов сразу')
        expect(field().value).toBe('3')
        expect(screen.getByRole('button', { name: 'больше узлов сразу' })).toBeDisabled()
        /* Порядок говорит, что работают первые живые сразу. */
        expect(screen.getByText(/Сразу работают первые 3 живых узла подписки/)).toBeInTheDocument()
        await click('Сайт — на одном узле')
        await click(/Сохранить выход/)
        expect(saved!.outputs.vpn).toMatchObject({ kind: 'vless', nodes: [0, 1, 2], active: 3, by: 'site' })
        expect(outs(saved!).vpn).toMatchObject({ kind: 'tunnel', protocol: 'vless', nodes: [0, 1, 2], active: 3, by: 'site' })
    })

    it('«каждое соединение — на любой узел» — умолчание: ключа by нет; один узел — нет и active', async () => {
        let saved: Spec | null = null
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={WITH} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        await click(/Амстердам/)
        await click(/Франкфурт/)
        await setNum(field(), '2')
        expect(screen.getByRole('button', { name: 'Каждое соединение — на любой узел' }).className).toContain('text-primary')
        await click(/Сохранить выход/)
        expect(outs(saved!).vpn).toMatchObject({ active: 2 })
        expect('by' in outs(saved!).vpn).toBe(false)
        /* Снова один — ключей пула нет вовсе. */
        await setNum(field(), '1')
        await click(/Сохранить выход/)
        expect('active' in outs(saved!).vpn || 'by' in outs(saved!).vpn).toBe(false)
    })

    it('«любая рабочая»: предел — узлы подписки, которые ядро может взять', async () => {
        let saved: Spec | null = null
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={WITH} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        await waitFor(() => expect(screen.getAllByRole('button', { name: /Амстердам/ }).length).toBeGreaterThan(0))
        /* «Любая рабочая» подписки «Смесь» — первая: подписки идут по порядку перечня. */
        screen.getAllByRole('button', { name: /^любая рабочая(?! \()/ })[0].click()
        await tick()
        expect(screen.getByText('не больше 4')).toBeInTheDocument()
        /* Россия исключена — её узел ядро не возьмёт, предел меньше. */
        const g = within(await screen.findByRole('group', { name: /не брать узлы стран/ }))
        g.getByRole('button', { name: /Россия/ }).click()
        await tick()
        expect(screen.getByText('не больше 3')).toBeInTheDocument()
        /* Больше предела — отказ словами, выход не сохраняется. */
        await setNum(field(), '5')
        await click(/Сохранить выход/)
        expect(saved).toBeNull()
        expect(notify).toHaveBeenCalledWith('Узлов сразу — не больше, чем можно взять: 3', 'warning')
        await setNum(field(), '3')
        await click(/Сохранить выход/)
        expect(outs(saved!).vpn).toMatchObject({ active: 3, exclude: ['RU'] })
        expect('nodes' in outs(saved!).vpn).toBe(false)
    })

    it('слежка — в дополнительных: период и порог молчания, 0 — выключено, вне пределов — отказ', async () => {
        let saved: Spec | null = null
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={WITH} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        await click(/Амстердам/)
        const every = screen.getByRole('spinbutton', { name: /Проверять узел раз в, с/ })
        const quiet = screen.getByRole('spinbutton', { name: /Считать узел мёртвым после молчания, с/ })
        expect(quiet.getAttribute('placeholder')).toBe('20')
        expect(screen.getByText('0 — выключено')).toBeInTheDocument()
        await setNum(quiet, '3')
        await click(/Сохранить выход/)
        expect(saved).toBeNull()
        expect(notify).toHaveBeenCalledWith('Молчание узла — 0 или от 5 до 32767 с', 'warning')
        await setNum(quiet, '0')
        await setNum(every, '4')
        await click(/Сохранить выход/)
        expect(saved).toBeNull()
        await setNum(every, '30')
        await click(/Сохранить выход/)
        expect(saved!.outputs.vpn).toMatchObject({ interval: 30, silence: 0 })
        expect(outs(saved!).vpn).toMatchObject({ interval: 30, silence: 0 })
    })

    it('hysteria2: карточки «сколько сразу» нет, слежка есть, умолчание молчания — 30', async () => {
        let saved: Spec | null = null
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={WITH} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        await click(/Варшава/)
        expect(card()).toBeNull()
        const quiet = screen.getByRole('spinbutton', { name: /Считать узел мёртвым после молчания, с/ })
        expect(quiet.getAttribute('placeholder')).toBe('30')
        expect(screen.queryByText('0 — выключено')).toBeNull()
        await setNum(quiet, '45')
        await click(/Сохранить выход/)
        expect(outs(saved!).vpn).toEqual({ kind: 'tunnel', protocol: 'hysteria2', subscription: HY.path, nodes: [0], on_fail: 'drop', silence: 45 })
    })

    it('пул из частей: каждой части — не больше её узлов, hysteria2 — без active', async () => {
        let saved: Spec | null = null
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={WITH} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        await click(/Амстердам/)
        await click(/Франкфурт/)
        await click(/Хельсинки/)
        await click(/Варшава/)
        await click(/Троян/)
        await setNum(field(), '3')
        await click('Сайт и устройство — на одном узле')
        await click(/Сохранить выход/)
        const parts = Object.values(saved!.outputs).filter((o) => o.part_of === 'vpn')
        const by = Object.fromEntries(parts.map((p) => [p.kind, p]))
        expect(by.vless).toMatchObject({ nodes: [0, 1, 2], active: 3, by: 'site_client' })
        expect(by.hysteria2.active).toBeUndefined()
        expect(by.trojan.active).toBeUndefined()
        expect(by.trojan.by).toBeUndefined()
    })

    it('ядро без умения active_nodes: ни карточки, ни слежки, ключей нет', async () => {
        let saved: Spec | null = null
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={WITHOUT} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        await click(/Амстердам/)
        await click(/Франкфурт/)
        expect(card()).toBeNull()
        expect(screen.queryByRole('spinbutton', { name: /Проверять узел/ })).toBeNull()
        await click(/Сохранить выход/)
        for (const k of ['active', 'by', 'interval', 'silence']) expect(k in outs(saved!).vpn).toBe(false)
    })

    it('записанное видно и без умения: открывается со значениями, снятие убирает ключи', async () => {
        const spec: Spec = {
            outputs: {
                v: { name: 'v', kind: 'vless', sub_file: SUB.path, nodes: [0, 1], active: 2, by: 'site', interval: 30, silence: 0, on_fail: 'drop' },
            },
            channels: [],
        }
        let saved: Spec | null = null
        render(<PoolEditor spec={spec} name="v" live={WITHOUT} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        await waitFor(() => expect(card()).toBeInTheDocument())
        expect(field().value).toBe('2')
        expect(screen.getByRole('button', { name: 'Сайт — на одном узле' }).className).toContain('text-primary')
        expect((screen.getByRole('spinbutton', { name: /Проверять узел/ }) as HTMLInputElement).value).toBe('30')
        expect((screen.getByRole('spinbutton', { name: /после молчания/ }) as HTMLInputElement).value).toBe('0')
        await click('меньше узлов сразу')
        await setNum(screen.getByRole('spinbutton', { name: /Проверять узел/ }), '')
        await setNum(screen.getByRole('spinbutton', { name: /после молчания/ }), '')
        await click(/Сохранить выход/)
        expect(outs(saved!).v).toEqual({ kind: 'tunnel', protocol: 'vless', subscription: SUB.path, nodes: [0, 1], on_fail: 'drop' })
    })

    it('карточка показывает, какие узлы работают сейчас, и предупреждает, когда их меньше', async () => {
        const spec: Spec = {
            outputs: { v: { name: 'v', kind: 'vless', sub_file: SUB.path, nodes: [0, 1, 2], active: 3, on_fail: 'drop' } },
            channels: [],
        }
        const st = status([...FEATS, 'active_nodes'], {
            v: { kind: 'vless', up: true, vless: { up: true, node: '🇳🇱 Амстердам', want: 3, slots: 3, by: 'connection',
                active: [{ index: 0, name: '🇳🇱 Амстердам' }, { index: 2, name: '🇫🇮 Хельсинки' }] } },
        })
        render(<PoolEditor spec={spec} name="v" live={st} onCancel={() => {}} onSave={() => {}} />)
        await waitFor(() => expect(screen.getByText(/Работают 2 из 3 узлов: Амстердам, Хельсинки/)).toBeInTheDocument())
        expect(screen.getByText('Остальные не отвечают — замена найдётся сама.')).toBeInTheDocument()
    })
})

describe('пул узлов туннеля: состояние на главной и в «Выходах»', () => {
    const vl = (want: number, slots: number, names: string[]): OutputStatus => ({
        name: 'v', kind: 'vless', up: true,
        vless: { up: true, want, slots, by: 'site', active: names.map((name, index) => ({ index, name })) },
    })

    it('poolNow: пула нет при одном узле и без объекта клиента', () => {
        expect(poolNow([{ name: 'v', kind: 'vless', up: true }])).toBeNull()
        expect(poolNow([vl(1, 1, ['A'])])).toBeNull()
        expect(poolNow([vl(3, 3, ['🇳🇱 A', 'B'])])).toEqual({ names: ['A', 'B'], have: 2, want: 3, slots: 3 })
        /* Прокси — объект proxy. */
        const px: OutputStatus = { name: 'p', kind: 'trojan', proxy: { node: 'X', protocol: 'trojan', up: true, want: 2, slots: 2, active: [{ index: 4, name: 'X' }, { index: 5, name: 'Y' }] } }
        expect(poolNow([px])?.names).toEqual(['X', 'Y'])
    })

    it('строка «Выходов»: узлы словами, меньше заданного — беда; части пула — тоже', () => {
        const o = { name: 'v', kind: 'vless' as const }
        expect(outExtras(o, vl(2, 2, ['A', 'B']))).toEqual({ words: ['работают узлы: A, B'], alarm: false })
        expect(outExtras(o, vl(3, 3, ['A']))).toEqual({ words: ['работают 1 из 3 узлов: A'], alarm: true })
        const pool = { name: 'vpn', kind: 'interface' as const, devices: ['vpn-1'] }
        expect(outExtras(pool, { name: 'vpn', kind: 'interface', up: true }, { parts: [vl(2, 2, ['C', 'D'])] }).words)
            .toEqual(['работают узлы: C, D'])
    })

    it('строка на главной: работают сразу; кандидатов меньше — так и сказано', () => {
        const { container, rerender } = render(<PoolNowLine sts={[vl(2, 2, ['🇳🇱 Амстердам', 'Франкфурт'])]} />)
        expect(container.textContent).toBe('Работают сразу: Амстердам, Франкфурт')
        rerender(<PoolNowLine sts={[vl(4, 2, ['A', 'B'])]} />)
        expect(container.textContent).toContain('Работают 2 из 4 узлов: A, B')
        expect(container.textContent).toContain('В подписке подходящих узлов — 2: работают все.')
        rerender(<PoolNowLine sts={[vl(1, 1, ['A'])]} />)
        expect(container.textContent).toBe('')
        /* Живых нет: на главной беду говорит строка выхода, в редакторе — сама строка пула. */
        rerender(<PoolNowLine sts={[vl(3, 3, [])]} />)
        expect(container.textContent).toBe('')
        rerender(<PoolNowLine sts={[vl(3, 3, [])]} none />)
        expect(container.textContent).toBe('Живых узлов нет — замена ищется сама.')
    })
})

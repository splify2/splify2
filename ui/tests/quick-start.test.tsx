import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

import QuickStart from '@/components/QuickStart'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { tileEntries, TILES } from '@/lib/quickstart'
import { toCatalog, type Spec } from '@/lib/model'

// Быстрый старт на пустой главной (D-P3.1): ссылка подписки → выход создаётся сам → плитки «что
// пустить» → правила. Мера: человек со стороны — установка → сайт через туннель ≤ 3 экранов.

const M = {
    version: '1',
    base_url: 'https://x/',
    categories: [
        { id: 'itdoginfo:telegram', name_ru: 'Telegram', file: 'telegram.lst', count: 10 },
        { id: 'itdoginfo:discord', name_ru: 'Discord', file: 'discord.lst', count: 10 },
    ],
    domain_lists: [
        { id: 'itdoginfo:youtube', kind: 'domains', name_ru: 'YouTube', file: 'domains/youtube.lst', count: 5 },
        { id: 'b4geoip:anthropic', kind: 'domains', name_ru: 'Anthropic', file: 'domains/anthropic.lst', count: 5 },
    ],
}

const BLANK: Spec = { outputs: { direct: { name: 'direct', kind: 'direct' } }, channels: [] }
const WITH_OUT: Spec = {
    outputs: { direct: { name: 'direct', kind: 'direct' }, sub1: { name: 'sub1', kind: 'vless', sub_file: '/etc/steer/subs/sub1.txt' } as never },
    channels: [],
}

let disk: Spec
let subs: { name: string; path: string }[]
let ui: string

beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    disk = structuredClone(BLANK)
    subs = []
    ui = '{}'
    vi.spyOn(rpc, 'specGet').mockImplementation(async () => structuredClone(disk))
    vi.spyOn(rpc, 'appliedGet').mockImplementation(async () => structuredClone(disk))
    vi.spyOn(rpc, 'specSet').mockResolvedValue({ ok: true })
    vi.spyOn(rpc, 'apply').mockResolvedValue({ ok: true, output: '' } as never)
    vi.spyOn(rpc, 'uiGet').mockImplementation(async () => ({ state: ui }))
    vi.spyOn(rpc, 'uiSet').mockImplementation((async (s: string) => { ui = s; return { ok: true } }) as never)
    vi.spyOn(rpc, 'manifest').mockResolvedValue(M as never)
    vi.spyOn(rpc, 'localLists').mockResolvedValue({ files: {} })
    vi.spyOn(rpc, 'subList').mockImplementation((async () => ({ subs })) as never)
    vi.spyOn(rpc, 'subSet').mockImplementation((async (_u: string, name: string) => {
        subs = [...subs, { name, path: `/etc/steer/subs/${name}.txt` }]
        return { ok: true, usable: 3 }
    }) as never)
    vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue({ nodes: [{ name: 'a', server: 'x', port: 443 }] } as never)
    vi.spyOn(rpc, 'hysteria2NodesOfSub').mockResolvedValue({ nodes: [] } as never)
    vi.spyOn(rpc, 'proxyNodesOfSub').mockResolvedValue({ nodes: [] } as never)
    // @ts-expect-error — сброс внутреннего состояния между проверками
    pending.saved = null; pending.applied = null; pending.dirty = false
})

describe('плитки', () => {
    it('находят свои записи каталога по id и названию; «весь трафик» — без списков', () => {
        const services = toCatalog(M as never).services
        const by = (id: string) => tileEntries(TILES.find((t) => t.id === id)!, services).map((s) => s.name)
        expect(by('youtube')).toEqual(['YouTube'])
        expect(by('telegram')).toEqual(['Telegram'])
        expect(by('ai')).toEqual(['Anthropic'])
        expect(by('all')).toEqual([])
    })
})

describe('быстрый старт', () => {
    it('пустая установка: ссылка → выход создан → плитки → правила; применение — автоматическое', async () => {
        await pending.load()
        render(<QuickStart />)
        fireEvent.input(await screen.findByLabelText('Ссылка подписки'), { target: { value: 'https://sub.example/x' } })
        fireEvent.click(screen.getByRole('button', { name: 'Подключить' }))
        // Выход на узлах подписки создался сам, и показан второй шаг.
        await screen.findByText(/Выход «.+» готов/)
        expect(Object.values(pending.saved!.outputs).some((o) => o.sub_file === '/etc/steer/subs/sub1.txt')).toBe(true)
        fireEvent.click(await screen.findByRole('button', { name: 'YouTube' }))
        fireEvent.click(screen.getByRole('button', { name: 'Telegram' }))
        fireEvent.click(screen.getByRole('button', { name: 'Включить' }))
        await waitFor(() => expect(pending.saved!.channels).toHaveLength(2))
        const [yt, tg] = pending.saved!.channels
        expect(yt.name).toBe('YouTube')
        expect(yt.match.domains_files?.[0]).toMatch(/youtube/)
        expect(tg.match.prefixes_files?.[0]).toMatch(/telegram/)
        expect(yt.out).toBe(tg.out)
        expect(pending.saved!.outputs[yt.out].sub_file).toBe('/etc/steer/subs/sub1.txt')
        expect(screen.queryByText('Быстрый старт')).toBeNull()
    })

    it('«Весь трафик» — одно правило без списков и вытесняет остальные плитки', async () => {
        disk = structuredClone(WITH_OUT)
        await pending.load()
        render(<QuickStart />)
        fireEvent.click(await screen.findByRole('button', { name: 'YouTube' }))
        fireEvent.click(screen.getByRole('button', { name: 'Весь трафик' }))
        expect(screen.getByRole('button', { name: 'YouTube' })).toHaveAttribute('aria-pressed', 'false')
        fireEvent.click(screen.getByRole('button', { name: 'Включить' }))
        await waitFor(() => expect(pending.saved!.channels).toHaveLength(1))
        expect(pending.saved!.channels[0]).toMatchObject({ name: 'Весь трафик', out: 'sub1', match: { any: true } })
    })

    it('выход уже есть — сразу плитки, поля ссылки нет', async () => {
        disk = structuredClone(WITH_OUT)
        await pending.load()
        render(<QuickStart />)
        expect(await screen.findByText('Что пустить через VPN')).toBeInTheDocument()
        expect(screen.queryByLabelText('Ссылка подписки')).toBeNull()
    })

    it('правила уже есть — карточки нет', async () => {
        disk = { ...structuredClone(WITH_OUT), channels: [{ name: 'x', out: 'sub1', match: { any: true } }] }
        await pending.load()
        const { container } = render(<QuickStart />)
        await waitFor(() => expect(rpc.uiGet).toHaveBeenCalled())
        expect(container.querySelector('section, h3')).toBeNull()
    })

    it('«Не сейчас» прячет карточку и запоминает на роутере', async () => {
        await pending.load()
        render(<QuickStart />)
        fireEvent.click(await screen.findByRole('button', { name: 'Не сейчас' }))
        expect(screen.queryByText('Быстрый старт')).toBeNull()
        await waitFor(() => expect(JSON.parse(ui)).toMatchObject({ quick: 1 }))
    })

    it('карточка уже отклонена раньше — не показывается', async () => {
        ui = '{"quick":1}'
        await pending.load()
        render(<QuickStart />)
        await waitFor(() => expect(rpc.uiGet).toHaveBeenCalled())
        await new Promise((r) => setTimeout(r, 20))
        expect(screen.queryByText('Быстрый старт')).toBeNull()
    })

    it('ссылка не годится — предупреждение, на роутер ничего не уходит', async () => {
        await pending.load()
        render(<QuickStart />)
        fireEvent.input(await screen.findByLabelText('Ссылка подписки'), { target: { value: 'не ссылка' } })
        fireEvent.click(screen.getByRole('button', { name: 'Подключить' }))
        expect(rpc.subSet).not.toHaveBeenCalled()
    })
})

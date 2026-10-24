import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Requests from '@/components/sections/Requests'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import type { Status, Spec } from '@/lib/model'
import { live } from './fixtures'

// Экран «Запросы», имена: имя → правило → выход → узел. Журнал имён резолвера ядра (steer
// dns-log) приходит из общего опроса; «Почему сюда» спрашивает ядро тем же `explain`, что и главная.

const LOG = {
    running: true,
    size: 256,
    names: [
        { name: 'example.org', channel: null, out: null, count: 4, last: 1790947682, ago: 0 },
        { name: 'discord.com', channel: 'Discord', out: 'reserve', count: 8, last: 1790947679, ago: 3 },
        { name: 'www.youtube.com', channel: 'YouTube', out: 'nl-vpn', count: 156, last: 1790947671, ago: 11 },
        { name: 'github.com', channel: null, out: null, count: 22, last: 1790944324, ago: 3358 },
    ],
    upstreams: [],
    cache: null,
}

const STATUS = {
    outputs: {
        'nl-vpn': { kind: 'vless', up: true, vless: { node: 'Амстердам 2', up: true } },
        reserve: { kind: 'interface', up: true },
    },
    channels: [],
} as unknown as Status

const SPEC = { schema: 1, outputs: {}, channels: [] } as unknown as Spec

describe('запросы: имена', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        pending.saved = SPEC
        pending.applied = SPEC
        vi.spyOn(rpc, 'specGet').mockResolvedValue(SPEC)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue(SPEC)
        vi.spyOn(rpc, 'leases').mockResolvedValue({ leases: [] })
    })

    it('имя → правило, выход и узел; мимо правил — словом; сколько раз и когда', () => {
        render(<Requests live={live({ dnsLog: LOG as never, status: STATUS })} />)
        expect(screen.getByText('www.youtube.com')).toBeInTheDocument()
        expect(screen.getByText('nl-vpn')).toBeInTheDocument()
        expect(screen.getByText('правило YouTube')).toBeInTheDocument()
        expect(screen.getByText('узел Амстердам 2')).toBeInTheDocument()
        expect(screen.getByText('156 раз')).toBeInTheDocument()
        expect(screen.getByText('11 с назад')).toBeInTheDocument()
        expect(screen.getByText('56 мин назад')).toBeInTheDocument()
        expect(screen.getAllByText('мимо правил')).toHaveLength(2)
    })

    it('«под правилами» убирает имена мимо правил; поиск — по имени, правилу, выходу и узлу', async () => {
        render(<Requests live={live({ dnsLog: LOG as never, status: STATUS })} />)
        fireEvent.click(screen.getByRole('button', { name: 'под правилами' }))
        await waitFor(() => expect(screen.queryByText('example.org')).toBeNull())
        expect(screen.getByText('discord.com')).toBeInTheDocument()
        const input = screen.getByPlaceholderText(/Имя, правило, выход или узел/)
        fireEvent.input(input, { target: { value: 'reserve' } })
        await waitFor(() => expect(screen.queryByText('www.youtube.com')).toBeNull())
        expect(screen.getByText('discord.com')).toBeInTheDocument()
        fireEvent.input(input, { target: { value: 'амстердам' } })
        await waitFor(() => expect(screen.queryByText('discord.com')).toBeNull())
        expect(screen.getByText('www.youtube.com')).toBeInTheDocument()
    })

    it('резолвер не запущен — сказано, а не пустой список; ответа нет — «Загрузка»', () => {
        const a = render(<Requests live={live({ dnsLog: { running: false, names: [] } as never })} />)
        expect(screen.getByText(/DNS-служба ядра не запущена/)).toBeInTheDocument()
        a.unmount()
        render(<Requests live={live()} />)
        expect(screen.getByText('Загрузка…')).toBeInTheDocument()
    })

    it('«Почему сюда» спрашивает ядро про это имя и показывает ответ словами', async () => {
        const explain = vi.spyOn(rpc, 'explain').mockResolvedValue({ text: 'discord.com -> reserve (правило: Discord)' })
        render(<Requests live={live({ dnsLog: LOG as never, status: STATUS })} />)
        fireEvent.click(screen.getAllByRole('button', { name: 'Почему сюда' })[1])
        expect(await screen.findByText(/discord\.com пойдёт через выход «reserve» — по правилу «Discord»/)).toBeInTheDocument()
        expect(explain).toHaveBeenCalledWith('discord.com')
    })

    it('просит у опроса журнал имён, только пока смотрит; пауза его отпускает, показанное остаётся', () => {
        const releases: ReturnType<typeof vi.fn>[] = []
        const want = vi.fn(() => { const r = vi.fn(); releases.push(r); return r })
        render(<Requests live={live({ dnsLog: LOG as never, want })} />)
        expect(want).toHaveBeenCalledTimes(1)
        expect(want).toHaveBeenCalledWith('dnsLog')
        fireEvent.click(screen.getByRole('button', { name: /Пауза/ }))
        expect(releases[0]).toHaveBeenCalledTimes(1)
        expect(screen.getByText('На паузе: список не обновляется.')).toBeInTheDocument()
        expect(screen.getByText('www.youtube.com')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /Продолжить/ }))
        expect(want).toHaveBeenCalledTimes(2)
    })
})

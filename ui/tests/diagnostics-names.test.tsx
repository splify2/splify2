import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Diagnostics from '@/components/sections/Diagnostics'
import { rpc } from '@/lib/rpc'
import { live } from './fixtures'

// «Недавние имена» в «Диагностике»: журнал имён резолвера ядра (steer dns-log). Раздел «DNS»
// показывал из того же ответа только серверы и кэш, а сами имена — какое имя в какое правило и
// выход попало — не видел никто. Снято с QEMU-стенда после curl от клиента.

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

describe('диагностика: недавние имена', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        vi.spyOn(rpc, 'engineState').mockResolvedValue({ instances: {}, log: [] })
        vi.spyOn(rpc, 'conns').mockResolvedValue({ conns: [] } as never)
        vi.spyOn(rpc, 'leases').mockResolvedValue({ leases: [] })
    })

    it('имя → правило и выход; мимо правил — словом; сколько раз и когда', async () => {
        vi.spyOn(rpc, 'dnsLog').mockResolvedValue(LOG as never)
        render(<Diagnostics live={live({ diag: { checks: [], warn: 0, fail: 0 } })} />)
        expect(await screen.findByText('www.youtube.com')).toBeInTheDocument()
        expect(screen.getByText('nl-vpn')).toBeInTheDocument()
        expect(screen.getByText('правило YouTube')).toBeInTheDocument()
        expect(screen.getByText('156 раз')).toBeInTheDocument()
        expect(screen.getByText('8 раз')).toBeInTheDocument()
        expect(screen.getByText('11 с назад')).toBeInTheDocument()
        expect(screen.getByText('56 мин назад')).toBeInTheDocument()
        expect(screen.getAllByText('мимо правил')).toHaveLength(2)
    })

    it('«под правилами» убирает имена мимо правил; поиск — по имени, правилу и выходу', async () => {
        vi.spyOn(rpc, 'dnsLog').mockResolvedValue(LOG as never)
        render(<Diagnostics live={live({ diag: { checks: [], warn: 0, fail: 0 } })} />)
        await screen.findByText('example.org')
        fireEvent.click(screen.getByRole('button', { name: 'под правилами' }))
        await waitFor(() => expect(screen.queryByText('example.org')).toBeNull())
        expect(screen.getByText('discord.com')).toBeInTheDocument()
        fireEvent.input(screen.getByPlaceholderText(/Имя, правило или выход/), { target: { value: 'reserve' } })
        await waitFor(() => expect(screen.queryByText('www.youtube.com')).toBeNull())
        expect(screen.getByText('discord.com')).toBeInTheDocument()
    })

    it('резолвер не запущен — сказано, а не пустой список', async () => {
        vi.spyOn(rpc, 'dnsLog').mockResolvedValue({ running: false, names: [] } as never)
        render(<Diagnostics live={live({ diag: { checks: [], warn: 0, fail: 0 } })} />)
        expect(await screen.findByText(/резолвер ядра steer не запущен/)).toBeInTheDocument()
    })
})

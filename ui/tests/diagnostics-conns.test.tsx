import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Diagnostics from '@/components/sections/Diagnostics'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import type { Spec } from '@/lib/model'
import { live } from './fixtures'

// «Соединения через выходы» в «Диагностике»: метод rpcd conns (steer conns) был объявлен, но
// экран его не спрашивал. Теперь видно, какие соединения ядро повело в выходы — кто (имя
// устройства из аренд DHCP), куда, через какой выход и по какому правилу, — с поиском.

const SPEC = {
    schema: 1,
    outputs: { 'nl-vpn': { name: 'nl-vpn', kind: 'interface', device: 'wgt' }, reserve: { name: 'reserve', kind: 'interface', device: 'sbx0' } },
    channels: [
        { name: 'YouTube', out: 'nl-vpn', match: {} },
        { name: 'Instagram', out: 'nl-vpn', match: {} },
        { name: 'Discord', out: 'reserve', match: {} },
    ],
} as unknown as Spec

const CONNS = {
    schema: 1,
    conns: [
        { family: 'ipv4', proto: 'tcp', src: '192.168.1.2', sport: 40312, dst: '162.159.135.232', dport: 443, mark: '0x00200000', out: 'reserve', state: 'established', packets: 12, bytes: 2310, reply_packets: 10, reply_bytes: 8812 },
        { family: 'ipv4', proto: 'tcp', src: '192.168.1.7', sport: 51000, dst: '142.250.74.14', dport: 443, mark: '0x00100000', out: 'nl-vpn', state: 'syn_sent' },
        { family: 'ipv6', proto: 'udp', src: 'fd00::5', sport: 5353, dst: '2a00:1450::e', dport: 443, mark: '0x00800000', out: null },
    ],
    shown: 3, total: 3, truncated: false,
}

describe('диагностика: соединения через выходы', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        pending.saved = SPEC
        pending.applied = SPEC
        vi.spyOn(rpc, 'specGet').mockResolvedValue(SPEC)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue(SPEC)
        vi.spyOn(rpc, 'engineState').mockResolvedValue({ instances: {}, log: [] })
        vi.spyOn(rpc, 'dnsLog').mockResolvedValue({ running: true, names: [] })
        vi.spyOn(rpc, 'leases').mockResolvedValue({ leases: [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.2', name: 'iPhone' }] })
    })

    it('кто, куда, выход и правило; правило названо точно, когда в выход ведёт одно', async () => {
        vi.spyOn(rpc, 'conns').mockResolvedValue(CONNS as never)
        render(<Diagnostics live={live({ diag: { checks: [], warn: 0, fail: 0 } })} />)
        expect(await screen.findByText('iPhone')).toBeInTheDocument()
        expect(screen.getByText('162.159.135.232:443')).toBeInTheDocument()
        expect(screen.getByText('правило Discord')).toBeInTheDocument()
        // Счётчики ядра Linux: ↓ — ответ, ↑ — исходное направление.
        expect(screen.getByText(/↓ 8,6 КБ ↑ 2,3 КБ/)).toBeInTheDocument()
        // В nl-vpn ведут два правила — какое из них, ядро не говорит: названы оба.
        expect(screen.getByText('одно из правил: YouTube, Instagram')).toBeInTheDocument()
        expect(screen.getByText('устанавливается')).toBeInTheDocument()
        // IPv6 с портом — в скобках; выход, убранный из спеки, назван словом.
        expect(screen.getByText('[2a00:1450::e]:443')).toBeInTheDocument()
        expect(screen.getByText('выход убран')).toBeInTheDocument()
    })

    it('поиск — по имени устройства, адресу, выходу и правилу', async () => {
        vi.spyOn(rpc, 'conns').mockResolvedValue(CONNS as never)
        render(<Diagnostics live={live({ diag: { checks: [], warn: 0, fail: 0 } })} />)
        const input = await screen.findByPlaceholderText(/Устройство, адрес, выход или правило/)
        fireEvent.input(input, { target: { value: 'youtube' } })
        await waitFor(() => expect(screen.queryByText('iPhone')).toBeNull())
        expect(screen.getByText('142.250.74.14:443')).toBeInTheDocument()
        fireEvent.input(input, { target: { value: 'iphone' } })
        await waitFor(() => expect(screen.getByText('iPhone')).toBeInTheDocument())
        expect(screen.queryByText('142.250.74.14:443')).toBeNull()
    })

    it('ответ обрезан ядром — сказано, сколько показано из скольких', async () => {
        vi.spyOn(rpc, 'conns').mockResolvedValue({ ...CONNS, shown: 3, total: 2417, truncated: true } as never)
        render(<Diagnostics live={live({ diag: { checks: [], warn: 0, fail: 0 } })} />)
        expect(await screen.findByText('3 из 2417')).toBeInTheDocument()
    })

    it('соединений нет и отказ — разные слова', async () => {
        const spy = vi.spyOn(rpc, 'conns').mockResolvedValue({ schema: 1, conns: [], shown: 0, total: 0, truncated: false } as never)
        const { unmount } = render(<Diagnostics live={live({ diag: { checks: [], warn: 0, fail: 0 } })} />)
        expect(await screen.findByText(/ни одно соединение не идёт через выходы/)).toBeInTheDocument()
        unmount()
        spy.mockResolvedValue({ ok: false, error: 'conntrack недоступен' } as never)
        render(<Diagnostics live={live({ diag: { checks: [], warn: 0, fail: 0 } })} />)
        expect(await screen.findByText('Ядро steer не отдало соединения.')).toBeInTheDocument()
    })
})

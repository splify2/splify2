import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Requests from '@/components/sections/Requests'
import { History } from '@/lib/history'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import type { Spec, Status } from '@/lib/model'
import { live } from './fixtures'

// Экран «Запросы», соединения и трафик: кто, куда, через какой выход, правило и узел — по
// соединениям, которые ядро повело в выходы; сколько унёс каждый клиент; скорость и история выходов.

const SPEC = {
    schema: 1,
    outputs: { pool: { name: 'pool', kind: 'interface', devices: ['wgt', 'wgt2'] }, 'nl-vpn': { name: 'nl-vpn', kind: 'interface', device: 'wgt' }, reserve: { name: 'reserve', kind: 'interface', device: 'sbx0' } },
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

const open = (patch: Parameters<typeof live>[0] = {}) => {
    render(<Requests live={live({ conns: CONNS as never, ...patch })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Соединения' }))
}

describe('запросы: соединения', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        pending.saved = SPEC
        pending.applied = SPEC
        vi.spyOn(rpc, 'specGet').mockResolvedValue(SPEC)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue(SPEC)
        vi.spyOn(rpc, 'leases').mockResolvedValue({ leases: [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.2', name: 'iPhone' }] })
    })

    it('кто, куда, выход и правило; правило названо точно, когда в выход ведёт одно', async () => {
        open()
        expect(await screen.findByText('iPhone')).toBeInTheDocument()
        expect(screen.getByText('162.159.135.232:443')).toBeInTheDocument()
        expect(screen.getByText('правило Discord')).toBeInTheDocument()
        // Счётчики ядра Linux: ↓ — ответ, ↑ — исходное направление.
        expect(screen.getByText(/↓ 8,6 КБ ↑ 2,3 КБ/)).toBeInTheDocument()
        expect(screen.getByText('одно из правил: YouTube, Instagram')).toBeInTheDocument()
        expect(screen.getByText('устанавливается')).toBeInTheDocument()
        expect(screen.getByText('[2a00:1450::e]:443')).toBeInTheDocument()
        expect(screen.getByText('выход убран')).toBeInTheDocument()
    })

    it('узел выхода назван, когда ядро его знает', async () => {
        open({ status: { outputs: { reserve: { kind: 'vless', up: true, vless: { node: 'Хельсинки 1', up: true } } }, channels: [] } as unknown as Status })
        expect(await screen.findByText('узел Хельсинки 1')).toBeInTheDocument()
    })

    it('поиск — по имени устройства, адресу, выходу и правилу', async () => {
        open()
        const input = await screen.findByPlaceholderText(/Устройство, адрес, выход или правило/)
        fireEvent.input(input, { target: { value: 'youtube' } })
        await waitFor(() => expect(screen.queryByText('iPhone')).toBeNull())
        expect(screen.getByText('142.250.74.14:443')).toBeInTheDocument()
        fireEvent.input(input, { target: { value: 'iphone' } })
        await waitFor(() => expect(screen.getByText('iPhone')).toBeInTheDocument())
        expect(screen.queryByText('142.250.74.14:443')).toBeNull()
    })

    it('ответ обрезан ядром — сказано, сколько показано из скольких', () => {
        open({ conns: { ...CONNS, shown: 3, total: 2417, truncated: true } as never })
        expect(screen.getByText('3 из 2417')).toBeInTheDocument()
    })

    it('соединений нет и отказ — разные слова', () => {
        open({ conns: { schema: 1, conns: [], shown: 0, total: 0, truncated: false } as never })
        expect(screen.getByText(/ни одно соединение не идёт через выходы/)).toBeInTheDocument()
    })

    it('отказ ядра сказан словами', () => {
        open({ conns: { ok: false, error: 'conntrack недоступен' } as never })
        expect(screen.getByText('Не удалось получить список соединений. Проверьте на главной, что ядро запущено.')).toBeInTheDocument()
    })

    it('вкладка «Трафик»: клиенты по счётчикам соединений, самый тяжёлый первым', async () => {
        render(<Requests live={live({ conns: CONNS as never })} />)
        fireEvent.click(screen.getByRole('button', { name: 'Трафик' }))
        expect(await screen.findByText('iPhone')).toBeInTheDocument()
        expect(screen.getByText('↓ 8,6 КБ ↑ 2,3 КБ')).toBeInTheDocument()
        // У остальных счётчиков нет — их в клиентах нет вовсе: нуль был бы неправдой.
        expect(screen.queryByText('192.168.1.7')).toBeNull()
    })

    it('вкладка «Трафик»: скорость выхода — сумма его устройств, с историей за сутки', () => {
        const history = new History()
        const t = Date.now()
        history.push(t - 5000, 'dev:wgt', 100_000, 2_000_000)
        history.push(t, 'dev:wgt', 100_000, 2_000_000)
        history.push(t - 5000, 'dev:wgt2', 0, 1_000_000)
        history.push(t, 'dev:wgt2', 0, 1_000_000)
        const status = { outputs: { pool: { kind: 'interface', up: true, devices: ['wgt', 'wgt2'] } }, channels: [] } as unknown as Status
        render(<Requests live={live({ history, status, devs: { wgt: { rx: '1048576', tx: '2048' }, wgt2: { rx: '1048576', tx: '0' } } })} />)
        fireEvent.click(screen.getByRole('button', { name: 'Трафик' }))
        expect(screen.getByText('pool')).toBeInTheDocument()
        expect(screen.getByText('↓ 3,0 Мбит/с')).toBeInTheDocument()
        expect(screen.getByText('↑ 100 кбит/с')).toBeInTheDocument()
        expect(screen.getByRole('img', { name: 'Скорость выхода pool за сутки' })).toBeInTheDocument()
        expect(screen.getByText('пик 3,0 Мбит/с')).toBeInTheDocument()
        expect(screen.getByText('всего ↓ 2,0 МБ ↑ 2,0 КБ')).toBeInTheDocument()
    })
})

import { render, screen } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Status } from '@/lib/model'
import { live } from './fixtures'

// Выход спеки kind: xsteer, чей клиент держит демон ядра steer 2.0. Клиент под демоном файла
// состояния не пишет — xsteer_state прежде перечислял только туннели netifd, и такой выход на
// панели не появлялся вовсе («Интерфейсов xsteer нет» при работающем выходе). Теперь бэкенд
// отдаёт карту `outputs` с ответом демона (`steer ctl helper`), и панель показывает то, что
// демон знает: подключён ли и с каких пор, перезапуски, модуль другой версии.

const h = vi.hoisted(() => ({ xsteerState: vi.fn(), devices: vi.fn(), xsteerLink: vi.fn(), xsteerLinkPut: vi.fn() }))
vi.mock('@/lib/rpc', () => ({ rpc: h }))
const { default: XsteerPanel } = await import('@/components/XsteerPanel')

const status = {
    schema: 1,
    features: ['xslink', 'xsteer_state'],
    outputs: { xa: { name: 'xa', kind: 'xsteer', device: 'xa', up: true } },
    channels: [],
} as unknown as Status

const helper = (p: object) => ({
    schema: 1, out: 'xa', helper: 'xsteer', running: true, up: true, since: Math.floor(Date.now() / 1000) - 120,
    started: 0, restarts: 0, module: 'steer-xsteer', module_ver: '2.0.0', ...p,
})

function mount(outputs: Record<string, unknown>) {
    h.xsteerState.mockResolvedValue({ ok: true, tunnels: {}, outputs })
    h.devices.mockResolvedValue({ devices: [] })
    render(<XsteerPanel live={live({ status })} />)
}

describe('выход xsteer под демоном ядра', () => {
    beforeEach(() => vi.clearAllMocks())

    it('виден на панели: подключён и с каких пор, перезапуски', async () => {
        mount({ xa: { helper: helper({ restarts: 2 }), state: null } })
        expect(await screen.findByText('xa')).toBeInTheDocument()
        expect(screen.getByText('подключён')).toBeInTheDocument()
        expect(screen.getByText(/2 мин назад/)).toBeInTheDocument()
        expect(screen.getByText('2')).toBeInTheDocument()
        expect(screen.queryByText(/Интерфейсов xsteer нет/)).toBeNull()
        // Ссылки xs:// у выхода спеки нет: у него нет интерфейса сети.
        expect(screen.queryByText('Показать ссылку xs://')).toBeNull()
    })

    it('модуль другой версии — сказано и названо действие', async () => {
        mount({ xa: { helper: helper({ running: false, up: false, rejected: true, last_down: 'модуль steer-xsteer версии 1.9.0, а ядро 2.0.0' }), state: null } })
        expect(await screen.findByText('модуль другой версии — обновите ядро')).toBeInTheDocument()
    })

    it('демон о выходе не знает и файла нет — «состояния нет», а не выдуманные числа', async () => {
        mount({ xa: { helper: null, state: null } })
        expect(await screen.findByText(/Состояния нет/)).toBeInTheDocument()
    })

    it('клиент без демона пишет файл — видны хаб и рукопожатие', async () => {
        mount({
            xa: {
                helper: null, age: 1,
                state: { up: true, mtu: 1420, conns: 1, hub: '198.51.100.7:443', hub_key: 'K', handshake_age: 5, tx_packets: 0, tx_bytes: 0, rx_packets: 0, rx_bytes: 0, dropped: 0 },
            },
        })
        expect(await screen.findByText('198.51.100.7:443')).toBeInTheDocument()
        expect(screen.getByText('5 с назад')).toBeInTheDocument()
    })
})

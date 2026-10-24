import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RulesTab from '@/components/tabs/RulesTab'
import { isDevice, withDeviceAll } from '@/lib/devicevpn'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import type { Spec } from '@/lib/model'
import { live } from './fixtures'

// «Весь трафик устройства — в VPN» (пожелание пользователей): выбрать устройство и выход — и всё
// его соединение идёт через выход. В спеке это правило {from: устройство, scope: device, any};
// что ядро его принимает, проверяет tests/specv2-engine.test.ts (настоящее ядро).

const AWG = { name: 'awg', kind: 'interface' as const, devices: ['awg0'], on_fail: 'drop' as const }
const DIRECT = { name: 'direct', kind: 'direct' as const }
const base = (channels: Spec['channels'] = []): Spec => ({ outputs: { direct: DIRECT, awg: AWG }, channels })

describe('правило «весь трафик устройства»', () => {
    it('заводит правило: одно устройство, весь трафик, scope device', () => {
        const next = withDeviceAll(base(), 'aa:bb:cc:dd:ee:01', 'Телевизор', 'awg')
        expect(next.channels).toEqual([
            { name: 'Телевизор: весь трафик', out: 'awg', from: ['aa:bb:cc:dd:ee:01'], scope: 'device', match: { any: true } },
        ])
    })

    it('повторный выбор того же устройства правит выход и включает, а не плодит правила', () => {
        const once = withDeviceAll(base(), 'AA:BB:CC:DD:EE:01', 'Телевизор', 'awg')
        const off = { ...once, channels: [{ ...once.channels[0], enabled: false }] }
        const twice = withDeviceAll({ ...off, outputs: { ...off.outputs, nl: { name: 'nl', kind: 'interface', devices: ['wg1'] } } }, 'aa:bb:cc:dd:ee:01', 'Телевизор', 'nl')
        expect(twice.channels).toHaveLength(1)
        expect(twice.channels[0]).toMatchObject({ out: 'nl', enabled: true })
    })

    it('имя занято — добавляется номер', () => {
        const a = withDeviceAll(base(), '192.168.1.5', 'ТВ', 'awg')
        const b = withDeviceAll(a, '192.168.1.6', 'ТВ', 'awg')
        expect(b.channels.map((c) => c.name)).toEqual(['ТВ: весь трафик', 'ТВ: весь трафик 2'])
    })

    it('устройство — MAC или одиночный адрес; подсеть и диапазон — нет', () => {
        for (const ok of ['aa:bb:cc:dd:ee:01', '192.168.1.50', '192.168.1.50/32', '2001:db8::7', '2001:db8::7/128']) expect(isDevice(ok)).toBe(true)
        for (const no of ['192.168.1.0/24', '192.168.1.1-192.168.1.9', 'aa:bb', 'tv', '']) expect(isDevice(no)).toBe(false)
    })
})

function mount(s: Spec) {
    vi.spyOn(rpc, 'specGet').mockResolvedValue(s as never)
    vi.spyOn(rpc, 'appliedGet').mockResolvedValue(s as never)
    return render(<RulesTab live={live({ status: { outputs: s.outputs } as never })} />)
}

beforeEach(() => {
    vi.restoreAllMocks()
    pending.saved = null
    pending.applied = null
    pending.dirty = false
    vi.spyOn(rpc, 'manifest').mockResolvedValue({} as never)
    vi.spyOn(rpc, 'localLists').mockResolvedValue({ files: {} })
    vi.spyOn(rpc, 'leases').mockResolvedValue({ leases: [{ mac: 'aa:bb:cc:dd:ee:01', ip: '192.168.1.50', name: 'Телевизор' }, { mac: 'aa:bb:cc:dd:ee:02', ip: '192.168.1.51', name: 'Ноутбук' }] })
    vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] })
    vi.spyOn(rpc, 'specSet').mockResolvedValue({ ok: true })
})

describe('экран правил: «Устройство целиком в VPN»', () => {
    it('выбрать устройство из списка и выход — правило появляется, в правило ложится MAC', async () => {
        mount(base())
        fireEvent.click(await screen.findByRole('button', { name: 'Устройство целиком в VPN' }))
        await screen.findByText('Весь трафик устройства — в VPN')
        await screen.findByText('Телевизор')
        const include = screen.getByRole('button', { name: 'Включить' })
        expect(include).toBeDisabled()
        fireEvent.click(screen.getAllByRole('radio')[0])
        expect(include).not.toBeDisabled()
        fireEvent.click(include)
        await waitFor(() => expect(pending.saved!.channels).toHaveLength(1))
        expect(pending.saved!.channels[0]).toMatchObject({ out: 'awg', from: ['aa:bb:cc:dd:ee:01'], scope: 'device', match: { any: true } })
        expect(screen.queryByText('Весь трафик устройства — в VPN')).toBeNull()
    })

    it('адрес руками: подсеть отвергается словами, одиночный адрес принимается', async () => {
        mount(base())
        fireEvent.click(await screen.findByRole('button', { name: 'Устройство целиком в VPN' }))
        const field = await screen.findByPlaceholderText('192.168.1.50')
        fireEvent.input(field, { target: { value: '192.168.1.0/24' } })
        expect(await screen.findByText(/подсеть и диапазон не подходят/)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Включить' })).toBeDisabled()
        fireEvent.input(field, { target: { value: '192.168.1.77' } })
        await waitFor(() => expect(screen.getByRole('button', { name: 'Включить' })).not.toBeDisabled())
    })

    it('выхода VPN нет — сказано, что сначала настроить', async () => {
        mount({ outputs: { direct: DIRECT }, channels: [] })
        fireEvent.click(await screen.findByRole('button', { name: 'Устройство целиком в VPN' }))
        expect(await screen.findByText(/Сначала настройте выход VPN/)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Включить' })).toBeNull()
    })
})

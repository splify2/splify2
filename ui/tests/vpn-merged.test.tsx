import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Console from '@/components/Console'
import Vpn from '@/components/sections/Vpn'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import type { Spec, Status } from '@/lib/model'
import { live } from './fixtures'

// R-156: экран VPN один — и в LuCI, и в приложении для компьютера. Ссылки подписок (добавить,
// обновить, удалить) стоят на нём сверху, под ними — свои туннели, узлы подписок, XSTEER и выходы.
// Прежде доска приложения показывала только ссылки, а остальное жило лишь под LuCI.

const SPEC = { schema: 1, outputs: {}, channels: [] } as unknown as Spec
const SUBS = { subs: [{ name: 'sub1', title: 'Мой провайдер', url: 'https://panel.example/sub/KEY', kind: 'url', path: '/etc/steer/subs/sub1', present: true, used: 0 }] }

describe('VPN: один экран', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        pending.saved = SPEC
        pending.applied = SPEC
        vi.spyOn(rpc, 'specGet').mockResolvedValue(SPEC)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue(SPEC)
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
        vi.spyOn(rpc, 'subList').mockResolvedValue(SUBS as never)
        vi.spyOn(rpc, 'outboundGeo').mockResolvedValue({} as never)
        vi.spyOn(rpc, 'helper').mockResolvedValue({ code: 1, stdout: '' })
    })

    it('подписки, свои туннели, узлы подписок и XSTEER — на одном экране', async () => {
        render(<Vpn live={live({ status: { schema: 1, outputs: {}, channels: [] } as unknown as Status })} />)
        expect(await screen.findByText('Мой провайдер')).toBeInTheDocument()
        expect(screen.getByText('panel.example')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Добавить подписку/ })).toBeInTheDocument()
        for (const name of [/Свои туннели/, /Узлы и автообновление/, /XSTEER/])
            expect(screen.getByRole('button', { name })).toBeInTheDocument()
    })

    it('добавление ссылки уходит в subSet со свободным именем', async () => {
        const set = vi.spyOn(rpc, 'subSet').mockResolvedValue({ ok: true, usable: 3 } as never)
        render(<Vpn live={live()} />)
        fireEvent.click(await screen.findByRole('button', { name: /Добавить подписку/ }))
        fireEvent.input(screen.getByPlaceholderText(/https/i), { target: { value: 'https://other.example/sub/K2' } })
        fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
        await waitFor(() => expect(set).toHaveBeenCalledWith('https://other.example/sub/K2', 'sub2', ''))
    })

    it('приложение для компьютера (доска со слоем настроек) показывает тот же экран', async () => {
        vi.spyOn(rpc, 'status').mockResolvedValue({ schema: 1, outputs: {}, channels: [] } as never)
        vi.spyOn(rpc, 'diag').mockResolvedValue({ warn: 0, fail: 0, checks: [] })
        vi.spyOn(rpc, 'netInfo').mockResolvedValue({ uptime: 1, active_clients: 0 })
        vi.spyOn(rpc, 'engine').mockResolvedValue({ present: true, vless: true, version: '1.1.2', enabled: true, running: true })
        vi.spyOn(rpc, 'devStats').mockResolvedValue({ devices: {} })
        vi.spyOn(rpc, 'engineState').mockResolvedValue({ instances: {}, log: [] })
        vi.spyOn(rpc, 'uiGet').mockResolvedValue({ state: JSON.stringify({ setup: 1 }) } as never)
        render(<Console board settingsHost={document.createElement('div')} />)
        fireEvent.click(screen.getAllByRole('button', { name: /VPN/ })[0])
        expect(await screen.findByText('Мой провайдер')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Свои туннели/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /XSTEER/ })).toBeInTheDocument()
    })
})

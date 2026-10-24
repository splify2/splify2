import { render, screen } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Console from '@/components/Console'
import { rpc } from '@/lib/rpc'
import type { Status } from '@/lib/model'

// R-156: один интерфейс в двух оболочках. Под LuCI пульт теперь тоже «доской» (как в приложении
// для компьютера): главная блоками, правила открываются с неё. Различие — только то, что приносит
// оболочка: у приложения настройки в своём слое (settingsHost), под LuCI их пункт остаётся в рельсе.

const STATUS: Status = {
    schema: 1,
    outputs: { vpn: { name: 'vpn', kind: 'interface', device: 'wg0', devices: ['wg0'], up: true } },
    channels: [{ name: 'youtube', out: 'vpn', kind: 'domains', live: true, bytes: 1024, lists: 1, channels: ['youtube'] }],
}

const nav = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]

describe('доска под LuCI', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        vi.spyOn(rpc, 'status').mockResolvedValue(STATUS)
        vi.spyOn(rpc, 'diag').mockResolvedValue({ warn: 0, fail: 0, checks: [] })
        vi.spyOn(rpc, 'netInfo').mockResolvedValue({ uptime: 15120, active_clients: 9 })
        vi.spyOn(rpc, 'engine').mockResolvedValue({ present: true, vless: true, version: '1.1.2', enabled: true, running: true })
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [{ name: 'wg0', up: true, kind: 'wireguard' }] })
        vi.spyOn(rpc, 'devStats').mockResolvedValue({ devices: {} })
        vi.spyOn(rpc, 'engineState').mockResolvedValue({ instances: {}, log: [] })
        vi.spyOn(rpc, 'subInfo').mockResolvedValue({ kind: 'none', path: '', present: false } as never)
        vi.spyOn(rpc, 'uiGet').mockResolvedValue({ state: JSON.stringify({ setup: 1 }) } as never)
    })

    it('подложка несёт признак доски — по нему работают общие стили board.css', async () => {
        const { container } = render(<Console board />)
        await screen.findByRole('heading', { name: 'Маршрутизация работает' })
        expect(container.querySelector('.sp-root.sp-board-on')).not.toBeNull()
        expect(container.querySelector('.sp-board')).not.toBeNull()
    })

    it('без доски признака нет', async () => {
        const { container } = render(<Console />)
        await screen.findByRole('heading', { name: 'Маршрутизация работает' })
        expect(container.querySelector('.sp-board-on')).toBeNull()
    })

    it('в рельсе нет «Правил» (они с главной), но «Настройки» остаются, когда слоя оболочки нет', async () => {
        render(<Console board />)
        await screen.findByRole('heading', { name: 'Маршрутизация работает' })
        expect(screen.queryAllByRole('button', { name: /^\s*Правила/ })).toHaveLength(0)
        for (const name of ['Главная', 'VPN', 'DNS', 'Запросы', 'Диагностика', 'Настройки'])
            expect(nav(new RegExp(name))).toBeInTheDocument()
    })

    it('с слоем настроек оболочки пункта «Настройки» в рельсе нет', async () => {
        const host = document.createElement('div')
        render(<Console board settingsHost={host} />)
        await screen.findByRole('heading', { name: 'Маршрутизация работает' })
        expect(screen.queryAllByRole('button', { name: /^\s*Настройки/ })).toHaveLength(0)
    })
})

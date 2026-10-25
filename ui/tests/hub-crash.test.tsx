import { render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Console from '@/components/Console'
import { pending } from '@/lib/pending'
import { live } from './fixtures'
import { rpc } from '@/lib/rpc'
import type { Status } from '@/lib/model'

const STATUS: Status = {
    schema: 1,
    outputs: {
        vpn: { name: 'vpn', kind: 'interface', device: 'wg0', devices: ['wg0'], up: true },
        vl: { name: 'vl', kind: 'vless', device: 'steer0', up: true, sub_file: '/etc/steer/sub.txt', node: -1 },
    },
    channels: [{ name: 'youtube', out: 'vpn', live: true, bytes: 1024 }],
}

describe('вкладки не гаснут после первого опроса', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        vi.spyOn(rpc, 'status').mockResolvedValue(STATUS)
        vi.spyOn(rpc, 'diag').mockResolvedValue({ warn: 0, fail: 0, checks: [] })
        vi.spyOn(rpc, 'netInfo').mockResolvedValue({ uptime: 60, active_clients: 2 })
        vi.spyOn(rpc, 'engine').mockResolvedValue({ present: true, vless: true, version: '1.2.3', enabled: true, running: true })
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [{ name: 'wg0', up: true, kind: 'wireguard' }] })
        vi.spyOn(rpc, 'devStats').mockResolvedValue({ devices: {} })
        vi.spyOn(rpc, 'engineState').mockResolvedValue({ instances: {}, log: [] })
        vi.spyOn(rpc, 'localLists').mockResolvedValue({ files: {} })
        vi.spyOn(rpc, 'subInfo').mockResolvedValue({ kind: 'none', path: '', present: false } as never)
    })

    const nav = (name: RegExp) => screen.getAllByRole('button', { name })[0]

    it('VPN: список входов остаётся после ответов роутера', async () => {
        render(<Console />)
        await screen.findByRole('heading', { name: 'Маршрутизация работает' })
        nav(/VPN/).click()
        // Имя «VLESS» есть и у входа, и у кнопки создания выхода ниже — берём первое.
        expect((await screen.findAllByRole('button', { name: /Узлы и автообновление/ }))[0]).toBeInTheDocument()
        await new Promise((r) => setTimeout(r, 300))
        expect(screen.getAllByRole('button', { name: /Узлы и автообновление/ })[0]).toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: /XSTEER/ })[0]).toBeInTheDocument()
    })

    it('Настройки: список входов остаётся после ответов роутера', async () => {
        render(<Console />)
        await screen.findByRole('heading', { name: 'Маршрутизация работает' })
        nav(/Настройки/).click()
        expect(await screen.findByRole('button', { name: /Каталог/ })).toBeInTheDocument()
        await new Promise((r) => setTimeout(r, 300))
        expect(screen.getByRole('button', { name: /Каталог/ })).toBeInTheDocument()
    })

    it('переход VPN → Настройки → VPN ничего не гасит', async () => {
        render(<Console />)
        await screen.findByRole('heading', { name: 'Маршрутизация работает' })
        nav(/VPN/).click()
        await screen.findByRole('button', { name: /Узлы и автообновление/ })
        nav(/Настройки/).click()
        await screen.findByRole('button', { name: /Каталог/ })
        nav(/VPN/).click()
        expect(await screen.findByRole('button', { name: /Узлы и автообновление/ })).toBeInTheDocument()
    })

    it('вход в подпункт и обратно', async () => {
        render(<Console />)
        await screen.findByRole('heading', { name: 'Маршрутизация работает' })
        nav(/Настройки/).click()
        ;(await screen.findByRole('button', { name: /Общее/ })).click()
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Общее' })).toBeInTheDocument())
        screen.getAllByRole('button', { name: /Настройки/ }).at(-1)!.click()
        expect(await screen.findByRole('button', { name: /Каталог/ })).toBeInTheDocument()
    })
})

// «Отдельного блока для подписок нет» — с живого экрана. Блок на подписку я сделал, а завести
// вторую подписку было негде: экран VLESS оставался про локации. Теперь он про подписки —
// добавить, обновить, удалить, — а локация выбирается там, где собирают выход.
describe('подписки: список, добавление, удаление', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
    })

    it('показаны все подписки, а не одна', async () => {
        vi.spyOn(rpc, 'subList').mockResolvedValue({
            subs: [
                { name: 'main', title: 'Riot', path: '/etc/steer/sub.txt', present: true, kind: 'url', url: 'https://a/1', used: 2, bytes: 20408 },
                { name: 'blue', title: 'Blue', path: '/etc/steer/subs/blue.txt', present: true, kind: 'url', url: 'https://b/2', used: 0, bytes: 800 },
            ],
            hwid: 'splify2-2fd9',
        } as never)
        const { default: VlessScreen } = await import('@/components/VlessScreen')
        render(<VlessScreen />)
        expect(await screen.findByText('Riot')).toBeInTheDocument()
        expect(screen.getByText('Blue')).toBeInTheDocument()
        /* Подпись переименована вместе со смыслом: число говорит, ЧЕМ ЗАНЯТА подписка, а не
           сколько в ней узлов (VlessScreen). Стенд остался на прежних словах и краснел на
           верном экране. */
        expect(screen.getByText(/используется выходами: 2/)).toBeInTheDocument()
    })

    it('новая подписка уезжает со своим именем', async () => {
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [], hwid: '' } as never)
        const set = vi.spyOn(rpc, 'subSet').mockResolvedValue({ ok: true } as never)
        const { default: VlessScreen } = await import('@/components/VlessScreen')
        render(<VlessScreen />)
        const nameField = await screen.findByLabelText('имя подписки')
        const urlField = screen.getByLabelText('ссылка подписки')
        ;(nameField as HTMLInputElement).value = 'blue'
        nameField.dispatchEvent(new Event('input', { bubbles: true }))
        ;(urlField as HTMLInputElement).value = 'https://panel.example/sub/9f3c'
        urlField.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 20))
        screen.getByRole('button', { name: /Добавить/ }).click()
        await waitFor(() => expect(set).toHaveBeenCalled())
        expect(set.mock.calls[0][0]).toBe('https://panel.example/sub/9f3c')
        expect(set.mock.calls[0][1]).toBe('blue')
    })

    it('занятая подписка не удаляется молча — бэкенд отказывает, и отказ виден', async () => {
        vi.spyOn(rpc, 'subList').mockResolvedValue({
            subs: [{ name: 'main', path: '/etc/steer/sub.txt', present: true, kind: 'url', url: 'https://a/1', used: 2 }],
        } as never)
        const del = vi.spyOn(rpc, 'subDel').mockResolvedValue({ ok: false, error: 'подписка занята выходами: 2' } as never)
        const { notify } = await import('@/lib/notify')
        const said = vi.spyOn({ notify }, 'notify')
        const { default: VlessScreen } = await import('@/components/VlessScreen')
        render(<VlessScreen />)
        ;(await screen.findByRole('button', { name: /удалить/i })).click()
        await waitFor(() => expect(del).toHaveBeenCalledWith('main'))
        expect(said).toBeDefined()
    })
})

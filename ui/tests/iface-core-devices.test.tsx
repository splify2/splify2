import { render, screen } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import IfacesPanel from '@/components/IfacesPanel'
import PoolEditor from '@/components/PoolEditor'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { type Spec } from '@/lib/model'
import { live } from './fixtures'

// «СВОИ ТУННЕЛИ» — ТОЛЬКО СВОИ. Перечень туннельных устройств (`devices`) включает и те, что
// для своего выхода заводит само ядро: у выхода vless «vpn» это TUN «vpn». На экране «Свои
// туннели» оно стояло строкой с зелёной точкой, как будто человек настроил WireGuard. Включение
// заводило выход kind=interface «vpn2» ПОВЕРХ туннеля ядра, а выключение вынимало устройство из
// выходов, которые его называют, — вплоть до удаления самого выхода (локацию смешанного пула оно
// выбрасывало из пула). Бэкенд теперь называет такие устройства (`owner: 'steer'`), и панель их не
// показывает. Редактор выхода — наоборот: устройство ядра там предлагается нарочно, как
// локация пула (смешанный пул, I-161), и от поля не меняется.

const VLESS: Spec = {
    schema: 1,
    outputs: {
        vpn: { name: 'vpn', kind: 'vless', sub_file: '/etc/steer/sub.txt', node: -1, on_fail: 'drop' },
    },
    channels: [],
}

describe('IfacesPanel: устройства выходов ядра не показываются среди своих туннелей', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        pending.saved = VLESS
        pending.applied = VLESS
        vi.spyOn(rpc, 'specGet').mockResolvedValue(VLESS)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue(VLESS)
        vi.spyOn(rpc, 'specSet').mockResolvedValue({ ok: true } as never)
    })

    function devices(list: { name: string; up?: boolean; kind?: string; owner?: 'steer' }[]) {
        vi.spyOn(rpc, 'devices').mockResolvedValue({
            devices: list.map((d) => ({ up: true, kind: '', ...d })),
        })
    }

    it('устройство выхода vless — нет в перечне, обычный WireGuard — есть', async () => {
        devices([
            { name: 'vpn', owner: 'steer' },
            { name: 'wg0', kind: 'wireguard' },
        ])
        render(<IfacesPanel live={live()} />)
        expect(await screen.findByRole('switch', { name: 'wg0' })).toBeInTheDocument()
        expect(screen.queryByRole('switch', { name: 'vpn' })).toBeNull()
        expect(screen.queryByText('vpn')).toBeNull()
        expect(screen.getByText('wg0')).toBeInTheDocument()
    })

    it('устройство выхода ядра, не поднятое сейчас, скрыто так же', async () => {
        devices([
            { name: 'vpn', up: false, owner: 'steer' },
            { name: 'wg0', kind: 'wireguard' },
        ])
        render(<IfacesPanel live={live()} />)
        expect(await screen.findByRole('switch', { name: 'wg0' })).toBeInTheDocument()
        expect(screen.queryByRole('switch', { name: 'vpn' })).toBeNull()
    })

    it('устройства всех видов выходов ядра скрыты, свои туннели разных протоколов остаются', async () => {
        // vless, hysteria2, прокси, xsteer под демоном, awg — у каждого устройство заводит ядро.
        devices([
            { name: 'vpn', owner: 'steer' },
            { name: 'hy', owner: 'steer' },
            { name: 'tr', owner: 'steer' },
            { name: 'hub', owner: 'steer' },
            { name: 'ax', kind: 'wireguard', owner: 'steer' },
            { name: 'wg0', kind: 'wireguard' },
            { name: 'awg0', kind: 'amneziawg' },
            { name: 'xs-home', kind: 'xsteer' },
            { name: 'tun0' },
        ])
        render(<IfacesPanel live={live()} />)
        await screen.findByRole('switch', { name: 'wg0' })
        const names = screen.getAllByRole('switch').map((s) => s.getAttribute('aria-label'))
        expect(names).toEqual(['wg0', 'awg0', 'xs-home', 'tun0'])
    })

    it('остались одни устройства ядра — «Туннельных устройств нет», а не строки с переключателем', async () => {
        devices([
            { name: 'vpn', owner: 'steer' },
            { name: 'hy', up: false, owner: 'steer' },
        ])
        render(<IfacesPanel live={live()} />)
        expect(await screen.findByText(/Туннельных устройств нет/)).toBeInTheDocument()
        expect(screen.queryAllByRole('switch')).toHaveLength(0)
    })

    it('локации смешанного пула (части подписок) здесь не показываются — выключателем из пула их не выбросить', async () => {
        // Пул из двух локаций подписки и своего туннеля, как его собирает редактор выхода: устройства
        // частей — устройства ядра, и в пуле стоят они все.
        const POOL: Spec = {
            schema: 1,
            outputs: {
                vpn: { name: 'vpn', kind: 'interface', devices: ['vpn-1', 'vpn-2', 'wg0'], device: 'vpn-1', on_fail: 'drop' },
                'vpn-1': { name: 'vpn-1', kind: 'vless', sub_file: '/etc/steer/sub.txt', nodes: [0, 1], on_fail: 'drop', part_of: 'vpn' },
                'vpn-2': { name: 'vpn-2', kind: 'vless', sub_file: '/etc/steer/subs/blue.txt', node: 0, on_fail: 'drop', part_of: 'vpn' },
            },
            channels: [],
        }
        pending.saved = POOL
        pending.applied = POOL
        vi.spyOn(rpc, 'specGet').mockResolvedValue(POOL)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue(POOL)
        devices([
            { name: 'vpn-1', owner: 'steer' },
            { name: 'vpn-2', up: false, owner: 'steer' },
            { name: 'wg0', kind: 'wireguard' },
        ])
        render(<IfacesPanel live={live()} />)
        const wg = await screen.findByRole('switch', { name: 'wg0' })
        expect(wg).toHaveAttribute('aria-checked', 'true')
        expect(screen.getAllByRole('switch')).toHaveLength(1)
    })

    it('включение своего туннеля рядом с устройством ядра не заводит выход поверх него и не трогает выход ядра', async () => {
        devices([
            { name: 'vpn', owner: 'steer' },
            { name: 'wg0', kind: 'wireguard' },
        ])
        render(<IfacesPanel live={live()} />)
        ;(await screen.findByRole('switch', { name: 'wg0' })).click()
        await new Promise((r) => setTimeout(r, 10))
        await pending.flush()
        const out = pending.saved!.outputs
        expect(Object.keys(out)).toEqual(['vpn', 'wg0'])
        expect(out.vpn).toEqual(VLESS.outputs.vpn)
        expect(out.wg0).toMatchObject({ kind: 'interface', device: 'wg0', devices: ['wg0'] })
        expect(out.vpn2).toBeUndefined()
    })

    it('бэкенд старше поля: устройство показывается, как показывалось', async () => {
        devices([{ name: 'vpn' }, { name: 'wg0', kind: 'wireguard' }])
        render(<IfacesPanel live={live()} />)
        expect(await screen.findByRole('switch', { name: 'wg0' })).toBeInTheDocument()
        expect(screen.getByRole('switch', { name: 'vpn' })).toBeInTheDocument()
    })
})

describe('VPN: подпись строки «Свои туннели» называет то же, что покажет экран', () => {
    // Пул, назвавший устройство обычного выхода vless («nl») рядом со своим туннелем: на экране
    // «Свои туннели» остаётся только wg0, и подпись под входом не должна называть «nl».
    const POOL: Spec = {
        schema: 1,
        outputs: {
            nl: { name: 'nl', kind: 'vless', sub_file: '/etc/steer/sub.txt', node: -1, on_fail: 'drop' },
            pool: { name: 'pool', kind: 'interface', devices: ['nl', 'wg0'], device: 'nl', on_fail: 'drop' },
        },
        channels: [],
    }

    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        pending.saved = POOL
        pending.applied = POOL
        vi.spyOn(rpc, 'specGet').mockResolvedValue(POOL)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue(POOL)
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
        vi.spyOn(rpc, 'outboundGeo').mockResolvedValue({} as never)
        vi.spyOn(rpc, 'helper').mockResolvedValue({ code: 1, stdout: '' })
    })

    async function subtitle() {
        const { default: Vpn } = await import('@/components/sections/Vpn')
        render(<Vpn live={live({ status: { schema: 1, outputs: {}, channels: [] } })} />)
        const row = await screen.findByText('Свои туннели')
        return () => row.parentElement?.textContent ?? ''
    }

    it('устройство выхода ядра в пуле не названо «взятым» туннелем', async () => {
        vi.spyOn(rpc, 'devices').mockResolvedValue({
            devices: [
                { name: 'nl', up: true, kind: '', owner: 'steer' },
                { name: 'wg0', up: true, kind: 'wireguard' },
            ],
        })
        const text = await subtitle()
        await vi.waitFor(() => expect(text()).toContain('взяты: wg0'))
        expect(text()).not.toContain('nl')
    })

    it('бэкенд старше поля: подпись как раньше', async () => {
        vi.spyOn(rpc, 'devices').mockResolvedValue({
            devices: [
                { name: 'nl', up: true, kind: '' },
                { name: 'wg0', up: true, kind: 'wireguard' },
            ],
        })
        const text = await subtitle()
        await vi.waitFor(() => expect(text()).toContain('взяты: nl, wg0'))
    })
})

describe('PoolEditor: устройство выхода ядра по-прежнему предлагается локацией пула', () => {
    const WITH_POOLS = live({
        status: { schema: 1, features: ['lan_devices', 'nodes', 'pool'], outputs: {}, channels: [] },
    })
    // Устройство задано в спеке явно — тогда у строки есть подсказка «выход nl»: чьё это устройство.
    const NL: Spec = {
        schema: 1,
        outputs: {
            nl: { name: 'nl', kind: 'vless', sub_file: '/etc/steer/sub.txt', node: -1, device: 'nl-tun', on_fail: 'drop' },
        },
        channels: [],
    }

    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
        vi.spyOn(rpc, 'devices').mockResolvedValue({
            devices: [
                { name: 'nl-tun', up: false, kind: '', owner: 'steer' },
                { name: 'wg0', up: true, kind: 'wireguard' },
            ],
        })
    })

    it('устройство ядра с пометкой есть в «Своих туннелях» редактора, с подсказкой «выход nl», и берётся в пул', async () => {
        let saved: Spec | null = null
        render(
            <PoolEditor spec={NL} live={WITH_POOLS} onCancel={() => {}} onSave={(next) => { saved = next }} />,
        )
        const core = await screen.findByRole('button', { name: /nl-tun/ })
        expect(core).toHaveTextContent('выход nl')
        expect(screen.getByRole('button', { name: /wg0/ })).toBeInTheDocument()

        const title = screen.getByLabelText('имя выхода') as HTMLInputElement
        title.value = 'mix'
        title.dispatchEvent(new Event('input', { bubbles: true }))
        core.click()
        await new Promise((r) => setTimeout(r, 10))
        ;(screen.getByRole('button', { name: /wg0/ })).click()
        await new Promise((r) => setTimeout(r, 10))
        ;(await screen.findByRole('button', { name: /Сохранить выход/ })).click()
        await new Promise((r) => setTimeout(r, 10))
        expect(saved!.outputs.mix).toMatchObject({ kind: 'interface', devices: ['nl-tun', 'wg0'] })
    })
})

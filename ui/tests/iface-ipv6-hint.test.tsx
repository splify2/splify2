import { render, screen } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import IfacesPanel from '@/components/IfacesPanel'
import PoolEditor from '@/components/PoolEditor'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { type Spec } from '@/lib/model'
import { live } from './fixtures'

// КЛЮЧ ipv6 НОВОМУ ВЫХОДУ — ПО АДРЕСУ IPv6 У УСТРОЙСТВА, А НЕ ВСЛЕПУЮ. Прежде панель писала `nat`
// каждому новому выходу-интерфейсу. У туннеля WARP (один адрес IPv6) это верно, а у туннеля
// WireGuard с одним IPv4 ядро встречает выход с `nat` красным отказом «у X нет адреса IPv6» — вместо
// прежней жёлтой строки, и «Есть поломки» получал почти каждый такой туннель. Теперь бэкенд в
// перечне устройств (`devices`) называет подсказку: nat — адрес IPv6 у устройства есть, off — нет;
// панель пишет её, а где бэкенд молчит — не пишет ничего: ключ допишет самолечение при apply
// по тому же правилу. Явный ключ прежнего выхода редактор сохраняет как был.

const EMPTY: Spec = { schema: 1, outputs: {}, channels: [] }

describe('IfacesPanel: ключ ipv6 при включении устройства', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        pending.saved = EMPTY
        pending.applied = EMPTY
        vi.spyOn(rpc, 'specGet').mockResolvedValue(EMPTY)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue(EMPTY)
        vi.spyOn(rpc, 'specSet').mockResolvedValue({ ok: true } as never)
        vi.spyOn(rpc, 'devices').mockResolvedValue({
            devices: [
                { name: 'warp', up: true, kind: 'wireguard', ipv6: 'nat' },
                { name: 'wgv4', up: true, kind: 'wireguard', ipv6: 'off' },
                { name: 'wgx', up: true, kind: 'wireguard' },
            ],
        })
    })

    async function turnOn(dev: string) {
        render(<IfacesPanel live={live()} />)
        ;(await screen.findByRole('switch', { name: dev })).click()
        await new Promise((r) => setTimeout(r, 10))
        await pending.flush()
        return pending.saved!.outputs[dev]
    }

    it('у устройства есть адрес IPv6 — выход с ipv6: nat', async () => {
        expect((await turnOn('warp')).ipv6).toBe('nat')
    })

    it('у туннеля только IPv4 — ipv6: off, а не nat', async () => {
        expect((await turnOn('wgv4')).ipv6).toBe('off')
    })

    it('бэкенд о устройстве не знает — ключа нет, его допишет самолечение при apply', async () => {
        const o = await turnOn('wgx')
        expect(o.ipv6).toBeUndefined()
        expect('ipv6' in o).toBe(false)
    })

    it('старый бэкенд без подсказок — ключа нет, как и у неизвестного устройства', async () => {
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [{ name: 'warp', up: true, kind: 'wireguard' }] })
        expect((await turnOn('warp')).ipv6).toBeUndefined()
    })
})

describe('PoolEditor: ключ ipv6 новому и прежнему выходу', () => {
    const WITH_POOLS = live({
        status: { schema: 1, features: ['lan_devices', 'nodes', 'pool'], outputs: {}, channels: [] },
    })

    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
    })

    function devices(list: { name: string; ipv6?: 'nat' | 'off' }[]) {
        vi.spyOn(rpc, 'devices').mockResolvedValue({
            devices: list.map((d) => ({ up: true, kind: 'wireguard', ...d })),
        })
    }

    const click = async (name: RegExp | string) => {
        ;(await screen.findByRole('button', { name })).click()
        await new Promise((r) => setTimeout(r, 10))
    }

    async function save(spec: Spec, pick: (RegExp | string)[], name?: string) {
        let saved: Spec | null = null
        render(
            <PoolEditor spec={spec} name={name} live={WITH_POOLS} onCancel={() => {}} onSave={(next) => { saved = next }} />,
        )
        if (!name) {
            const title = screen.getByLabelText('имя выхода') as HTMLInputElement
            title.value = 'vpn'
            title.dispatchEvent(new Event('input', { bubbles: true }))
        }
        for (const p of pick) await click(p)
        await click(/Сохранить выход/)
        return saved!.outputs
    }

    it('одно устройство с адресом IPv6 — новый выход с nat', async () => {
        devices([{ name: 'wgA', ipv6: 'nat' }])
        expect((await save(EMPTY, [/wgA/])).vpn.ipv6).toBe('nat')
    })

    it('одно устройство без адреса IPv6 — новый выход с off', async () => {
        devices([{ name: 'wgB', ipv6: 'off' }])
        expect((await save(EMPTY, [/wgB/])).vpn.ipv6).toBe('off')
    })

    it('пул из устройств с одной подсказкой — ключ пула', async () => {
        devices([{ name: 'wgA', ipv6: 'nat' }, { name: 'wgC', ipv6: 'nat' }])
        const out = await save(EMPTY, [/wgA/, /wgC/])
        expect(out.vpn.devices).toEqual(['wgA', 'wgC'])
        expect(out.vpn.ipv6).toBe('nat')
    })

    it('пул из устройств с разными подсказками — ключа нет: по устройству решит самолечение', async () => {
        devices([{ name: 'wgA', ipv6: 'nat' }, { name: 'wgB', ipv6: 'off' }])
        const out = await save(EMPTY, [/wgA/, /wgB/])
        expect(out.vpn.devices).toEqual(['wgA', 'wgB'])
        expect(out.vpn.ipv6).toBeUndefined()
    })

    it('у одного устройства из двух подсказки нет — ключа нет', async () => {
        devices([{ name: 'wgA', ipv6: 'nat' }, { name: 'wgX' }])
        expect((await save(EMPTY, [/wgA/, /wgX/])).vpn.ipv6).toBeUndefined()
    })

    it('прежний выход: записанный ключ сохраняется как был', async () => {
        devices([{ name: 'wgB', ipv6: 'off' }])
        const spec: Spec = {
            ...EMPTY,
            outputs: { vpn: { name: 'vpn', kind: 'interface', devices: ['wgB'], device: 'wgB', on_fail: 'drop', ipv6: 'nat' } },
        }
        expect((await save(spec, [], 'vpn')).vpn.ipv6).toBe('nat')
    })

    it('прежний выход без ключа остаётся без ключа — подсказка новым выходам не нужна прежним', async () => {
        devices([{ name: 'wgA', ipv6: 'nat' }])
        const spec: Spec = {
            ...EMPTY,
            outputs: { vpn: { name: 'vpn', kind: 'interface', devices: ['wgA'], device: 'wgA', on_fail: 'drop' } },
        }
        expect((await save(spec, [], 'vpn')).vpn.ipv6).toBeUndefined()
    })
})

import { render, screen, waitFor, within } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '@/components/sections/Home'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { type Live } from '@/lib/live'
import type { Spec, Status } from '@/lib/model'

// splify2#35. Пул, собранный ЦЕЛИКОМ из локаций подписок, своего блока в столбце «Выходы» не
// получает: его локации уже стоят строками в блоках подписок. Условие было написано через
// `some`, и пул СМЕШАННЫЙ — свои туннели awg1/awg2 плюс локация подписки — пропадал целиком
// вместе с состоянием своих туннелей, которое больше нигде на обзоре не показано.
//
// Сторожится здесь: блок пропадает, только когда частями подписок являются ВСЕ устройства пула.

function liveWith(outputs: Status['outputs']): Live {
    return {
        status: { outputs, channels: [{ name: 'всё', out: 'vpn', kind: 'any', live: true }] } as unknown as Status,
        devices: {},
        net: { uptime: 1200, active_clients: 0 },
        diag: undefined,
        build: { present: true, version: '1.3.0' },
        releases: [],
        selfUpdate: { current: '1.2.5' },
        refresh: () => undefined,
    } as unknown as Live
}

/** Спека кладётся в хранилище сразу: пока её нет, понять, какие устройства — части подписок,
 *  нечем, и блок показан при любом условии — стенд зеленел бы до правки. */
function mockSpec(spec: Spec) {
    pending.saved = spec
    pending.applied = spec
}

/** Столбец «Выходы»: заголовки карточек ищутся только в нём — имя пула стоит и в строке правила. */
async function outputsColumn() {
    const h = await waitFor(() => screen.getByText('Выходы'))
    return h.parentElement!.parentElement!
}

const SUB = '/etc/steer/sub.txt'

describe('обзор: пул со своими туннелями и локацией подписки', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [{ name: 'main', path: SUB, present: true, kind: 'url' }] } as never)
        vi.spyOn(rpc, 'subQuota').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'outboundGeo').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'vlessNodes').mockRejectedValue(new Error('нет метода'))
    })

    it('смешанный пул показан своим блоком', async () => {
        mockSpec({
            schema: 1,
            outputs: {
                vpn: { name: 'vpn', kind: 'interface', devices: ['awg1', 'awg2', 'vpn-1'], device: 'awg1', on_fail: 'drop' },
                'vpn-1': { name: 'vpn-1', kind: 'vless', sub_file: SUB, node: 0, part_of: 'vpn' },
            },
            channels: [{ name: 'всё', out: 'vpn', match: { any: true } }],
        } as unknown as Spec)
        render(
            <Home
                live={liveWith({
                    vpn: { kind: 'interface', device: 'awg1', up: true, devices: ['awg1', 'awg2', 'vpn-1'] },
                    'vpn-1': { kind: 'vless', device: 'vpn-1', up: true },
                } as unknown as Status['outputs'])}
                onSection={() => undefined}
                onAddRule={() => undefined}
            />,
        )
        const col = await outputsColumn()
        await waitFor(() => expect(within(col).getByText('в пуле vpn')).toBeInTheDocument())
        expect(within(col).getByText('vpn')).toBeInTheDocument()
    })

    it('пул только из локаций подписок своего блока не получает', async () => {
        mockSpec({
            schema: 1,
            outputs: {
                vpn: { name: 'vpn', kind: 'interface', devices: ['vpn-1', 'vpn-2'], device: 'vpn-1', on_fail: 'drop' },
                'vpn-1': { name: 'vpn-1', kind: 'vless', sub_file: SUB, node: 0, part_of: 'vpn' },
                'vpn-2': { name: 'vpn-2', kind: 'vless', sub_file: SUB, node: 1, part_of: 'vpn' },
            },
            channels: [{ name: 'всё', out: 'vpn', match: { any: true } }],
        } as unknown as Spec)
        render(
            <Home
                live={liveWith({
                    vpn: { kind: 'interface', device: 'vpn-1', up: true, devices: ['vpn-1', 'vpn-2'] },
                    'vpn-1': { kind: 'vless', device: 'vpn-1', up: true },
                    'vpn-2': { kind: 'vless', device: 'vpn-2', up: true },
                } as unknown as Status['outputs'])}
                onSection={() => undefined}
                onAddRule={() => undefined}
            />,
        )
        const col = await outputsColumn()
        // Спека приезжает не сразу: ждём, пока локации встанут под подпиской с приписью пула.
        await waitFor(() => expect(within(col).getAllByText('в пуле vpn').length).toBe(2))
        expect(within(col).queryByText('vpn')).toBeNull()
    })
})

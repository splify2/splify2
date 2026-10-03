import { render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '@/components/sections/Home'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { type Live } from '@/lib/live'
import type { Spec, Status } from '@/lib/model'

// Исключение страны («Не брать»): ядро перезапускает клиент части пула и берёт другой узел, а
// устройство зовётся так же (`vpn-1`). Измерение страны и отклика ключилось по имени устройства и
// страницу не перемеряло — на обзоре оставалось «Великобритания … 846 мс», хотя узел уже
// исключён и трафик идёт через другой («в выходе пишет, что не берётся, а он всё равно
// используется»). Ключ теперь включает процесс клиента и активные узлы.

const SUB = '/etc/steer/sub.txt'

function liveWith(pid: number, node: string): Live {
    return {
        status: {
            outputs: {
                vpn: { kind: 'interface', device: 'vpn-1', up: true, devices: ['vpn-1', 'vpn-2'] },
                'vpn-1': {
                    kind: 'vless', device: 'vpn-1', up: true, sub_file: SUB,
                    vless: { pid, node, up: true, want: 1, slots: 1, active: [{ index: 0, name: node }] },
                },
                'vpn-2': { kind: 'vless', device: 'vpn-2', up: true, sub_file: SUB },
            },
            channels: [{ name: 'всё', out: 'vpn', kind: 'any', live: true }],
        } as unknown as Status,
        devices: {},
        net: { uptime: 1200, active_clients: 0 },
        diag: undefined,
        build: { present: true, version: '1.3.0' },
        releases: [],
        selfUpdate: { current: '1.2.5' },
        refresh: () => undefined,
    } as unknown as Live
}

describe('обзор: клиент пула сменил узел при том же устройстве', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        const spec = {
            schema: 1,
            outputs: {
                vpn: { name: 'vpn', kind: 'interface', devices: ['vpn-1', 'vpn-2'], device: 'vpn-1', on_fail: 'drop' },
                'vpn-1': { name: 'vpn-1', kind: 'vless', sub_file: SUB, node: 0, part_of: 'vpn' },
                'vpn-2': { name: 'vpn-2', kind: 'vless', sub_file: SUB, node: 1, part_of: 'vpn' },
            },
            channels: [{ name: 'всё', out: 'vpn', match: { any: true } }],
        } as unknown as Spec
        pending.saved = spec
        pending.applied = spec
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [{ name: 'main', path: SUB, present: true, kind: 'url' }] } as never)
        vi.spyOn(rpc, 'subQuota').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'vlessNodes').mockRejectedValue(new Error('нет метода'))
    })

    it('страна и отклик перемеряются, прежняя Великобритания не остаётся', async () => {
        let at = 'GB'
        const geo = vi.spyOn(rpc, 'outboundGeo').mockImplementation((async (out: string) =>
            out === 'vpn-1' ? { output: out, cc: at, ip: '203.0.113.1', ms: at === 'GB' ? 846 : 120 } : {}) as never)
        const { rerender } = render(<Home live={liveWith(100, '🇬🇧 Великобритания')} onSection={() => undefined} onAddRule={() => undefined} />)
        await waitFor(() => expect(screen.getByText(/846/)).toBeInTheDocument())

        /* Исключили Великобританию: клиент перезапущен (другой pid) и взял немецкий узел. */
        at = 'DE'
        const before = geo.mock.calls.filter((c) => c[0] === 'vpn-1').length
        rerender(<Home live={liveWith(200, '🇩🇪 Германия')} onSection={() => undefined} onAddRule={() => undefined} />)
        await waitFor(() => expect(geo.mock.calls.filter((c) => c[0] === 'vpn-1').length).toBeGreaterThan(before), { timeout: 1500 })
        await waitFor(() => expect(screen.getByText(/120/)).toBeInTheDocument(), { timeout: 1500 })
        expect(screen.queryByText(/846/)).toBeNull()
        expect(screen.queryByText('Великобритания')).toBeNull()
    })
})

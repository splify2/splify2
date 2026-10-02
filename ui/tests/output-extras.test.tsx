import { render, screen } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import type { Output, OutputStatus, Spec } from '@/lib/model'
import { live } from './fixtures'

// Что ядро 2.0 печатает у выхода сверх «работает ли», а строка выхода в «Выходах» не говорила:
// пути моста tgws, которые помощник отставил (`paths_down`), выключенную проверку сертификата
// (`insecure`) и IPv6 от хоста (`prefix`, `nat6`, `ipv6_applied`). У моста tgws устройства нет
// вовсе, и строка говорила о нём «устройство не выбрано».

const spec = (outputs: Record<string, Output>): Spec => ({ schema: 1, outputs, channels: [] }) as Spec

async function row(outputs: Record<string, Output>, st: Record<string, OutputStatus>) {
    const s = spec(outputs)
    pending.saved = s
    pending.applied = s
    vi.spyOn(rpc, 'specGet').mockResolvedValue(s)
    vi.spyOn(rpc, 'appliedGet').mockResolvedValue(s)
    const { default: PoolList } = await import('@/components/PoolList')
    render(<PoolList live={live({ status: { schema: 1, outputs: st, channels: [] } })} />)
}

describe('строка выхода: что ещё знает ядро', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
        vi.spyOn(rpc, 'outboundGeo').mockResolvedValue({} as never)
    })

    it('мост tgws — «мост Telegram», а не «устройство не выбрано»; отставленные пути названы', async () => {
        const PD = [
            { dc: 2, media: false, domain: 'kws2.web.telegram.org', at: 1790000000, until: 1790000600 },
            { dc: 4, media: true, domain: 'kws4-1.web.telegram.org', at: 1790000000, until: 1790000600 },
        ]
        await row(
            { tg: { name: 'tg', kind: 'tgws' } },
            { tg: { name: 'tg', kind: 'tgws', mark: '0x00100000', paths_down: PD } as OutputStatus },
        )
        expect(await screen.findByText('мост Telegram · не отвечает путей: 2')).toBeInTheDocument()
        expect(screen.queryByText(/устройство не выбрано/)).toBeNull()
    })

    it('мост tgws без отставленных путей — без слов о беде', async () => {
        await row(
            { tg: { name: 'tg', kind: 'tgws' } },
            { tg: { name: 'tg', kind: 'tgws', paths_down: [] } as unknown as OutputStatus },
        )
        expect(await screen.findByText('мост Telegram')).toBeInTheDocument()
    })

    it('VLESS без проверки сертификата — сказано', async () => {
        await row(
            { vl: { name: 'vl', kind: 'vless', sub_file: '/etc/steer/sub.txt' } },
            { vl: { name: 'vl', kind: 'vless', device: 'vl', up: true, nodes: [], insecure: true } as OutputStatus },
        )
        expect(await screen.findByText(/сертификат не проверяется/)).toBeInTheDocument()
    })

    it('IPv6 префиксом хоста — назван префикс, выведенный ядром', async () => {
        await row(
            { host: { name: 'host', kind: 'interface', device: 'wg1', ipv6: 'routed' } },
            { host: { name: 'host', kind: 'interface', device: 'wg1', up: true, ipv6: 'routed', prefix: '2001:db8:1::/56' } as OutputStatus },
        )
        expect(await screen.findByText(/IPv6 2001:db8:1::\/56/)).toBeInTheDocument()
    })

    it('префикс не узнать — беда словом', async () => {
        await row(
            { host: { name: 'host', kind: 'interface', device: 'wg1', ipv6: 'routed' } },
            { host: { name: 'host', kind: 'interface', device: 'wg1', up: true, prefix: null } as unknown as OutputStatus },
        )
        expect(await screen.findByText(/префикс IPv6 не определён/)).toBeInTheDocument()
    })

    it('IPv6 одним адресом хоста: подмена есть и подмены нет', async () => {
        await row(
            { a: { name: 'a', kind: 'interface', device: 'wg1', ipv6: 'nat' }, b: { name: 'b', kind: 'interface', device: 'wg2', ipv6: 'nat' } },
            {
                a: { name: 'a', kind: 'interface', device: 'wg1', up: true, nat6: true, nat6_by: 'steer' } as OutputStatus,
                b: { name: 'b', kind: 'interface', device: 'wg2', up: true, nat6: false } as OutputStatus,
            },
        )
        expect(await screen.findByText(/IPv6 адресом хоста/)).toBeInTheDocument()
        expect(screen.getByText(/IPv6 не подменяется/)).toBeInTheDocument()
    })

    it('ключ ipv6 не действует на платформе — сказано вместо префикса', async () => {
        await row(
            { host: { name: 'host', kind: 'interface', device: 'wg1', ipv6: 'routed' } },
            { host: { name: 'host', kind: 'interface', device: 'wg1', up: true, ipv6_applied: false } as OutputStatus },
        )
        expect(await screen.findByText(/IPv6 от хоста здесь не действует/)).toBeInTheDocument()
        expect(screen.queryByText(/префикс IPv6/)).toBeNull()
    })
})

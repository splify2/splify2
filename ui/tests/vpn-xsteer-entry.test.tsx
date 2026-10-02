import { render, screen } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import type { Spec } from '@/lib/model'
import { live } from './fixtures'

// Строка «XSTEER» в разделе VPN считала только устройства netifd («xs-…»): у выхода спеки
// kind: xsteer, чей клиент держит ядро steer, устройство названо по выходу, и строка говорила
// «интерфейсов нет» при работающем выходе.

const SPEC = { schema: 1, outputs: { xa: { name: 'xa', kind: 'xsteer' } }, channels: [] } as unknown as Spec

describe('VPN: вход XSTEER', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        pending.saved = SPEC
        pending.applied = SPEC
        vi.spyOn(rpc, 'specGet').mockResolvedValue(SPEC)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue(SPEC)
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [{ name: 'xa', up: true, kind: 'tun' }] } as never)
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
        vi.spyOn(rpc, 'outboundGeo').mockResolvedValue({} as never)
        vi.spyOn(rpc, 'helper').mockResolvedValue({ code: 1, stdout: '' })
    })

    it('выход kind: xsteer назван в строке входа', async () => {
        const { default: Vpn } = await import('@/components/sections/Vpn')
        render(<Vpn live={live({ status: { schema: 1, outputs: {}, channels: [] } })} />)
        const row = await screen.findByText('XSTEER')
        expect(row.parentElement?.textContent).toContain('xa')
    })
})

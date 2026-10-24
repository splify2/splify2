import { fireEvent, render, screen } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import IfacesPanel from '@/components/IfacesPanel'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { type Spec } from '@/lib/model'
import { live } from './fixtures'

// R-134: у своего туннеля (awg, wireguard) есть проверка отклика — тем же outbound_probe, что у
// любого выхода. Туннель, не взятый в выход, проверить нечем: кнопки нет.

const SPEC: Spec = {
    schema: 1,
    outputs: { awg0: { name: 'awg0', kind: 'interface', device: 'awg0', devices: ['awg0'], on_fail: 'drop' } },
    channels: [],
}

describe('IfacesPanel: проверка отклика своего туннеля', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        pending.saved = SPEC
        pending.applied = SPEC
        vi.spyOn(rpc, 'specGet').mockResolvedValue(SPEC)
        vi.spyOn(rpc, 'devices').mockResolvedValue({
            devices: [
                { name: 'awg0', up: true, kind: 'amneziawg' },
                { name: 'wg9', up: true, kind: 'wireguard' },
            ],
        })
    })

    it('кнопка только у взятого в выход; отклик показан в миллисекундах', async () => {
        const probe = vi.spyOn(rpc, 'outboundProbe').mockResolvedValue({ output: 'awg0', state: 'ok', ms: 42, how: 'ping' })
        render(<IfacesPanel live={live()} />)
        await screen.findByRole('switch', { name: 'awg0' })
        expect(screen.queryByRole('button', { name: 'Проверить отклик wg9' })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Проверить отклик awg0' }))
        expect(await screen.findByText('отклик 42 мс')).toBeInTheDocument()
        expect(probe).toHaveBeenCalledWith('awg0')
    })

    it('нет ответа — слова бэкенда, а не выдуманное число', async () => {
        vi.spyOn(rpc, 'outboundProbe').mockResolvedValue({ output: 'awg0', state: 'нет ответа', ms: -1, how: 'ping' })
        render(<IfacesPanel live={live()} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Проверить отклик awg0' }))
        expect(await screen.findByText('нет ответа')).toBeInTheDocument()
    })

    it('отказ вызова — «проверка не вышла»', async () => {
        vi.spyOn(rpc, 'outboundProbe').mockRejectedValue(new Error('x'))
        render(<IfacesPanel live={live()} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Проверить отклик awg0' }))
        expect(await screen.findByText('проверка не вышла')).toBeInTheDocument()
    })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Console from '@/components/Console'
import { pending, setLoadRetry } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import type { Spec } from '@/lib/model'
import { live } from './fixtures'

// Жалоба владельца: «пропадает отображение выходов, хоть они есть» и «вместе с выходами пропадает
// показ данных у правил и dns». Причина: отказ вызова spec_get (ubus «объект не найден» после
// перезапуска rpcd, истёкшая сессия, таймаут) подменялся пустой спекой — и пустая оседала в
// общем хранилище навсегда, а первая правка записывала её поверх настоящей.

vi.mock('@/lib/live', () => ({ useLive: () => live({}) }))

const REAL = {
    schema: 1,
    outputs: { direct: { name: 'direct', kind: 'direct' }, awg: { name: 'awg', kind: 'interface', devices: ['awg0'] } },
    channels: [{ name: 'Видео', out: 'awg', match: { any: true } }],
} as unknown as Spec

function reset() {
    vi.restoreAllMocks()
    setLoadRetry([0, 0])
    const p = pending as unknown as Record<string, unknown>
    p.saved = null
    p.applied = null
    p.loadFailed = false
    p.loading = null
    p.dirty = false
    vi.spyOn(rpc, 'appliedGet').mockResolvedValue(REAL)
    vi.spyOn(rpc, 'engine').mockResolvedValue(null as never)
}

describe('отказ загрузки спеки — не пустая настройка', () => {
    beforeEach(reset)

    it('отказ вызова не подменяется пустой спекой и не оседает в хранилище', async () => {
        const get = vi.spyOn(rpc, 'specGet').mockRejectedValue(new Error('Object not found'))
        await expect(pending.load()).rejects.toThrow('Object not found')
        expect(get).toHaveBeenCalledTimes(3) // попытка и две повторные
        expect(pending.saved).toBeNull()
        expect(pending.loadFailed).toBe(true)
    })

    it('ответ без выходов — тоже отказ', async () => {
        vi.spyOn(rpc, 'specGet').mockResolvedValue({} as never)
        await expect(pending.load()).rejects.toThrow()
        expect(pending.saved).toBeNull()
    })

    it('временный отказ переживается повтором — спека настоящая', async () => {
        const get = vi.spyOn(rpc, 'specGet')
            .mockRejectedValueOnce(new Error('Object not found'))
            .mockResolvedValue(REAL)
        const s = await pending.load()
        expect(get).toHaveBeenCalledTimes(2)
        expect(Object.keys(s.outputs)).toContain('awg')
        expect(pending.loadFailed).toBe(false)
    })

    it('правка без загруженной спеки на роутер не уходит', async () => {
        vi.spyOn(rpc, 'specGet').mockRejectedValue(new Error('x'))
        const set = vi.spyOn(rpc, 'specSet').mockResolvedValue({ ok: true })
        await pending.load().catch(() => {})
        pending.edit({ schema: 1, outputs: {}, channels: [] } as unknown as Spec)
        await pending.flush()
        expect(set).not.toHaveBeenCalled()
        expect(pending.saved).toBeNull()
    })

    it('экран: «Настройки не загрузились» и «Повторить» вместо пустых разделов; повтор поднимает данные', async () => {
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] })
        vi.spyOn(rpc, 'dnsLog').mockResolvedValue({ running: true } as never)
        const get = vi.spyOn(rpc, 'specGet').mockRejectedValue(new Error('Object not found'))
        render(<Console />)
        fireEvent.click((await screen.findAllByText('Правила'))[0])
        expect(await screen.findByText('Настройки не загрузились')).toBeInTheDocument()
        expect(screen.queryByText(/Правил нет/)).toBeNull()
        get.mockResolvedValue(REAL)
        fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
        await waitFor(() => expect(screen.queryByText('Настройки не загрузились')).toBeNull())
        expect(pending.saved?.channels[0].name).toBe('Видео')
    })
})

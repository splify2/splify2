import { render, screen, fireEvent, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, Spec } from '@/lib/model'

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

import ChangesBar from '@/components/ChangesBar'
import { notify } from '@/lib/notify'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { changeText, describeChanges, revertChanges } from '@/lib/specdiff'

// «Что изменится» вместо «Применить · N» (D-P2.4): список изменений с отменой по пункту и целиком,
// «Вернуть» после удаления правила и выхода.

const ch = (name: string, out = 'direct'): Channel => ({ name, out, match: { any: true } })
const spec = (channels: Channel[], extra: Partial<Spec> = {}): Spec => ({
    outputs: { direct: { name: 'direct', kind: 'direct' }, wg0: { name: 'wg0', kind: 'interface', device: 'wg0' } },
    channels,
    ...extra,
})
const texts = (a: Spec, b: Spec) => describeChanges(a, b).map(changeText)

describe('список изменений', () => {
    it('добавлено, удалено, изменено — по именам, а не по месту', () => {
        const a = spec([ch('a'), ch('b'), ch('c')])
        const b = spec([ch('new'), ch('a'), ch('c', 'wg0')])
        expect(texts(a, b)).toEqual(expect.arrayContaining(['Добавлено правило «new»', 'Изменено правило «c»', 'Удалено правило «b»']))
        expect(texts(a, b)).toHaveLength(3)
    })

    it('перестановка — отдельная строка, и отмена возвращает порядок', () => {
        const a = spec([ch('a'), ch('b'), ch('c')])
        const b = spec([ch('c'), ch('a'), ch('b')])
        const list = describeChanges(a, b)
        expect(list.map(changeText)).toEqual(['Изменён порядок правил'])
        expect(revertChanges(b, list).channels.map((c) => c.name)).toEqual(['a', 'b', 'c'])
    })

    it('отмена одной строки не трогает соседние', () => {
        const a = spec([ch('a'), ch('b')])
        const b = spec([ch('a', 'wg0'), ch('b', 'wg0')])
        const [first] = describeChanges(a, b)
        const back = first.revert(b)
        expect(back.channels.map((c) => c.out)).toEqual(['direct', 'wg0'])
    })

    it('удалённое правило возвращается на своё место', () => {
        const a = spec([ch('a'), ch('b'), ch('c')])
        const b = spec([ch('a'), ch('c')])
        expect(revertChanges(b, describeChanges(a, b)).channels.map((c) => c.name)).toEqual(['a', 'b', 'c'])
    })

    it('выход с частями — одна строка; общие настройки — одна строка', () => {
        const a = spec([])
        const b = spec([], {
            lan_devices: ['br-lan', 'wg1'],
            outputs: { ...a.outputs, vpn: { name: 'vpn', kind: 'interface', devices: ['p.1'] }, 'p.1': { name: 'p.1', kind: 'vless', part_of: 'vpn' } },
        })
        expect(texts(a, b).sort()).toEqual(['Добавлен выход «vpn»', 'Изменены общие настройки'].sort())
        expect(Object.keys(revertChanges(b, describeChanges(a, b)).outputs)).toEqual(['direct', 'wg0'])
        expect(revertChanges(b, describeChanges(a, b)).lan_devices).toBeUndefined()
    })

    it('явное умолчание — не изменение', () => {
        const a = spec([ch('a')])
        expect(describeChanges(a, spec([{ ...ch('a'), enabled: true }]))).toEqual([])
    })
})

let disk: Spec
beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(notify).mockClear()
    disk = spec([ch('a'), ch('b')])
    vi.spyOn(rpc, 'specGet').mockImplementation(async () => structuredClone(disk))
    vi.spyOn(rpc, 'appliedGet').mockImplementation(async () => structuredClone(disk))
    vi.spyOn(rpc, 'specSet').mockResolvedValue({ ok: true } as never)
    vi.spyOn(rpc, 'apply').mockResolvedValue({ ok: true, output: '' } as never)
    // @ts-expect-error — сброс внутреннего состояния между проверками
    pending.saved = null; pending.applied = null; pending.dirty = false; pending.applying = false; pending.applyFailed = false; pending.saveError = null; pending.lastApplied = null
})
afterEach(() => { vi.useRealTimers() })

describe('удаление с «Вернуть»', () => {
    it('удалённое правило — сообщение с кнопкой, нажатие возвращает его', async () => {
        await pending.load()
        pending.edit({ ...pending.saved!, channels: [pending.saved!.channels[0]] })
        const call = vi.mocked(notify).mock.calls.find((c) => c[2])
        expect(call?.[0]).toBe('Правило «b» удалено')
        expect(call?.[2]?.label).toBe('Вернуть')
        call![2]!.run()
        expect(pending.saved!.channels.map((c) => c.name)).toEqual(['a', 'b'])
    })

    it('переименование при наборе имени — не удаление', async () => {
        await pending.load()
        pending.edit({ ...pending.saved!, channels: pending.saved!.channels.map((c, i) => (i ? { ...c, name: 'bb' } : c)) })
        expect(vi.mocked(notify).mock.calls.filter((c) => c[2])).toEqual([])
    })
})

describe('полоса «Что изменится / Что изменилось»', () => {
    it('пока пачку держат — «Что изменится» со строками; «Отменить всё» возвращает прежнее', async () => {
        await pending.load()
        const release = pending.hold()
        pending.edit({ ...pending.saved!, channels: [...pending.saved!.channels, ch('c')] })
        render(<ChangesBar />)
        expect(await screen.findByText('Добавлено правило «c»')).toBeInTheDocument()
        expect(screen.getByText('Ждёт применения: 1 изменение')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Отменить' }))
        expect(pending.saved!.channels.map((c) => c.name)).toEqual(['a', 'b'])
        await waitFor(() => expect(screen.queryByText('Добавлено правило «c»')).toBeNull())
        release()
    })

    it('после применения — «Применено: N», список по кнопке, отмена строки', async () => {
        await pending.load()
        pending.edit({ ...pending.saved!, channels: [ch('a'), ch('b', 'wg0'), ch('c')] })
        await pending.flush()
        await pending.apply()
        render(<ChangesBar />)
        expect(screen.getByText('Применено: 2 изменения')).toBeInTheDocument()
        expect(screen.queryByText('Добавлено правило «c»')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Что изменилось' }))
        expect(screen.getByText('Добавлено правило «c»')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Отменить всё' })).toBeInTheDocument()
        fireEvent.click(screen.getAllByRole('button', { name: 'Отменить' })[1])
        expect(pending.saved!.channels.map((c) => c.name)).toEqual(['a', 'b'])
    })

    it('нечего показывать — полосы нет', async () => {
        await pending.load()
        const { container } = render(<ChangesBar />)
        expect(container.querySelector('section')).toBeNull()
    })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rpc', () => ({
    rpc: { groupSelect: vi.fn(async () => ({ ok: true })) },
}))
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

import GroupEditor from '@/components/GroupEditor'
import { rpc } from '@/lib/rpc'
import type { Live } from '@/lib/live'
import type { Spec } from '@/lib/model'

// Редактор группы: способ выбора, члены по порядку, веса, выбор вручную. Проверяется то, что
// уезжает в спеку, и то, что выбор члена идёт отдельным вызовом без apply.

const spec: Spec = {
    outputs: {
        direct: { name: 'direct', kind: 'direct' },
        wg0: { name: 'wg0', kind: 'interface', device: 'wg0' },
        wg1: { name: 'wg1', kind: 'interface', device: 'wg1' },
        z: { name: 'z', kind: 'zapret' },
    },
    channels: [],
}

beforeEach(() => vi.clearAllMocks())

describe('редактор группы', () => {
    it('собирает группу: способ, члены по порядку, отказ', () => {
        const onSave = vi.fn()
        render(<GroupEditor spec={spec} onSave={onSave} onCancel={() => {}} />)
        fireEvent.input(screen.getByLabelText('имя группы'), { target: { value: 'fast' } })
        fireEvent.click(screen.getByText('Самый быстрый'))
        fireEvent.click(screen.getByRole('button', { name: 'wg1' }))
        fireEvent.click(screen.getByRole('button', { name: 'wg0' }))
        fireEvent.click(screen.getByText(/Сохранить группу/))
        const next = onSave.mock.calls[0][0] as Spec
        expect(next.outputs.fast).toMatchObject({ kind: 'group', pick: 'latency', members: ['wg1', 'wg0'], on_fail: 'drop' })
    })

    it('в члены не предлагаются direct и выход обхода — у них нет устройства', () => {
        render(<GroupEditor spec={spec} onSave={() => {}} onCancel={() => {}} />)
        expect(screen.queryByRole('button', { name: 'direct' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'z' })).toBeNull()
    })

    it('пустая группа не сохраняется', () => {
        const onSave = vi.fn()
        render(<GroupEditor spec={spec} onSave={onSave} onCancel={() => {}} />)
        fireEvent.input(screen.getByLabelText('имя группы'), { target: { value: 'g' } })
        fireEvent.click(screen.getByText(/Сохранить группу/))
        expect(onSave).not.toHaveBeenCalled()
    })

    it('балансировка пишет веса по порядку членов', () => {
        const onSave = vi.fn()
        render(<GroupEditor spec={spec} onSave={onSave} onCancel={() => {}} />)
        fireEvent.input(screen.getByLabelText('имя группы'), { target: { value: 'bal' } })
        fireEvent.click(screen.getByText('Поровну по весам'))
        fireEvent.click(screen.getByRole('button', { name: 'wg0' }))
        fireEvent.click(screen.getByRole('button', { name: 'wg1' }))
        fireEvent.input(screen.getByLabelText('вес wg0'), { target: { value: '3' } })
        fireEvent.click(screen.getByText(/Сохранить группу/))
        const g = (onSave.mock.calls[0][0] as Spec).outputs.bal
        expect(g).toMatchObject({ pick: 'balance', members: ['wg0', 'wg1'], weights: [3, 1] })
    })

    it('группу нельзя взять членом самой себя и её потомков', () => {
        const s: Spec = { ...spec, outputs: { ...spec.outputs, g1: { name: 'g1', kind: 'group', pick: 'order', members: ['wg0'] }, g2: { name: 'g2', kind: 'group', pick: 'order', members: ['g1'] } } }
        render(<GroupEditor spec={s} name="g1" onSave={() => {}} onCancel={() => {}} />)
        expect(screen.queryByRole('button', { name: 'g2' })).toBeNull()
        expect(screen.getByRole('button', { name: 'wg1' })).toBeInTheDocument()
    })

    it('выбор члена у группы вручную — отдельный вызов, без сохранения спеки', async () => {
        const s: Spec = { ...spec, outputs: { ...spec.outputs, eu: { name: 'eu', kind: 'group', pick: 'manual', members: ['wg0', 'wg1'] } } }
        const live = {
            status: { outputs: { eu: { kind: 'group', group: { pick: 'manual', members: ['wg0', 'wg1'], selected: 'wg0', alive: ['wg0', 'wg1'], select: 'wg0' } } } },
            refresh: vi.fn(),
        } as unknown as Live
        const onSave = vi.fn()
        render(<GroupEditor spec={s} name="eu" live={live} onSave={onSave} onCancel={() => {}} />)
        fireEvent.click(screen.getAllByText('Выбрать')[1])
        await waitFor(() => expect(rpc.groupSelect).toHaveBeenCalledWith('eu', 'wg1'))
        expect(onSave).not.toHaveBeenCalled()
    })
})

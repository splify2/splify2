import { fireEvent, render, screen } from '@testing-library/preact'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rpc', () => ({ rpc: {} }))
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

import GroupEditor from '@/components/GroupEditor'
import { live } from './fixtures'
import type { Spec } from '@/lib/model'

// Страны членов группы (`only`, `exclude`): выбор есть при «первом живом» и «самом быстром», когда
// ядро умеет `group_only`; «только» и «кроме» одной страны вместе не бывают.

const spec: Spec = {
    outputs: {
        direct: { name: 'direct', kind: 'direct' },
        wg0: { name: 'wg0', kind: 'interface', device: 'wg0' },
    },
    channels: [],
}
const can = live({ status: { features: ['group_only'], outputs: {}, channels: [] } as never })

beforeEach(() => vi.clearAllMocks())

describe('страны членов группы', () => {
    it('«Кроме этих стран» уходит в спеку как exclude, «только» снимает её оттуда', () => {
        const onSave = vi.fn()
        render(<GroupEditor spec={spec} live={can} onSave={onSave} onCancel={() => {}} />)
        fireEvent.input(screen.getByLabelText('имя группы'), { target: { value: 'g' } })
        fireEvent.click(screen.getByRole('button', { name: 'wg0' }))
        const only = screen.getByRole('group', { name: 'Только эти страны' })
        const ex = screen.getByRole('group', { name: 'Кроме этих стран' })
        fireEvent.click(ex.querySelector('button')!)
        const first = ex.querySelector('button')!.textContent
        fireEvent.click(screen.getByText(/Сохранить группу/))
        let g = (onSave.mock.calls[0][0] as Spec).outputs.g
        expect(g.exclude).toHaveLength(1)
        expect(g.only).toBeUndefined()
        expect(first).toBeTruthy()
        /* Та же страна в «только»: из «кроме» уходит. */
        fireEvent.click(only.querySelector('button')!)
        fireEvent.click(screen.getByText(/Сохранить группу/))
        g = (onSave.mock.calls[1][0] as Spec).outputs.g
        expect(g.only).toHaveLength(1)
        expect(g.exclude).toBeUndefined()
    })

    it('без умения ядра выбора стран нет', () => {
        render(<GroupEditor spec={spec} live={live()} onSave={() => {}} onCancel={() => {}} />)
        expect(screen.queryByRole('group', { name: 'Только эти страны' })).toBeNull()
    })

    it('у «выбора вручную» и «поровну» выбора стран нет', () => {
        render(<GroupEditor spec={spec} live={can} onSave={() => {}} onCancel={() => {}} />)
        fireEvent.click(screen.getByText('Выбор вручную'))
        expect(screen.queryByRole('group', { name: 'Только эти страны' })).toBeNull()
    })
})

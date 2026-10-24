import { fireEvent, render, screen } from '@testing-library/preact'
import { describe, expect, it, vi } from 'vitest'
import { Hint } from '@/components/ui/hint'

// Подсказка должна открываться без мыши: тапом на телефоне и с клавиатуры. И тап по ней не
// должен срабатывать как клик по строке или кнопке, в которой она стоит.

function setup() {
    const parent = vi.fn()
    render(
        <div onClick={parent}>
            <Hint tip="Пояснение">слово</Hint>
            <p>мимо</p>
        </div>,
    )
    return { parent, trigger: screen.getByText('слово').parentElement as HTMLElement }
}

describe('подсказка', () => {
    it('тап открывает, повторный тап закрывает, родитель клика не видит', () => {
        const { parent, trigger } = setup()
        // телефон: фокус приходит раньше клика
        fireEvent.focus(trigger)
        fireEvent.click(trigger)
        expect(screen.getByRole('tooltip')).toHaveTextContent('Пояснение')
        expect(trigger.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)
        fireEvent.click(trigger)
        expect(screen.queryByRole('tooltip')).toBeNull()
        expect(parent).not.toHaveBeenCalled()
    })

    it('тап мимо закрывает закреплённую подсказку', () => {
        const { trigger } = setup()
        fireEvent.click(trigger)
        expect(screen.getByRole('tooltip')).toBeInTheDocument()
        fireEvent.pointerDown(screen.getByText('мимо'))
        expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('Enter открывает, Escape закрывает', () => {
        const { parent, trigger } = setup()
        fireEvent.keyDown(trigger, { key: 'Enter' })
        expect(screen.getByRole('tooltip')).toBeInTheDocument()
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(screen.queryByRole('tooltip')).toBeNull()
        expect(parent).not.toHaveBeenCalled()
    })

    it('на ПК наведение открывает, уход мыши закрывает', () => {
        const { trigger } = setup()
        fireEvent.mouseEnter(trigger)
        expect(screen.getByRole('tooltip')).toBeInTheDocument()
        fireEvent.mouseLeave(trigger)
        expect(screen.queryByRole('tooltip')).toBeNull()
    })
})

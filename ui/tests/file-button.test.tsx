import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/preact'
import { FileButton } from '@/components/formbits'

describe('FileButton', () => {
    it('показывает русскую кнопку, а не родное «Choose File», и отдаёт выбранный файл', () => {
        const onFile = vi.fn()
        const { container } = render(<FileButton accept=".txt" label="Файл со списком" onFile={onFile} />)
        expect(screen.getByRole('button', { name: 'Выбрать файл' })).toBeTruthy()
        const input = container.querySelector('input[type=file]') as HTMLInputElement
        expect(input.className).toContain('hidden')
        const f = new File(['a'], 'a.txt')
        Object.defineProperty(input, 'files', { value: [f] })
        fireEvent(input, new Event('change', { bubbles: true }))
        expect(onFile).toHaveBeenCalledWith(f)
    })
})

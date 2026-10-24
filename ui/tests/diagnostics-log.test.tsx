import { fireEvent, render, screen } from '@testing-library/preact'
import { describe, expect, it, vi } from 'vitest'
import Diagnostics from '@/components/sections/Diagnostics'
import { live } from './fixtures'

// Журнал ядра: строки приходят из общего опроса (live.engineLog), а экран лишь просит тему.

const DIAG = { checks: [], warn: 0, fail: 0 }

describe('диагностика: журнал steer', () => {
    it('поиск по журналу фильтрует строки и позволяет сбросить фильтр', () => {
        const lines = [
            '2026-09-21 12:00:00 steer[100]: routing packet to wg0',
            '2026-09-21 12:00:01 steer[100]: dns query youtube.com',
            '2026-09-21 12:00:02 steer[100]: warning interface down',
        ]
        render(<Diagnostics live={live({ diag: DIAG, engineLog: lines })} />)

        expect(screen.getByText(/dns query youtube\.com/)).toBeInTheDocument()
        expect(screen.getByText(/routing packet to wg0/)).toBeInTheDocument()

        const input = screen.getByPlaceholderText('Поиск по журналу…')
        fireEvent.input(input, { target: { value: 'youtube' } })

        expect(screen.getByText(/dns query youtube\.com/)).toBeInTheDocument()
        expect(screen.queryByText(/routing packet to wg0/)).toBeNull()

        fireEvent.click(screen.getByLabelText('Очистить поиск'))
        expect(screen.getByText(/routing packet to wg0/)).toBeInTheDocument()
    })

    it('журнал просится у общего опроса, пока экран открыт, и отпускается при уходе', () => {
        const release = vi.fn()
        const want = vi.fn(() => release)
        const { unmount } = render(<Diagnostics live={live({ diag: DIAG, want })} />)
        expect(want).toHaveBeenCalledWith('engineLog')
        expect(release).not.toHaveBeenCalled()
        unmount()
        expect(release).toHaveBeenCalledTimes(1)
    })

    it('ответа ещё нет — «Загрузка», а не «ядро ничего не писало»', () => {
        render(<Diagnostics live={live({ diag: DIAG })} />)
        expect(screen.getByText(/Загрузка журнала/)).toBeInTheDocument()
    })
})

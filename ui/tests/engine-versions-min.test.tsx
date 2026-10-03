import { act, render, screen } from '@testing-library/preact'
import { describe, expect, it } from 'vitest'
import EngineCard from '@/components/EngineCard'

// QEMU-стенд, «Настройки → О ПО», ядро 2.0.0 при перечне выпусков, где 2.0 ещё нет: в выборе
// стояло «steer 1.5.9 — свежая», а кнопка говорила «Переустановить». Нажатие ставило ядро 1.x,
// которое спеку v2 не читает, — маршрутизация вставала. Выпуски младше min_version не
// предлагаются, а подпись кнопки — про ВЫБРАННУЮ версию.

const noop = () => {}
const ENGINE = { present: true, vless: true, version: '2.0.0', min_version: '2.0.0' }

function options() {
    return [...(screen.getByLabelText('Версия ядра') as HTMLSelectElement).options].map((o) => o.textContent)
}

describe('выбор версии ядра', () => {
    it('выпуски младше минимума не предлагаются', () => {
        render(<EngineCard engine={ENGINE} releases={{ arch: 'x86_64', versions: ['2.0.1', '2.0.0', '1.5.9'] }} onInstalled={noop} />)
        expect(options()).toEqual(['2.0.1 — свежая', '2.0.0'])
        expect(screen.getByRole('button', { name: /Обновить до 2\.0\.1/ })).toBeInTheDocument()
    })

    it('выбрана стоящая — «Переустановить»', async () => {
        render(<EngineCard engine={ENGINE} releases={{ arch: 'x86_64', versions: ['2.0.1', '2.0.0', '1.5.9'] }} onInstalled={noop} />)
        const sel = screen.getByLabelText('Версия ядра') as HTMLSelectElement
        sel.value = '2.0.0'
        // Напрямую, а не fireEvent.change: обёртка переименовывает change в input (см.
        // backup-card.test.tsx), а у select preact/compat слушает change.
        await act(() => { sel.dispatchEvent(new Event('change', { bubbles: true })) })
        expect(await screen.findByRole('button', { name: /Переустановить/ })).toBeInTheDocument()
    })

    it('в перечне только 1.x — сказано, что выпуска нужной версии нет, а не «проверьте интернет»', () => {
        render(<EngineCard engine={ENGINE} releases={{ arch: 'x86_64', versions: ['1.5.9', '1.5.8'] }} onInstalled={noop} />)
        expect(options()).toEqual(['выпуска ядра 2.0.0 или новее ещё нет'])
        expect(screen.queryByText(/Список версий не пришёл/)).toBeNull()
        expect(screen.queryByText(/1\.5\.9/)).toBeNull()
    })

    it('стоит старое ядро — свежая подходящая выбрана и зовёт обновиться', () => {
        render(<EngineCard engine={{ ...ENGINE, version: '1.5.9' }} releases={{ arch: 'x86_64', versions: ['2.0.0', '1.5.9'] }} onInstalled={noop} />)
        expect(options()).toEqual(['2.0.0 — свежая'])
        expect(screen.getByRole('button', { name: /Обновить до 2\.0\.0/ })).toBeInTheDocument()
    })
})

import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BoardAddress, BoardLabels } from '@/components/BoardDetails'

let resize: () => void
let width = 220
beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
        constructor(cb: () => void) { resize = cb }
        observe() {}
        disconnect() {}
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute('data-count-measure') ? 60 : 80
    })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); width = 220 })

it('сохраняет полный список при нехватке места, пересчитывает счётчик при сужении и закрывается Escape', async () => {
    const labels = ['Cloudflare', 'CCP (EVE Online)', 'Очень длинный список сервисов', 'Telegram']
    render(<BoardLabels labels={labels} />)
    const more = await screen.findByRole('button', { name: 'ещё 3' })
    fireEvent.click(more)
    const panel = screen.getByRole('region', { name: 'Выбранные списки' })
    expect(within(panel).getAllByRole('listitem').map((li) => li.textContent)).toEqual(labels)
    fireEvent.keyDown(more, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
    expect(more).toHaveFocus()
    width = 390
    resize()
    await waitFor(() => expect(screen.queryByRole('button', { name: /ещё/ })).toBeNull())
    width = 120
    resize()
    expect(await screen.findByRole('button', { name: 'ещё 4' })).toBeInTheDocument()
})

it('закрывает раскрытый список при нажатии снаружи', async () => {
    render(<BoardLabels labels={['A', 'B', 'C', 'D']} />)
    fireEvent.click(await screen.findByRole('button', { name: 'ещё 3' }))
    await waitFor(() => expect(screen.getByRole('region')).toBeInTheDocument())
    // Preact запускает effect после отрисовки.
    await new Promise((r) => setTimeout(r, 60))
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
})

it('раскрывает и копирует IPv6 целиком, смена адреса снова скрывает его', async () => {
    const ip = '2001:db8:1234:5678:abcd:ef01:2345:6789'
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { rerender } = render(<BoardAddress ip={ip} />)
    expect(screen.queryByText(ip)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'показать внешний адрес' }))
    expect(screen.getByText(ip)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать IP' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ip))
    rerender(<BoardAddress ip="203.0.113.42" />)
    await waitFor(() => expect(screen.queryByText('203.0.113.42')).toBeNull())
})

it('не сообщает об успешном копировании, если буфер обмена отказал', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    render(<BoardAddress ip="203.0.113.42" />)
    fireEvent.click(screen.getByRole('button', { name: 'показать внешний адрес' }))
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать IP' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Не удалось скопировать')
    expect(screen.queryByRole('button', { name: 'IP скопирован' })).toBeNull()
})

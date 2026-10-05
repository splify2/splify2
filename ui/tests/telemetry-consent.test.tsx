import { render, screen, waitFor, fireEvent } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TelemetryCard from '@/components/TelemetryCard'
import { rpc } from '@/lib/rpc'

// Учёт роутера в счётчике на splify2.github.io (docs/TELEMETRY.md).
//
// Включено по умолчанию: ключа настройки нет («unset») — переключатель включён, и
// единственное явное действие — выключить. Не ответивший бэкенд — тоже не повод рисовать
// «выключено»: на роутере в этот момент отклик уходит.

const HOUR_AGO = Math.floor(Date.now() / 1000) - 3600

function state(over: Partial<{ consent: string; on: boolean; last_at: number; last_error: string }> = {}) {
    return { consent: 'unset', on: true, last_at: 0, last_error: '', ...over }
}

describe('счётчик на сайте (docs/TELEMETRY.md)', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        document.body.innerHTML = ''
    })

    it('по умолчанию переключатель включён', async () => {
        vi.spyOn(rpc, 'telemetryState').mockResolvedValue(state())
        render(<TelemetryCard />)
        await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
        expect(screen.getByText(/Отклика ещё не было/)).toBeInTheDocument()
    })

    it('выключено — переключатель выключен и сказано «Выключено»', async () => {
        vi.spyOn(rpc, 'telemetryState').mockResolvedValue(state({ consent: 'off', on: false }))
        render(<TelemetryCard />)
        await waitFor(() => expect(screen.getByText('Выключено')).toBeInTheDocument())
        expect(screen.getByRole('switch')).not.toBeChecked()
    })

    it('нажатие на включённый ВЫКЛЮЧАЕТ и перечитывает состояние', async () => {
        const st = vi.spyOn(rpc, 'telemetryState')
            .mockResolvedValueOnce(state())
            .mockResolvedValue(state({ consent: 'off', on: false }))
        const set = vi.spyOn(rpc, 'telemetrySet').mockResolvedValue({ ok: true, consent: 'off' })
        render(<TelemetryCard />)
        await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
        fireEvent.click(screen.getByRole('switch'))
        await waitFor(() => expect(set).toHaveBeenCalledWith(false))
        await waitFor(() => expect(st).toHaveBeenCalledTimes(2))
        await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked())
    })

    it('нажатие на выключенный включает обратно', async () => {
        vi.spyOn(rpc, 'telemetryState')
            .mockResolvedValueOnce(state({ consent: 'off', on: false }))
            .mockResolvedValue(state({ consent: 'on' }))
        const set = vi.spyOn(rpc, 'telemetrySet').mockResolvedValue({ ok: true, consent: 'on' })
        render(<TelemetryCard />)
        await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked())
        fireEvent.click(screen.getByRole('switch'))
        await waitFor(() => expect(set).toHaveBeenCalledWith(true))
        await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
    })

    it('бэкенд не ответил — переключатель не рисуется выключенным', async () => {
        vi.spyOn(rpc, 'telemetryState').mockRejectedValue(new Error('нет ответа'))
        render(<TelemetryCard />)
        await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
        expect(screen.queryByText('Выключено')).toBeNull()
    })

    it('показано время последнего отклика', async () => {
        vi.spyOn(rpc, 'telemetryState').mockResolvedValue(state({ consent: 'on', last_at: HOUR_AGO }))
        render(<TelemetryCard />)
        await waitFor(() => expect(screen.getByText(/Последний отклик/)).toBeInTheDocument())
        expect(screen.getByText(/ч назад/)).toBeInTheDocument()
    })

    it.each([
        ['rejected', /Сайт не принял отклик/],
        ['toomany', /Сайт попросил реже/],
        ['unavailable', /Сайт недоступен/],
        ['network', /Нет связи с сайтом/],
        ['noid', /Ядро steer не ответило/],
        ['nosender', /поставьте curl/],
        ['что-то-новое', /Отклик не ушёл/],
    ])('сбой %s назван словами', async (code, text) => {
        vi.spyOn(rpc, 'telemetryState').mockResolvedValue(state({ last_at: HOUR_AGO, last_error: code }))
        render(<TelemetryCard />)
        await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument())
        // Слово причины — для кода, человеку оно не показывается.
        expect(document.body.textContent).not.toContain(code)
    })

    it('сказано, что уходит: номер роутера и внешний адрес, а остаётся только город', async () => {
        vi.spyOn(rpc, 'telemetryState').mockResolvedValue(state())
        render(<TelemetryCard />)
        await waitFor(() => expect(screen.getByText(/свой номер и внешний адрес; сайт запоминает только город/))
            .toBeInTheDocument())
        expect(screen.queryByRole('button', { name: /Показать пакет/ })).toBeNull()
    })
})

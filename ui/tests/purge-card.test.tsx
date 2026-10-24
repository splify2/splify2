import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { describe, expect, it, vi } from 'vitest'
import PurgeCard from '@/components/PurgeCard'
import { rpc } from '@/lib/rpc'

// Удаление необратимо, поэтому два шага: сначала план (ничего не меняет), потом отдельное
// подтверждение. Запуск без второго шага — тот самый отказ, который тест стережёт.

const PLAN = {
    ok: true, plan: true,
    items: ['таблица nftables inet steer удаляется'],
    notes: ['интерфейсы с протоколом xsteer остаются'],
    packages: ['steer', 'luci-app-splify2'],
}

describe('кнопка «Удалить splify2»', () => {
    it('показывает план, потом подтверждение, и только потом запускает', async () => {
        const purge = vi.spyOn(rpc, 'splify2Purge').mockImplementation(async (plan) =>
            plan ? PLAN : { ok: true, started: true, log: '/tmp/splify2-purge.log' })
        render(<PurgeCard />)

        fireEvent.click(screen.getByRole('button', { name: /Удалить splify2/ }))
        expect(await screen.findByText(/таблица nftables inet steer удаляется/)).toBeInTheDocument()
        expect(screen.getByText(/luci-app-splify2/)).toBeInTheDocument()
        expect(purge).toHaveBeenCalledTimes(1)
        expect(purge).toHaveBeenLastCalledWith(true, false)

        fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
        expect(screen.getByRole('alertdialog')).toBeInTheDocument()
        expect(purge).toHaveBeenCalledTimes(1) // подтверждения не было — ничего не запущено

        fireEvent.click(screen.getByRole('button', { name: 'Удалить сейчас' }))
        await waitFor(() => expect(screen.getByText(/Страница перестанет отвечать/)).toBeInTheDocument())
        expect(purge).toHaveBeenLastCalledWith(false, false)
        // «Удаляется…» без вращающегося индикатора и без кнопок
        expect(screen.queryByRole('button')).toBeNull()
        expect(document.querySelector('.animate-spin')).toBeNull()
    })

    it('«оставить настройки» перезапрашивает план и уходит в запуск', async () => {
        const purge = vi.spyOn(rpc, 'splify2Purge').mockImplementation(async (plan) =>
            plan ? PLAN : { ok: true, started: true })
        purge.mockClear()
        render(<PurgeCard />)
        fireEvent.click(screen.getByRole('button', { name: /Удалить splify2/ }))
        fireEvent.click(await screen.findByRole('checkbox'))
        await waitFor(() => expect(purge).toHaveBeenLastCalledWith(true, true))
        fireEvent.click(await screen.findByRole('button', { name: 'Далее' }))
        expect(screen.getByText(/Настройки останутся на роутере/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Удалить сейчас' }))
        await waitFor(() => expect(purge).toHaveBeenLastCalledWith(false, true))
    })

    it('отмена на плане ничего не запускает', async () => {
        const purge = vi.spyOn(rpc, 'splify2Purge').mockResolvedValue(PLAN)
        purge.mockClear()
        render(<PurgeCard />)
        fireEvent.click(screen.getByRole('button', { name: /Удалить splify2/ }))
        fireEvent.click(await screen.findByRole('button', { name: 'Отмена' }))
        expect(screen.getByRole('button', { name: /Удалить splify2/ })).toBeInTheDocument()
        expect(purge).toHaveBeenCalledTimes(1)
    })
})

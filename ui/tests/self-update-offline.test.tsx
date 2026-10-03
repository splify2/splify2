import { render, renderHook, screen, waitFor } from '@testing-library/preact'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SelfUpdateCard from '@/components/SelfUpdateCard'
import Rail from '@/components/Rail'
import { useLive } from '@/lib/live'
import { rpc } from '@/lib/rpc'
import { live } from './fixtures'

// Снято с QEMU-стенда (luci-app-splify2 26.10.0 из локальной сборки, DNS на роутере не отвечает):
// «Интерфейс» → «Интерфейс» писал «Сейчас: luci-app-splify2 ?» и «загрузка…» в выборе версий, а рельс
// под splify2 — одно «Bode» вместо «26.10.0 Bode». Установленную версию приносил только
// splify2_versions, а он перед ответом идёт в сеть за перечнем выпусков — 26 секунд на вызов там,
// где сети нет. Утром на том же стенде сеть была, и подпись стояла.
//
// Теперь установленная версия приходит с engine (местное знание, спрашивается сразу), а перечень
// выпусков, в котором установленной версии нет (26.10 ещё не выпущена), показывает то, что есть,
// и кнопка называет, что сделает: «Установить 26.9.2», а не «Переустановить».

const noop = () => {}

describe('«Интерфейс» без перечня выпусков', () => {
    it('пока перечень едет — «Сейчас» уже с версией', () => {
        render(<SelfUpdateCard info={null} installed="26.10.0" onInstalled={noop} />)
        expect(screen.getByText(/Сейчас: luci-app-splify2 26\.10\.0/)).toBeInTheDocument()
        expect(screen.queryByText(/\?/)).toBeNull()
    })

    it('версии неизвестна вовсе — строки нет, а не «?»', () => {
        render(<SelfUpdateCard info={null} onInstalled={noop} />)
        expect(screen.queryByText(/Сейчас/)).toBeNull()
    })

    it('установленной версии в перечне нет — перечень показан, кнопка говорит, что поставит', () => {
        render(
            <SelfUpdateCard
                info={{ current: '26.10.0', versions: ['26.9.2', '26.9.1'], names: { '26.9.1': '26.9.1 Andromeda' } }}
                installed="26.10.0"
                onInstalled={noop}
            />,
        )
        expect(screen.getByRole('option', { name: /26\.9\.2/ })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: /26\.9\.1 Andromeda/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Переустановить' })).toBeNull()
        expect(screen.queryByRole('button', { name: /Обновить/ })).toBeNull()
        expect(screen.getByRole('button', { name: 'Установить 26.9.2' })).toBeInTheDocument()
    })

    it('выбрана та, что стоит, — «Переустановить»; новее — «Обновить до»', async () => {
        render(<SelfUpdateCard info={{ current: '0.7.6', versions: ['0.7.7', '0.7.6'] }} onInstalled={noop} />)
        expect(screen.getByRole('button', { name: 'Обновить до 0.7.7' })).toBeInTheDocument()
        await userEvent.selectOptions(screen.getByRole('combobox'), '0.7.6')
        await waitFor(() => expect(screen.getByRole('button', { name: 'Переустановить' })).toBeInTheDocument())
    })

    it('рельс: версия интерфейса — с engine, не дожидаясь перечня', () => {
        render(
            <Rail
                live={live({ build: { present: true, vless: true, version: '2.0.0', ui_version: '26.10.0' } })}
                section="overview"
                onSection={noop}
                counts={{}}
            />,
        )
        expect(screen.getAllByText(/^26\.10\.0 Bode/).length).toBeGreaterThan(0)
    })
})

describe('перечень выпусков не пришёл и запомненного нет', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
    })

    it('карточка не висит на «загрузка…»: перечень пуст, а не «ещё едет»', async () => {
        vi.spyOn(rpc, 'live').mockResolvedValue({ status: { schema: 1, outputs: {}, channels: [] } } as never)
        vi.spyOn(rpc, 'engine').mockResolvedValue({ present: true, vless: true, ui_version: '26.10.0' } as never)
        const steer = vi.spyOn(rpc, 'steerVersions').mockRejectedValue(new Error('timeout'))
        const own = vi.spyOn(rpc, 'splify2Versions').mockRejectedValue(new Error('timeout'))
        const { result } = renderHook(() => useLive())
        await waitFor(() => expect(steer).toHaveBeenCalled(), { timeout: 3000 })
        await waitFor(() => expect(own).toHaveBeenCalled())
        await waitFor(() => expect(result.current.selfUpdate).toEqual({ current: '', versions: [] }))
    })
})

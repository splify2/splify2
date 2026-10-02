import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EngineCard from '@/components/EngineCard'
import ModulesCard from '@/components/ModulesCard'
import ModuleOffer from '@/components/ModuleOffer'
import Rail from '@/components/Rail'
import { rpc } from '@/lib/rpc'
import { live } from './fixtures'

// Ядро steer 2.0 — пакет steer-core и модули протоколов. Вариантов «базовый/расширенный» больше
// нет: при первой установке (и при переходе с ядра 1.x) человек выбирает модули, обновление
// само берёт все стоящие, а ставят и снимают модули по одному в «О ПО». Модуль, нужный выходам
// спеки, снять нельзя. Ядро, которое ведёт steer-box-connector (podkop, forkop), — не наше:
// ни установки, ни «Запустить».

const noop = () => {}
const REL = { arch: 'x86_64', versions: ['2.0.0'] }
const pressed = (name: RegExp) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('карточка ядра: модули вместо вариантов', () => {
    beforeEach(() => vi.restoreAllMocks())

    it('первая установка: по умолчанию VLESS, Hysteria2 и прокси — и они уходят в установку', async () => {
        const inst = vi.spyOn(rpc, 'steerInstall').mockResolvedValue({ ok: true, installed: 'steer-core 2.0.0', restarted: true })
        render(<EngineCard engine={{ present: false, vless: false }} releases={REL} onInstalled={noop} />)
        expect(pressed(/^VLESS$/)).toBe('true')
        expect(pressed(/^Hysteria2$/)).toBe('true')
        expect(pressed(/Trojan/)).toBe('true')
        expect(pressed(/^XSTEER$/)).toBe('false')
        expect(screen.queryByText(/базов|расширен/i)).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: /Trojan/ }))
        fireEvent.click(screen.getByRole('button', { name: /Мост Telegram/ }))
        fireEvent.click(screen.getByRole('button', { name: /Установить/ }))
        await waitFor(() => expect(inst).toHaveBeenCalledWith('2.0.0', true, 'vless hysteria2 tgws'))
    })

    it('переход с 1.x с VLESS: вшитые в него модули отмечены', () => {
        render(<EngineCard engine={{ present: true, vless: true, version: '1.5.9' }} releases={REL} onInstalled={noop} />)
        for (const n of [/^VLESS$/, /^XSTEER$/, /WireGuard поверх TCP/, /Мост Telegram/]) expect(pressed(n)).toBe('true')
    })

    it('ядро 2.0 стоит: модулей к выбору нет, стоящие названы, обновление их не перечисляет', async () => {
        const inst = vi.spyOn(rpc, 'steerInstall').mockResolvedValue({ ok: true, installed: 'steer-core 2.0.1', modules: ['vless'], restarted: true })
        render(
            <EngineCard
                engine={{ present: true, vless: true, version: '2.0.0', modules: ['vless', 'proxy'] }}
                releases={{ arch: 'x86_64', versions: ['2.0.1', '2.0.0'] }}
                onInstalled={noop}
            />,
        )
        expect(screen.queryByRole('button', { name: /^Hysteria2$/ })).toBeNull()
        expect(screen.getByText(/VLESS, Trojan/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /Обновить до 2\.0\.1/ }))
        await waitFor(() => expect(inst).toHaveBeenCalledWith('2.0.1', false, ''))
    })

    it('ядро занято коннектором — состояние вместо установки', () => {
        render(<EngineCard engine={{ present: true, vless: true, version: '2.0.0', modules: ['vless'], busy: 'forkop' }} releases={REL} onInstalled={noop} />)
        expect(screen.getByText('Ядро занято: forkop')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Переустановить|Обновить|Установить/ })).toBeNull()
    })
})

describe('карточка модулей в «О ПО»', () => {
    beforeEach(() => vi.restoreAllMocks())
    const MODS = {
        core: '2.0.0',
        modules: [
            { name: 'vless', installed: true, version: '2.0.0', needed: true, outputs: 'nl' },
            { name: 'hysteria2', installed: false, needed: false },
            { name: 'proxy', installed: true, version: '2.0.0', needed: false },
        ],
    }

    it('нужный спеке модуль снять нельзя — вместо кнопки выходы', async () => {
        vi.spyOn(rpc, 'steerModules').mockResolvedValue(MODS)
        render(<ModulesCard onChanged={noop} />)
        await waitFor(() => expect(screen.getByText('нужен: nl')).toBeInTheDocument())
        expect(screen.getAllByRole('button', { name: 'Снять' })).toHaveLength(1)
        expect(screen.getAllByRole('button', { name: 'Поставить' })).toHaveLength(1)
    })

    it('«Поставить» и «Снять» зовут свои методы и перечитывают перечень', async () => {
        const list = vi.spyOn(rpc, 'steerModules').mockResolvedValue(MODS)
        const add = vi.spyOn(rpc, 'steerModuleAdd').mockResolvedValue({ ok: true, installed: 'steer-hysteria2 2.0.0' })
        const del = vi.spyOn(rpc, 'steerModuleDel').mockResolvedValue({ ok: true })
        const changed = vi.fn()
        render(<ModulesCard onChanged={changed} />)
        await waitFor(() => screen.getByRole('button', { name: 'Поставить' }))
        fireEvent.click(screen.getByRole('button', { name: 'Поставить' }))
        await waitFor(() => expect(add).toHaveBeenCalledWith('hysteria2'))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Снять' })).not.toBeDisabled())
        fireEvent.click(screen.getByRole('button', { name: 'Снять' }))
        await waitFor(() => expect(del).toHaveBeenCalledWith('proxy'))
        await waitFor(() => expect(changed).toHaveBeenCalledTimes(2))
        expect(list.mock.calls.length).toBeGreaterThanOrEqual(3)
    })

    it('без ядра 2.0 — состояние, без кнопок', async () => {
        vi.spyOn(rpc, 'steerModules').mockResolvedValue({ core: '', modules: MODS.modules })
        render(<ModulesCard onChanged={noop} />)
        await waitFor(() => expect(screen.getByText(/Модули ставятся вместе с ядром 2\.0/)).toBeInTheDocument())
        expect(screen.queryByRole('button')).toBeNull()
    })

    it('ядро занято коннектором — состояние, без кнопок', async () => {
        vi.spyOn(rpc, 'steerModules').mockResolvedValue({ ...MODS, busy: 'podkop' })
        render(<ModulesCard onChanged={noop} />)
        await waitFor(() => expect(screen.getByText('Ядро занято: podkop')).toBeInTheDocument())
        expect(screen.queryByRole('button')).toBeNull()
    })
})

describe('выходу не хватает модуля — интерфейс предлагает его поставить', () => {
    beforeEach(() => vi.restoreAllMocks())
    it('строка на модуль и установка по кнопке', async () => {
        const add = vi.spyOn(rpc, 'steerModuleAdd').mockResolvedValue({ ok: true })
        const done = vi.fn()
        render(<ModuleOffer modules={['proxy']} onDone={done} />)
        expect(screen.getByText(/Нужен модуль: Trojan/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /Поставить/ }))
        await waitFor(() => expect(add).toHaveBeenCalledWith('proxy'))
        await waitFor(() => expect(done).toHaveBeenCalled())
    })
})

describe('рельс: коннектор и модули', () => {
    const rail = (l: Parameters<typeof Rail>[0]['live']) => <Rail live={l} section="overview" onSection={noop} counts={{}} />
    it('ядро занято — ни «Запустить», ни «Остановить всё», только состояние', () => {
        render(rail(live({ build: { present: true, vless: true, version: '2.0.0', modules: ['vless'], enabled: false, running: false, busy: 'forkop' } })))
        expect(screen.queryByRole('button', { name: /Запустить|Остановить всё/ })).toBeNull()
        expect(screen.getByText('Ядро занято: forkop')).toBeInTheDocument()
    })
    it('под версией — модули, а не «extended/basic»', () => {
        render(rail(live({ build: { present: true, vless: true, version: '2.0.0', modules: ['vless', 'proxy'], enabled: true, running: true } })))
        expect(screen.getByText('steer 2.0.0 · vless, proxy')).toBeInTheDocument()
        expect(screen.queryByText(/extended|basic/)).toBeNull()
    })
})

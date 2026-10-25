import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Plugins from '@/components/sections/Plugins'
import { rpc } from '@/lib/rpc'
import { resetLoader } from '@/plugins/loader'
import { configurePlugins, runJob } from '@/plugins/store'
import { HostLiveProvider } from '@/plugins/hostlive'
import type { Host, PluginModule } from '@/plugins/api'
import { live as liveFixture } from './fixtures'

// Вкладка «Плагины»: карточки по образцу карточки правила (имя раскрывает настройки, выключатель,
// версия и репозиторий, корзина с подтверждением, строка состояния), каталог и репозитории.

const REPOS = [
    { name: 'splify2', url: 'https://splify2.github.io/plugins', official: true },
    { name: 'mine', url: 'https://example.org/p', official: false },
]
const PLUGINS = [
    { id: 'recheck', version: '1.2.0', repo: 'splify2', state: 'enabled', why: null, auto_update: true, update: '1.3.0',
      name: 'ReCheck', compat: { 'host-api': '^1.0' }, ui: { entry: 'ui/index.js' }, i18n: { languages: [] } },
    { id: 'thirdy', version: '0.9.0', repo: 'mine', state: 'disabled', name: 'Сторонний', compat: { 'host-api': '^1.0' } },
    { id: 'newer', version: '2.0.0', repo: 'splify2', state: 'enabled', name: 'Новый',
      compat: { 'host-api': '^1.2' }, ui: { entry: 'ui/index.js' } },
]

const recheckModule: PluginModule = {
    activate(host: Host) {
        const { h } = host.preact
        host.slots.pluginSettings({
            summary: () => ({ text: 'Подбирает обход: 3 сайта', tone: 'ok' }),
            render: () => h('div', { 'data-testid': 'recheck-settings' }, 'настройки ReCheck'),
        })
    },
}

function mockBackend(over: { plugins?: unknown[]; repos?: unknown[] } = {}) {
    let plugins = [...(over.plugins ?? PLUGINS)]
    vi.spyOn(rpc, 'pluginsList').mockImplementation(async () => ({ ok: true, host_api: '1.0.0', plugins, repos: over.repos ?? REPOS }))
    vi.spyOn(rpc, 'reposList').mockResolvedValue({ repos: over.repos ?? REPOS })
    vi.spyOn(rpc, 'pluginsSearch').mockResolvedValue({ plugins: [
        { id: 'warpbox', name: 'WarpBox', description: 'WARP на роутере', version: '1.4.0', repo: 'splify2', kinds: ['warp'], permissions: ['net'] },
        { id: 'recheck', name: 'ReCheck', version: '1.2.0', repo: 'splify2', installed: true },
    ] })
    return {
        set: (p: unknown[]) => { plugins = p },
    }
}

function show() {
    return render(
        <HostLiveProvider live={liveFixture()}>
            <Plugins live={liveFixture()} />
        </HostLiveProvider>,
    )
}

beforeEach(async () => {
    vi.restoreAllMocks()
    await resetLoader()
    configurePlugins({
        hostVersion: '26.11.0', safe: false,
        fetchJson: async () => null,
        importModule: async (url: string) => {
            if (url.includes('/recheck/')) return recheckModule
            throw new Error('404')
        },
    })
})

describe('вкладка «Плагины»', () => {
    it('карточки: имя, версия, репозиторий, пометка стороннего, доступное обновление', async () => {
        mockBackend()
        show()
        expect(await screen.findByText('ReCheck', { selector: 'button' })).toBeInTheDocument()
        const third = screen.getByText('Сторонний', { selector: 'button' }).closest('article')!
        expect(within(third).getByText('0.9.0')).toBeInTheDocument()
        expect(within(third).getByText('mine')).toBeInTheDocument()
        expect(within(third).getByText('не официальный, splify2 за него не отвечает')).toBeInTheDocument()
        expect(within(third).getByText('Выключен')).toBeInTheDocument()
        const re = screen.getByText('ReCheck', { selector: 'button' }).closest('article')!
        expect(within(re).getByText('Доступна версия 1.3.0')).toBeInTheDocument()
    })

    it('строка состояния — summary плагина; несовместимый плагин не грузится, причина в его карточке', async () => {
        mockBackend()
        show()
        expect(await screen.findByText('Подбирает обход: 3 сайта')).toBeInTheDocument()
        const newer = screen.getByText('Новый', { selector: 'button' }).closest('article')!
        await waitFor(() => expect(within(newer).getByTestId('plugin-state').textContent).toMatch(/требует host-api \^1\.2, у панели 1\.0\.0/))
    })

    it('выключатель выключает плагин и перечитывает список', async () => {
        mockBackend()
        const off = vi.spyOn(rpc, 'pluginDisable').mockResolvedValue({ ok: true })
        const on = vi.spyOn(rpc, 'pluginEnable').mockResolvedValue({ ok: true })
        show()
        fireEvent.click(await screen.findByRole('switch', { name: 'Выключить плагин «ReCheck»' }))
        await waitFor(() => expect(off).toHaveBeenCalledWith('recheck'))
        fireEvent.click(screen.getByRole('switch', { name: 'Включить плагин «Сторонний»' }))
        await waitFor(() => expect(on).toHaveBeenCalledWith('thirdy'))
    })

    it('корзина спрашивает подтверждение; отмена ничего не удаляет', async () => {
        mockBackend()
        const del = vi.spyOn(rpc, 'pluginRemove').mockResolvedValue({ ok: true })
        show()
        fireEvent.click(await screen.findByRole('button', { name: 'Удалить плагин «Сторонний»' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Отмена' }))
        expect(del).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Удалить плагин «Сторонний»' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
        await waitFor(() => expect(del).toHaveBeenCalledWith('thirdy'))
    })

    it('имя раскрывает карточку: настройки плагина и общий блок; стрелка возвращает к списку', async () => {
        mockBackend()
        show()
        await screen.findByText('Подбирает обход: 3 сайта')
        fireEvent.click(screen.getByText('ReCheck', { selector: 'button' }))
        expect(await screen.findByTestId('recheck-settings')).toBeInTheDocument()
        expect(screen.getByText('Обновлять автоматически')).toBeInTheDocument()
        expect(screen.queryByText('Сторонний')).toBeNull() // список скрыт, как у открытого правила
        fireEvent.click(screen.getByRole('button', { name: /Назад/ }))
        expect(await screen.findByText('Сторонний', { selector: 'button' })).toBeInTheDocument()
    })

    it('автообновление переключается методом plugin_autoupdate', async () => {
        mockBackend()
        const au = vi.spyOn(rpc, 'pluginAutoupdate').mockResolvedValue({ ok: true })
        show()
        await screen.findByText('Подбирает обход: 3 сайта')
        fireEvent.click(screen.getByText('ReCheck', { selector: 'button' }))
        fireEvent.click(await screen.findByRole('switch', { name: 'Обновлять автоматически' }))
        await waitFor(() => expect(au).toHaveBeenCalledWith('recheck', false))
    })

    it('отказ бэкенда показан сообщением, карточка не ломается', async () => {
        mockBackend()
        vi.spyOn(rpc, 'pluginDisable').mockResolvedValue({ ok: false, error: 'плагин нужен выходам: nl' })
        show()
        fireEvent.click(await screen.findByRole('switch', { name: 'Выключить плагин «ReCheck»' }))
        expect(await screen.findByText('плагин нужен выходам: nl')).toBeInTheDocument()
    })
})

describe('каталог и репозитории', () => {
    it('поиск показывает найденное; «Установить» ставит; поставленное помечено', async () => {
        mockBackend()
        const inst = vi.spyOn(rpc, 'pluginInstall').mockResolvedValue({ ok: true })
        show()
        expect(await screen.findByText('WarpBox')).toBeInTheDocument()
        expect(screen.getByText('Добавит: warp, net')).toBeInTheDocument()
        expect(screen.getByText('Установлен')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Установить' }))
        await waitFor(() => expect(inst).toHaveBeenCalledWith('warpbox', '1.4.0'))
    })

    it('отказ установки приходит числами бэкенда', async () => {
        mockBackend()
        vi.spyOn(rpc, 'pluginInstall').mockResolvedValue({ ok: false, error: 'не хватает места: нужно 3 МБ, свободно 1 МБ' })
        show()
        fireEvent.click(await screen.findByRole('button', { name: 'Установить' }))
        expect(await screen.findByText('не хватает места: нужно 3 МБ, свободно 1 МБ')).toBeInTheDocument()
    })

    it('репозитории: сторонний помечен и убирается с подтверждением; официальный не убирается', async () => {
        mockBackend()
        const del = vi.spyOn(rpc, 'repoDel').mockResolvedValue({ ok: true })
        show()
        await screen.findByText('https://example.org/p')
        expect(screen.getAllByText('не официальный, splify2 за него не отвечает').length).toBeGreaterThan(0)
        expect(screen.queryByRole('button', { name: 'Убрать репозиторий «splify2»' })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Убрать репозиторий «mine»' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Убрать' }))
        await waitFor(() => expect(del).toHaveBeenCalledWith('mine'))
    })

    it('добавление репозитория: номер ключа виден до добавления, без него кнопка не работает', async () => {
        mockBackend()
        vi.spyOn(rpc, 'repoKey').mockResolvedValue({ ok: true, key_id: 'ab12cd34ef56ab78' })
        const add = vi.spyOn(rpc, 'repoAdd').mockResolvedValue({ ok: true })
        show()
        const btn = await screen.findByRole('button', { name: 'Добавить репозиторий' })
        expect(btn).toBeDisabled()
        fireEvent.input(screen.getByLabelText('Адрес репозитория'), { target: { value: 'https://repo.example/p' } })
        fireEvent.input(screen.getByLabelText('Ключ репозитория'), { target: { value: 'untrusted comment: key\nRWQ…' } })
        expect(await screen.findByText('Ключ ab12cd34ef56ab78')).toBeInTheDocument()
        await waitFor(() => expect(btn).not.toBeDisabled())
        fireEvent.click(btn)
        await waitFor(() => expect(add).toHaveBeenCalledWith('https://repo.example/p', 'untrusted comment: key\nRWQ…', 'ab12cd34ef56ab78'))
    })

    it('ход задания: опрос plugin_job до «готово», отказ задания — исключением', async () => {
        mockBackend()
        vi.spyOn(rpc, 'pluginInstall').mockResolvedValue({ ok: true, job: '7' })
        const job = vi.spyOn(rpc, 'pluginJob')
            .mockResolvedValueOnce({ ok: true, state: 'running', progress: 'скачивание' })
            .mockResolvedValueOnce({ ok: true, state: 'done' })
        const steps: string[] = []
        await runJob(() => rpc.pluginInstall('x'), (t) => steps.push(t), 0)
        expect(steps).toEqual(['скачивание'])
        expect(job).toHaveBeenCalledTimes(2)
        job.mockReset().mockResolvedValueOnce({ ok: false, state: 'failed', error: 'нет места' })
        await expect(runJob(() => rpc.pluginInstall('x'), undefined, 0)).rejects.toThrow('нет места')
    })
})

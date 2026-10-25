import { act, fireEvent, render, screen } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginGuard } from '@/plugins/boundary'
import { resetLoader, syncPlugins, type LoaderEnv } from '@/plugins/loader'
import { registry } from '@/plugins/registry'
import { pluginsState } from '@/plugins/runtime'
import { currentTheme, setTheme } from '@/plugins/themes'
import { HostLiveProvider } from '@/plugins/hostlive'
import PluginOpen from '@/components/PluginOpen'
import { stateLine } from '@/components/PluginCard'
import { HOST_API_VERSION, type Host, type PluginEntry, type PluginModule, type PluginSettingsSlot } from '@/plugins/api'
import { live as liveFixture } from './fixtures'

// Загрузчик плагинов UI: сверка версии host API до import(), причина несовместимости в карточке,
// ошибка плагина не роняет панель, слот pluginSettings отдаёт содержимое и строку состояния.

function entry(over: Partial<PluginEntry> = {}): PluginEntry {
    return {
        id: 'demo', name: 'Демо', version: '1.4.0', repo: 'splify2', trust: 'official', state: 'enabled',
        compat: { 'host-api': '^1.0' },
        ui: { entry: 'ui/index.js', css: [] },
        ...over,
    }
}

type Mods = Record<string, unknown>

function env(mods: Mods, over: Partial<LoaderEnv> = {}): LoaderEnv & { imported: string[] } {
    const imported: string[] = []
    return {
        platform: 'luci', hostVersion: '26.11.0', safe: false,
        fetchJson: async (url) => (url.endsWith('/i18n/ru.json') ? { hello: 'Привет, {name}', 'summary.on': 'Работает' } : null),
        importModule: async (url) => {
            imported.push(url)
            const m = mods[url.split('?')[0]]
            if (m instanceof Error) throw m
            if (!m) throw new Error('404')
            return m
        },
        imported,
        ...over,
    }
}

const URL_DEMO = '/luci-static/resources/splify2/plugins/demo/ui/index.js'

/** Демо-плагин со слотом pluginSettings: render на preact и компонентах панели из host. */
const demo: PluginModule = {
    activate(host: Host) {
        const { h } = host.preact
        const { Badge } = host.ui
        host.slots.pluginSettings({
            summary: () => ({ text: host.i18n.t('summary.on'), tone: 'ok' }),
            render: (ctx) => h('div', { 'data-testid': 'demo-settings' },
                h('span', null, host.i18n.t('hello', { name: host.plugin.id })),
                h(Badge, null, host.plugin.version),
                h('button', { onClick: ctx.close }, 'закрыть-демо')),
        })
    },
}

beforeEach(async () => {
    await resetLoader()
    for (const o of ['demo', 'bad', 'ok', 'late']) registry.clearOwner(o)
    vi.restoreAllMocks()
})

describe('загрузка плагина', () => {
    it('несовместимая версия host API: не грузится, причина — в состоянии плагина', async () => {
        const e = env({ [URL_DEMO]: demo })
        await syncPlugins([entry({ compat: { 'host-api': '^1.2' } })], e)
        expect(e.imported).toEqual([])
        const rt = pluginsState.get().runtime.demo
        expect(rt.status).toBe('incompatible')
        expect((rt as { reason: string }).reason).toContain('^1.2')
        expect((rt as { reason: string }).reason).toContain(HOST_API_VERSION)
        expect(registry.get('pluginSettings', 'demo')).toBeUndefined()
    })

    it('плагин с другим major и плагин без заявленной версии — тоже не грузятся', async () => {
        const e = env({ [URL_DEMO]: demo })
        await syncPlugins([entry({ compat: { 'host-api': '^2.0' } }), entry({ id: 'bad', compat: undefined })], e)
        expect(e.imported).toEqual([])
        expect(pluginsState.get().runtime.demo.status).toBe('incompatible')
        expect(pluginsState.get().runtime.bad.status).toBe('incompatible')
    })

    it('карточка показывает причину несовместимости строкой состояния', async () => {
        const e = env({})
        const ent = entry({ compat: { 'host-api': '^1.2' } })
        await syncPlugins([ent], e)
        const line = stateLine(ent, pluginsState.get().runtime.demo, liveFixture(), undefined)
        expect(line.tone).toBe('bad')
        expect(line.text).toMatch(/требует host-api \^1\.2/)
    })

    it('совместимый плагин: import с ?v=версия, прокладка preact, activate, слот', async () => {
        const e = env({ [URL_DEMO]: demo })
        await syncPlugins([entry()], e)
        expect(e.imported).toEqual([`${URL_DEMO}?v=1.4.0`])
        expect((globalThis as { __splify2_host?: { preact: unknown } }).__splify2_host?.preact).toBeTruthy()
        expect(pluginsState.get().runtime.demo.status).toBe('active')
        expect(registry.get('pluginSettings', 'demo')).toBeTruthy()
    })

    it('css плагина подключается ссылкой в корень панели с версией плагина и снимается при отключении', async () => {
        const e = env({ [URL_DEMO]: demo })
        const ent = entry({ ui: { entry: 'ui/index.js', css: ['ui/style.css'] } })
        await syncPlugins([ent], e)
        const link = () => document.head.querySelector('link[data-plugin="demo"]') as HTMLLinkElement | null
        expect(link()?.getAttribute('href')).toContain('/luci-static/resources/splify2/plugins/demo/ui/style.css?v=1.4.0')
        await syncPlugins([{ ...ent, state: 'disabled' }], e)
        expect(link()).toBeNull()
    })

    it('экспорт: именованный activate (без default) тоже годится', async () => {
        const e = env({ [URL_DEMO]: { activate: demo.activate } })
        await syncPlugins([entry()], e)
        expect(pluginsState.get().runtime.demo.status).toBe('active')
    })

    it('выключенный плагин не грузится; безопасный режим не грузит никого', async () => {
        const e1 = env({ [URL_DEMO]: demo })
        await syncPlugins([entry({ state: 'disabled' })], e1)
        expect(e1.imported).toEqual([])
        expect(pluginsState.get().runtime.demo.status).toBe('off')
        const e2 = env({ [URL_DEMO]: demo }, { safe: true })
        await syncPlugins([entry()], e2)
        expect(e2.imported).toEqual([])
        expect(pluginsState.get().runtime.demo.status).toBe('safe')
    })

    it('плагин выключили — регистрации сняты', async () => {
        const e = env({ [URL_DEMO]: demo })
        await syncPlugins([entry()], e)
        expect(registry.get('pluginSettings', 'demo')).toBeTruthy()
        await syncPlugins([entry({ state: 'disabled' })], e)
        expect(registry.get('pluginSettings', 'demo')).toBeUndefined()
    })
})

describe('падение плагина не роняет панель', () => {
    it('ошибка в activate: плагин снят, его слоты убраны, соседний работает', async () => {
        const boom: PluginModule = {
            activate(host) {
                host.slots.boardTile({ id: 'half', when: () => true, render: () => null })
                throw new Error('сломался')
            },
        }
        const e = env({
            '/luci-static/resources/splify2/plugins/bad/ui/index.js': boom,
            [URL_DEMO]: demo,
        })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await syncPlugins([entry({ id: 'bad', name: 'Плохой' }), entry()], e)
        const bad = pluginsState.get().runtime.bad
        expect(bad.status).toBe('failed')
        expect((bad as { reason: string }).reason).toMatch(/Плохой.*сломался/)
        expect(registry.list('boardTile').filter((r) => r.owner === 'bad')).toEqual([])
        expect(pluginsState.get().runtime.demo.status).toBe('active')
    })

    it('модуль не загрузился (нет файла) — failed, а не исключение наружу', async () => {
        const e = env({})
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await expect(syncPlugins([entry()], e)).resolves.toBeUndefined()
        expect(pluginsState.get().runtime.demo.status).toBe('failed')
    })

    it('ошибка отрисовки слота: предохранитель говорит «не отрисовался», соседи целы', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const Bad = () => { throw new Error('render') }
        const onDisable = vi.fn()
        render(
            <div>
                <PluginGuard name="Демо" onDisable={onDisable}><Bad /></PluginGuard>
                <p>панель жива</p>
            </div>,
        )
        expect(screen.getByText('Плагин Демо не отрисовался')).toBeInTheDocument()
        expect(screen.getByText('панель жива')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Отключить' }))
        expect(onDisable).toHaveBeenCalled()
    })

    it('падающая summary не роняет строку состояния', async () => {
        const slot: PluginSettingsSlot = { summary: () => { throw new Error('x') }, render: () => null }
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const l = stateLine(entry(), { status: 'active' }, liveFixture(), slot)
        expect(l.tone).toBe('ok')
    })
})

describe('слот pluginSettings', () => {
    it('раскрытая карточка рисует render плагина на preact панели и общий блок хоста под ним', async () => {
        const e = env({ [URL_DEMO]: demo })
        await syncPlugins([entry()], e)
        const onClose = vi.fn()
        render(
            <HostLiveProvider live={liveFixture()}>
                <PluginOpen entry={entry()} live={liveFixture()} onClose={onClose} deferred={false} />
            </HostLiveProvider>,
        )
        // словарь плагина (ru.json) и подстановка {name}
        expect(await screen.findByText('Привет, demo')).toBeInTheDocument()
        expect(screen.getByTestId('demo-settings')).toBeInTheDocument()
        // общий блок хоста
        expect(screen.getByText('Обновлять автоматически')).toBeInTheDocument()
        fireEvent.click(screen.getByText('закрыть-демо'))
        expect(onClose).toHaveBeenCalled()
    })

    it('summary плагина — строка состояния свёрнутой карточки', async () => {
        const e = env({ [URL_DEMO]: demo })
        await syncPlugins([entry()], e)
        const slot = registry.get<PluginSettingsSlot>('pluginSettings', 'demo')!.value
        expect(stateLine(entry(), { status: 'active' }, liveFixture(), slot)).toEqual({ text: 'Работает', tone: 'ok' })
    })

    it('падающий render плагина показан предохранителем внутри карточки', async () => {
        const broken: PluginModule = {
            activate(host) { host.slots.pluginSettings({ render: () => { throw new Error('boom') } }) },
        }
        const e = env({ [URL_DEMO]: broken })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await syncPlugins([entry()], e)
        render(
            <HostLiveProvider live={liveFixture()}>
                <PluginOpen entry={entry({ name: 'Демо' })} live={liveFixture()} onClose={() => {}} deferred={false} />
            </HostLiveProvider>,
        )
        expect(await screen.findByText('Плагин Демо не отрисовался')).toBeInTheDocument()
        expect(screen.getByText('Версия')).toBeInTheDocument()
    })
})

describe('остальные слоты и host', () => {
    it('boardTile, outputKind, badge, diag, setupVia регистрируются на владельца и снимаются вместе', async () => {
        const full: PluginModule = {
            activate(host) {
                host.slots.boardTile({ id: 't', when: () => true, render: () => null, order: 5 })
                host.slots.outputKind({ kind: 'warp', label: 'WARP', icon: () => null, create: () => ({ kind: 'warp' }), editor: () => null })
                host.slots.badge({ id: 'b', group: 'feature', match: () => null })
                host.slots.diag({ id: 'd', label: 'x', run: async () => [] })
                host.slots.setupVia({ id: 'v', label: 'v', available: async () => true, render: () => null })
            },
        }
        const e = env({ [URL_DEMO]: full })
        await syncPlugins([entry()], e)
        for (const slot of ['boardTile', 'outputKind', 'badge', 'diag', 'setupVia'] as const)
            expect(registry.list(slot).some((r) => r.owner === 'demo'), slot).toBe(true)
        expect(registry.get('outputKind', 'demo', 'warp')).toBeTruthy()
        await syncPlugins([], e)
        for (const slot of ['boardTile', 'outputKind', 'badge', 'diag', 'setupVia'] as const)
            expect(registry.list(slot).some((r) => r.owner === 'demo'), slot).toBe(false)
    })

    it('railSection работает, только если манифест объявил rail и человек не снял показ', async () => {
        const withRail: PluginModule = {
            activate(host) { host.slots.railSection({ id: 'demo-sec', label: 'Демо', icon: () => null, render: () => null }) },
        }
        const reg = () => registry.list('section').some((r) => r.id === 'demo-sec')
        await syncPlugins([entry()], env({ [URL_DEMO]: withRail }))
        expect(reg()).toBe(false)
        await resetLoader()
        await syncPlugins([entry({ ui: { entry: 'ui/index.js', rail: true } })], env({ [URL_DEMO]: withRail }))
        expect(reg()).toBe(true)
        await resetLoader()
        registry.clearOwner('demo')
        await syncPlugins([entry({ ui: { entry: 'ui/index.js', rail: true }, rail_shown: false })], env({ [URL_DEMO]: withRail }))
        expect(reg()).toBe(false)
    })

    it('i18n: язык человека → ru → ключ; plural по правилам языка', async () => {
        let seen: Host | null = null
        const m: PluginModule = { activate(host) { seen = host } }
        await syncPlugins([entry()], env({ [URL_DEMO]: m }))
        const h = seen as unknown as Host
        expect(h.i18n.t('hello', { name: 'мир' })).toBe('Привет, мир')
        expect(h.i18n.t('нет-такого')).toBe('нет-такого')
        expect([1, 2, 5, 21, 11].map((n) => h.i18n.plural(n, ['узел', 'узла', 'узлов']))).toEqual(['узел', 'узла', 'узлов', 'узел', 'узлов'])
    })

    it('темы: register задаёт переменные, смена режима и темы применяется', async () => {
        let seen: Host | null = null
        await syncPlugins([entry()], env({ [URL_DEMO]: { activate(host: Host) { seen = host } } }))
        const h = seen as unknown as Host
        const off = h.themes.register({ id: 'neon', name: 'Неон', light: { '--sp-primary': '#f0f' }, dark: { '--sp-primary': '#0ff' } })
        setTheme({ id: 'demo:neon', mode: 'light' })
        expect(document.documentElement.style.getPropertyValue('--sp-primary')).toBe('#f0f')
        setTheme({ mode: 'dark' })
        expect(document.documentElement.style.getPropertyValue('--sp-primary')).toBe('#0ff')
        expect(h.themes.current()).toEqual({ id: 'demo:neon', mode: 'dark' })
        off()
        expect(document.documentElement.style.getPropertyValue('--sp-primary')).toBe('')
        setTheme({ id: 'default', mode: 'auto' })
        expect(currentTheme().mode).toBe('auto')
    })

    it('rpc плагина: объект splify2.p.<id>, отказ ok:false — RpcError failed, нет моста — unavailable', async () => {
        let seen: Host | null = null
        await syncPlugins([entry()], env({ [URL_DEMO]: { activate(host: Host) { seen = host } } }))
        const h = seen as unknown as Host
        await expect(h.rpc.call('status')).rejects.toMatchObject({ kind: 'unavailable' })
        const declare = vi.fn(({ object, method }: { object: string; method: string }) => async (...a: unknown[]) =>
            method === 'bad' ? { ok: false, error: 'нельзя' } : { object, method, a })
        window.luci_rpc = { declare } as never
        try {
            await expect(h.rpc.call('set', { x: 1 })).resolves.toEqual({ object: 'splify2.p.demo', method: 'set', a: [1] })
            await expect(h.rpc.call('bad')).rejects.toMatchObject({ kind: 'failed', message: 'нельзя' })
        } finally {
            delete window.luci_rpc
        }
    })

    it('nav.openPlugin просит раскрыть карточку и шлёт событие раздела', async () => {
        let seen: Host | null = null
        await syncPlugins([entry()], env({ [URL_DEMO]: { activate(host: Host) { seen = host } } }))
        const got: string[] = []
        const on = (e: Event) => got.push((e as CustomEvent<string>).detail)
        window.addEventListener('splify:section', on)
        act(() => (seen as unknown as Host).nav.openPlugin())
        window.removeEventListener('splify:section', on)
        expect(got).toEqual(['plugins'])
        expect(pluginsState.get().openRequest).toBe('demo')
    })
})

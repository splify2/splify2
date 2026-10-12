// splify2 для компьютера: та же панель, что в LuCI (ui/src), в своём окне.
//
// Панель зовёт роутер через window.luci_rpc.declare — мост, который под LuCI отдаёт загрузчик
// (luci/…/view/splify2/home.js). Здесь мост свой: вызов уходит в главный процесс, а тот — в API
// роутера по токену устройства (SPLIFY2_API.md в хабе). Сама панель об этом не знает.
import '@/index.css'
import './desktop.css'
import './motion.css'
import './settings/settings.css'
import './wizard/wizard.css'
import './warpbox/warpbox.css'
import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Console, { type ExtraSection } from '@/components/Console'
import TitleBar from './TitleBar'
import Connect from './Connect'
import Settings from './settings/Settings'
import Wizard from './wizard/Wizard'
import { warpSection } from './warpbox/WarpBox'
import { desk, lastBase, resetMemory, type ApiState } from './desk'
import { useSettings } from './hooks'

window.luci_rpc = {
    declare: ({ method, params }) => (...args: unknown[]) => {
        // Как у rpc.declare в LuCI: позиционные аргументы ложатся на имена из params.
        const p: Record<string, unknown> = {}
        ;(params ?? []).forEach((name, i) => {
            if (args[i] !== undefined) p[name] = args[i]
        })
        return desk.api.call(method, p)
    },
}

// Тема — как у системы. Под LuCI её брали с фона страницы темы; здесь фона темы нет.
const dark = window.matchMedia('(prefers-color-scheme: dark)')
const syncTheme = () => document.documentElement.classList.toggle('dark', dark.matches)
syncTheme()
dark.addEventListener('change', syncTheme)

document.documentElement.dataset.platform = desk.platform

/** Разделы, которых нет под LuCI, — только в приложении. */
const EXTRA: ExtraSection[] = [warpSection]

/** Панель держит состояние и в модулях, не только в дереве: после смены роутера её надёжнее
 *  перезапустить целиком, чем размонтировать. */
let appShown = false

function Root() {
    const [st, setSt] = useState<ApiState | null>(null)
    const [lost, setLost] = useState('')
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [prefs] = useSettings()
    const [railHost, setRailHost] = useState<HTMLElement | null>(null)
    const [panel, setPanel] = useState<{ host: HTMLElement | null; screen?: 'general' | 'catalog' | 'xsteer' | 'extra' | 'about' }>({ host: null })
    const onPanelHost = useCallback((host: HTMLElement | null, screen?: 'general' | 'catalog' | 'xsteer' | 'extra' | 'about') =>
        setPanel((p) => (p.host === host && p.screen === screen ? p : { host, screen })), [])

    useEffect(() => {
        desk.api.state().then(setSt, () => setSt({ connected: false, base: null, hostname: '', device: null }))
        const offLost = desk.api.onLost((msg) => {
            resetMemory(lastBase())
            setLost(msg)
            setSt((s) => (s ? { ...s, connected: false } : s))
        })
        // Щелчок по уведомлению: открыть раздел панели (Console слушает splify:section).
        const offNav = desk.win.onNav((section) => {
            setSettingsOpen(false)
            window.dispatchEvent(new CustomEvent('splify:section', { detail: section }))
        })
        const offSet = desk.win.onOpenSettings(() => setSettingsOpen(true))
        // Из настроек роутера ушли в правило — слой настроек закрывается (Console).
        const onClose = () => setSettingsOpen(false)
        window.addEventListener('splify:settings-close', onClose)
        return () => { offLost(); offNav(); offSet(); window.removeEventListener('splify:settings-close', onClose) }
    }, [])

    // Анимации выключены в настройках — правила motion.css смотрят на этот признак.
    useEffect(() => {
        if (prefs) document.documentElement.dataset.motion = prefs.motion ? 'on' : 'off'
    }, [prefs?.motion])

    const closeSettings = useCallback(() => setSettingsOpen(false), [])

    /* Смена раздела — раздел снова сверху. Под LuCI прокрутка общая со страницей темы; здесь у
     * раздела своя (.desk-body), и без сброса новый раздел открывался бы с середины. Раздел
     * сменился — значит его обёртка (.sp-section с ключом раздела) заменена прямо в main панели. */
    useEffect(() => {
        if (!st?.connected) return
        let mo: MutationObserver | null = null
        const t = setInterval(() => {
            const body = document.querySelector<HTMLElement>('.desk-body')
            const main = body?.querySelector<HTMLElement>('.sp-root main')
            if (!body || !main || mo) return
            mo = new MutationObserver((list) => {
                if (list.some((m) => [...m.addedNodes].some((n) => n instanceof HTMLElement && n.classList.contains('sp-section'))))
                    body.scrollTop = 0
            })
            mo.observe(main, { childList: true })
            clearInterval(t)
        }, 200)
        return () => { clearInterval(t); mo?.disconnect() }
    }, [st?.connected])

    function connected(s: ApiState) {
        if (s.base !== lastBase()) resetMemory(s.base)
        if (appShown) {
            location.reload()
            return
        }
        setLost('')
        setSt(s)
    }

    async function disconnect() {
        const base = st?.base ?? lastBase()
        await desk.api.disconnect().catch(() => {})
        resetMemory(base)
        location.reload()
    }

    if (st?.connected) appShown = true

    return (
        <div className="splify-react-root desk an-backdrop" data-rail={st?.connected ? '' : undefined}>
            <TitleBar
                state={st}
                onDisconnect={disconnect}
                onSettings={() => setSettingsOpen((v) => !v)}
                settingsOpen={settingsOpen}
            />
            <div className="desk-stage">
                {/* Приложение — рельс отдельной колонкой и раздел; настройки накрывают обоих. */}
                <div className="desk-app" data-behind={settingsOpen ? 'true' : undefined} inert={settingsOpen || undefined}>
                    {st?.connected && <div className="desk-side" ref={setRailHost} />}
                    <main className="desk-body">
                        {st && prefs && (st.connected
                            ? railHost && <Console extra={EXTRA} railHost={railHost} board settingsHost={panel.host} settingsScreen={panel.screen} />
                            : !prefs.wizardDone && !lost
                                ? <Wizard onConnected={connected} />
                                : <Connect initial={lastBase()} note={lost} onConnected={connected} />)}
                    </main>
                </div>
                <Settings open={settingsOpen} onClose={closeSettings} router={st} onDisconnect={disconnect} onPanelHost={onPanelHost} />
            </div>
        </div>
    )
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Root />
    </StrictMode>,
)

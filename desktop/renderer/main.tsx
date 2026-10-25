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
import { pending } from '@/lib/pending'
import TitleBar from './TitleBar'
import Connect from './Connect'
import Settings from './settings/Settings'
import Wizard from './wizard/Wizard'
import { warpSection } from './warpbox/WarpBox'
import { recheckSection } from './recheck/ReCheck'
import { desk, lastBase, resetMemory, type ApiState } from './desk'
import { useSettings } from './hooks'

/** Открыть панель на мастере настройки (конец установки) — переживает перезагрузку страницы. */
const SETUP_KEY = 'desk:setup'

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
const EXTRA: ExtraSection[] = [warpSection, recheckSection]

/** Панель держит состояние и в модулях, не только в дереве: после смены роутера её надёжнее
 *  перезапустить целиком, чем размонтировать. */
let appShown = false

function Root() {
    const [st, setSt] = useState<ApiState | null>(null)
    const [lost, setLost] = useState('')
    /** Подключается ещё один роутер (меню роутера в рамке). */
    const [adding, setAdding] = useState(false)
    const [setupNow, setSetupNow] = useState(() => { try { return sessionStorage.getItem(SETUP_KEY) === '1' } catch { return false } })
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [prefs] = useSettings()
    const [railHost, setRailHost] = useState<HTMLElement | null>(null)
    const [panel, setPanel] = useState<{ host: HTMLElement | null; screen?: 'general' | 'catalog' | 'xsteer' | 'extra' | 'about' }>({ host: null })
    const onPanelHost = useCallback((host: HTMLElement | null, screen?: 'general' | 'catalog' | 'xsteer' | 'extra' | 'about') =>
        setPanel((p) => (p.host === host && p.screen === screen ? p : { host, screen })), [])

    useEffect(() => {
        desk.api.state().then(setSt, () => setSt({ connected: false, base: null, hostname: '', device: null }))
        /* Трей: выключатель правила — тем же путём, что на главной (сохранение и применение). */
        const toggleRule = (i: number) => {
            const real = pending.saved
            const c = real?.channels[i]
            if (!real || !c) return
            const { enabled: _e, ...on } = c
            pending.edit({ ...real, channels: real.channels.map((x, k) => (k === i ? (c.enabled === false ? on : { ...c, enabled: false }) : x)) })
        }
        /* Окно могли создать ради этого щелчка (запуск вместе с системой — в трее без окна): спека
         * ещё не пришла — правило переключится, как только загрузится. */
        const offTrayRule = desk.win.onTrayRule((i) => {
            if (pending.saved) { toggleRule(i); return }
            const off = pending.subscribe(() => {
                if (!pending.saved) return
                off()
                clearTimeout(giveUp)
                toggleRule(i)
            })
            const giveUp = setTimeout(off, 30_000)
        })
        /* Трей: другой роутер — окно перезагружается на нём. */
        const offSwitched = desk.win.onRouterSwitched((base) => { resetMemory(base); location.reload() })
        /* Событие ядра — панели (lib/live.ts): состояние перечитывается сразу. */
        const offEvent = desk.api.onEvent((ev) => window.dispatchEvent(new CustomEvent('splify:router-event', { detail: ev })))
        const offLost = desk.api.onLost((msg) => {
            const gone = lastBase()
            resetMemory(gone)
            const showLost = () => {
                setLost(msg)
                setSt((s) => (s ? { ...s, connected: false } : s))
            }
            /* Забыл устройство один из нескольких роутеров: активным стал следующий, и окно
             * переходит на него, а не застывает на форме подключения при подключённом роутере. */
            desk.api.state().then((s) => {
                if (s.connected && s.base !== gone) { resetMemory(s.base); location.reload() } else showLost()
            }, showLost)
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
        return () => { offTrayRule(); offSwitched(); offEvent(); offLost(); offNav(); offSet(); window.removeEventListener('splify:settings-close', onClose) }
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

    function connected(s: ApiState, setup = false) {
        if (s.base !== lastBase()) resetMemory(s.base)
        /* «Настроить splify2» в конце установки: панель откроется на мастере настройки. Через
         * sessionStorage — переподключение ниже перезагружает страницу. */
        try { if (setup) sessionStorage.setItem(SETUP_KEY, '1') } catch { /* без памяти — мастер на главной сам */ }
        setSetupNow(setup)
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
                onAddRouter={() => { setSettingsOpen(false); setAdding(true) }}
                onUseRouter={(id, base) => void desk.api.use(id).then(() => { resetMemory(base); location.reload() })}
                onSettings={() => setSettingsOpen((v) => !v)}
                settingsOpen={settingsOpen}
            />
            <div className="desk-stage">
                {/* Приложение — рельс отдельной колонкой и раздел; настройки накрывают обоих. */}
                <div className="desk-app" data-behind={settingsOpen ? 'true' : undefined} inert={settingsOpen || undefined}>
                    {st?.connected && <div className="desk-side" ref={setRailHost} />}
                    <main className="desk-body">
                        {st && prefs && (adding
                            ? <Connect initial="" note="" title="Ещё один роутер" onConnected={connected} onCancel={() => setAdding(false)} />
                            : st.connected
                            ? railHost && <Console extra={EXTRA} railHost={railHost} board setup={setupNow} settingsHost={panel.host} settingsScreen={panel.screen} />
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

import { useEffect, useState } from 'react'
import { ChevronDown, Download, Minus, Settings as Gear, X } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm'
import { desk, type ApiState, type RouterEntry } from './desk'
import { useMonitor } from './hooks'

/** Своя рамка вместо системной: за неё окно таскают, в ней роутер и кнопки окна. */
export default function TitleBar({ state, onDisconnect, onAddRouter, onUseRouter, onSettings, settingsOpen }: {
    state: ApiState | null
    onDisconnect: () => void
    onAddRouter: () => void
    onUseRouter: (id: string, base: string | null) => void
    onSettings: () => void
    settingsOpen: boolean
}) {
    const [focused, setFocused] = useState(true)
    const [menu, setMenu] = useState(false)
    const [ask, dialog] = useConfirm()
    const [update, setUpdate] = useState(false)
    useEffect(() => {
        desk.update.state().then((st) => { if (st === 'ready') setUpdate(true) }, () => {})
        return desk.update.onReady(() => setUpdate(true))
    }, [])
    const mon = useMonitor()
    /* Роутеры приложения (electron/routers.cjs): в меню — остальные, на них переходят щелчком. */
    const [routers, setRouters] = useState<RouterEntry[]>([])
    useEffect(() => {
        desk.api.routers().then(setRouters, () => {})
        return desk.api.onRouters(setRouters)
    }, [])
    const others = routers.filter((r) => !r.active)
    const downs = Object.entries(mon?.outputs ?? {}).filter(([, v]) => v === 'down').map(([k]) => k)
    // Точка у имени роутера — сводка сторожа: связь, ядро, выходы.
    const health = !mon || mon.reachable === null ? 'wait'
        : mon.reachable === false || mon.engine === false ? 'bad'
        : downs.length ? 'warn' : 'ok'
    const healthText = health === 'bad'
        ? (mon?.reachable === false ? 'Нет связи с роутером' : 'Ядро steer не отвечает')
        : health === 'warn' ? `Не отвечает: ${downs.join(', ')}`
        : health === 'ok' ? 'Всё работает' : 'Проверяем роутер'

    /* Esc закрывает меню роутера — как слой настроек. */
    useEffect(() => {
        if (!menu) return
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [menu])

    useEffect(() => {
        desk.win.state().then((s) => setFocused(s.focused))
        return desk.win.onState((s) => setFocused(s.focused))
    }, [])

    const host = state?.base ? state.base.replace(/^https?:\/\//, '') : ''

    async function disconnect() {
        setMenu(false)
        const ok = await ask({
            title: 'Отключить этот компьютер от роутера?',
            body: 'Чтобы подключиться снова, понадобится пароль роутера.',
            confirmLabel: 'Отключить',
        })
        if (ok) onDisconnect()
    }

    return (
        <header className={'desk-bar' + (state?.connected && !settingsOpen ? ' desk-bar-rail' : '') + (focused ? '' : ' desk-bar-idle')}>
            {/* Над рельсом — его же стекло: рельс панели доходит до верхнего края окна. */}
            <div className="desk-cap">
                <img src="/favicon.svg" alt="" aria-hidden="true" className="desk-logo" draggable={false} />
                <span className="desk-name">splify2</span>
                {state?.connected && (
                    <button type="button" className="desk-chip" onClick={() => setMenu((v) => !v)} aria-expanded={menu} title={healthText}>
                        <span className="desk-dot" data-health={health} aria-hidden="true" />
                        <span className="desk-chip-text">{state.hostname || host}</span>
                        <ChevronDown aria-hidden="true" />
                    </button>
                )}
            </div>
            <div className="desk-fill" />
            <div className="desk-ctl">
                {update && (
                    <button type="button" className="desk-update" onClick={() => desk.update.install()} title="Перезапустить в новой версии">
                        <Download aria-hidden="true" /> Обновить
                    </button>
                )}
                <button type="button" aria-label="Настройки" aria-pressed={settingsOpen} className="desk-gear" onClick={onSettings}><Gear /></button>
                <span className="desk-ctl-sep" aria-hidden="true" />
                <button type="button" aria-label="Свернуть" onClick={() => desk.win.minimize()}><Minus /></button>
                <button type="button" aria-label="Закрыть" className="desk-close" onClick={() => desk.win.close()}><X /></button>
            </div>
            {menu && (
                <>
                    <div className="desk-scrim" onClick={() => setMenu(false)} />
                    <div className="desk-menu an-glass an-glass-float" role="menu">
                        <div className="desk-menu-head">
                            <div className="desk-menu-title">{state?.hostname || host}</div>
                            <div className="desk-menu-sub">{host}</div>
                            <div className="desk-menu-health" data-health={health}>{healthText}</div>
                        </div>
                        {others.length > 0 && (
                            <>
                                <div className="desk-menu-label">Другие роутеры</div>
                                {others.map((r) => (
                                    <button key={r.id} type="button" role="menuitem" className="desk-menu-item desk-menu-router"
                                        onClick={() => { setMenu(false); onUseRouter(r.id, r.base) }}>
                                        <span>{r.hostname || r.base?.replace(/^https?:\/\//, '')}</span>
                                        <span className="desk-menu-sub">{r.base?.replace(/^https?:\/\//, '')}</span>
                                    </button>
                                ))}
                                <div className="desk-menu-sep" />
                            </>
                        )}
                        <button type="button" role="menuitem" className="desk-menu-item" onClick={() => { setMenu(false); onAddRouter() }}>
                            Добавить роутер
                        </button>
                        <button type="button" role="menuitem" className="desk-menu-item" onClick={() => { setMenu(false); onSettings() }}>
                            Настройки
                        </button>
                        <button type="button" role="menuitem" className="desk-menu-item desk-danger" onClick={disconnect}>
                            Отключить этот компьютер
                        </button>
                    </div>
                </>
            )}
            {dialog}
        </header>
    )
}

import { useEffect, useState } from 'react'
import { ChevronDown, Copy, Minus, Square, X } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm'
import { desk, type ApiState } from './desk'

/** Своя рамка вместо системной: за неё окно таскают, в ней роутер и кнопки окна. */
export default function TitleBar({ state, onDisconnect }: { state: ApiState | null; onDisconnect: () => void }) {
    const [max, setMax] = useState(false)
    const [focused, setFocused] = useState(true)
    const [menu, setMenu] = useState(false)
    const [ask, dialog] = useConfirm()

    useEffect(() => {
        desk.win.state().then((s) => { setMax(s.maximized); setFocused(s.focused) })
        return desk.win.onState((s) => { setMax(s.maximized); setFocused(s.focused) })
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
        <header className={'desk-bar' + (state?.connected ? ' desk-bar-rail' : '') + (focused ? '' : ' desk-bar-idle')}>
            {/* Над рельсом — его же стекло: рельс панели доходит до верхнего края окна. */}
            <div className="desk-cap">
                <img src="/favicon.svg" alt="" aria-hidden="true" className="desk-logo" draggable={false} />
                <span className="desk-name">splify2</span>
                {state?.connected && (
                    <button type="button" className="desk-chip" onClick={() => setMenu((v) => !v)} aria-expanded={menu}>
                        <span className="desk-dot" aria-hidden="true" />
                        <span className="desk-chip-text">{state.hostname || host}</span>
                        <ChevronDown aria-hidden="true" />
                    </button>
                )}
            </div>
            <div className="desk-fill" />
            <div className="desk-ctl">
                <button type="button" aria-label="Свернуть" onClick={() => desk.win.minimize()}><Minus /></button>
                <button type="button" aria-label={max ? 'Восстановить' : 'Развернуть'} onClick={() => desk.win.toggleMaximize()}>
                    {max ? <Copy className="desk-restore" /> : <Square />}
                </button>
                <button type="button" aria-label="Закрыть" className="desk-close" onClick={() => desk.win.close()}><X /></button>
            </div>
            {menu && (
                <>
                    <div className="desk-scrim" onClick={() => setMenu(false)} />
                    <div className="desk-menu an-glass an-glass-float" role="menu">
                        <div className="desk-menu-head">
                            <div className="desk-menu-title">{state?.hostname || host}</div>
                            <div className="desk-menu-sub">{host}</div>
                        </div>
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

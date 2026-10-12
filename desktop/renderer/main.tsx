// splify2 для компьютера: та же панель, что в LuCI (ui/src), в своём окне.
//
// Панель зовёт роутер через window.luci_rpc.declare — мост, который под LuCI отдаёт загрузчик
// (luci/…/view/splify2/home.js). Здесь мост свой: вызов уходит в главный процесс, а тот — в API
// роутера по токену устройства (docs/api.md). Сама панель об этом не знает.
import '@/index.css'
import './desktop.css'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import TitleBar from './TitleBar'
import Connect from './Connect'
import { desk, lastBase, resetMemory, type ApiState } from './desk'

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

/** Панель держит состояние и в модулях, не только в дереве: после смены роутера её надёжнее
 *  перезапустить целиком, чем размонтировать. */
let appShown = false

function Root() {
    const [st, setSt] = useState<ApiState | null>(null)
    const [lost, setLost] = useState('')

    useEffect(() => {
        desk.api.state().then(setSt, () => setSt({ connected: false, base: null, hostname: '', device: null }))
        return desk.api.onLost((msg) => {
            resetMemory(lastBase())
            setLost(msg)
            setSt((s) => (s ? { ...s, connected: false } : s))
        })
    }, [])

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
        <div className="splify-react-root desk an-backdrop">
            <TitleBar state={st} onDisconnect={disconnect} />
            <main className="desk-body">
                {st && (st.connected
                    ? <App />
                    : <Connect initial={lastBase()} note={lost} onConnected={connected} />)}
            </main>
        </div>
    )
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Root />
    </StrictMode>,
)

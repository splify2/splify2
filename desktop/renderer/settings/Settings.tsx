import { useEffect, useState, type ReactNode } from 'react'
import { Bell, Info, Laptop, MonitorCog, Palette, Power, Router, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented, ToggleRow } from '@/components/ui/layout'
import { useConfirm } from '@/components/ui/confirm'
import { desk, type ApiState, type AppSettings, type RouterDevice, type RouterInfo } from '../desk'
import { ago, useSettings } from '../hooks'

type Page = 'look' | 'startup' | 'notify' | 'router' | 'devices' | 'about'

const NAV: ({ group: string } | { id: Page; label: string; icon: typeof Bell })[] = [
    { group: 'Приложение' },
    { id: 'look', label: 'Внешний вид', icon: Palette },
    { id: 'startup', label: 'Запуск и трей', icon: Power },
    { id: 'notify', label: 'Уведомления', icon: Bell },
    { group: 'Роутер' },
    { id: 'router', label: 'Подключение', icon: Router },
    { id: 'devices', label: 'Устройства', icon: Laptop },
    { group: '' },
    { id: 'about', label: 'О программе', icon: Info },
]

/** Настройки поверх окна — как у Discord: слой на всё окно под рамкой, разделы слева. Открытие
 *  и закрытие — переходом (data-state), чтобы закрытие посреди открытия шло от текущего кадра. */
export default function Settings({ open, onClose, router, onDisconnect }: {
    open: boolean
    onClose: () => void
    router: ApiState | null
    onDisconnect: () => void
}) {
    const [page, setPage] = useState<Page>('look')
    const [mounted, setMounted] = useState(open)
    const [s, set] = useSettings()

    useEffect(() => {
        if (open) setMounted(true)
    }, [open])

    useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open, onClose])

    if (!mounted || !s) return null

    return (
        <div
            className="desk-settings an-backdrop"
            data-state={open ? 'open' : 'closed'}
            role="dialog"
            aria-modal="true"
            aria-label="Настройки"
            onTransitionEnd={(e) => {
                if (e.target === e.currentTarget && !open) setMounted(false)
            }}
        >
            <aside className="desk-settings-nav">
                <nav className="desk-settings-nav-in" aria-label="Разделы настроек">
                    {NAV.map((it, i) =>
                        'group' in it ? (
                            it.group ? <div key={i} className="desk-settings-group">{it.group}</div> : <div key={i} className="desk-settings-sep" />
                        ) : (
                            <button
                                key={it.id}
                                type="button"
                                className="desk-settings-item"
                                aria-current={page === it.id ? 'page' : undefined}
                                onClick={() => setPage(it.id)}
                            >
                                <it.icon aria-hidden="true" />
                                {it.label}
                            </button>
                        ),
                    )}
                </nav>
            </aside>
            <main className="desk-settings-main">
                <div className="desk-settings-content" key={page}>
                    {page === 'look' && <Look s={s} set={set} />}
                    {page === 'startup' && <Startup s={s} set={set} />}
                    {page === 'notify' && <Notify s={s} set={set} />}
                    {page === 'router' && <RouterPage router={router} onDisconnect={onDisconnect} />}
                    {page === 'devices' && <Devices />}
                    {page === 'about' && <About />}
                </div>
                <div className="desk-settings-close">
                    <button type="button" onClick={onClose} aria-label="Закрыть настройки"><X aria-hidden="true" /></button>
                    <span aria-hidden="true">ESC</span>
                </div>
            </main>
        </div>
    )
}

type Set = (patch: Parameters<typeof desk.settings.set>[0]) => void

function Head({ title, sub }: { title: string; sub?: string }) {
    return (
        <header className="desk-page-head">
            <h2 className="sp-title">{title}</h2>
            {sub && <p className="sp-sub">{sub}</p>}
        </header>
    )
}

function Block({ title, children }: { title?: string; children: ReactNode }) {
    return (
        <section className="desk-block">
            {title && <div className="desk-block-title">{title}</div>}
            <div className="desk-block-body an-glass">{children}</div>
        </section>
    )
}

function Look({ s, set }: { s: AppSettings; set: Set }) {
    return (
        <>
            <Head title="Внешний вид" />
            <Block title="Тема">
                <Segmented
                    label="Тема"
                    value={s.theme}
                    onChange={(theme) => set({ theme })}
                    items={[
                        { value: 'system', label: 'Как в системе' },
                        { value: 'light', label: 'Светлая' },
                        { value: 'dark', label: 'Тёмная' },
                    ]}
                />
            </Block>
            <Block title="Масштаб">
                <Segmented
                    label="Масштаб"
                    value={String(s.zoom)}
                    onChange={(z) => set({ zoom: Number(z) })}
                    items={['80', '90', '100', '110', '125', '150'].map((z) => ({ value: z, label: `${z}%` }))}
                />
            </Block>
            <Block>
                <ToggleRow
                    label="Анимации"
                    caption="Плавные переходы между разделами и окнами"
                    on={s.motion}
                    onToggle={() => set({ motion: !s.motion })}
                />
            </Block>
        </>
    )
}

function Startup({ s, set }: { s: AppSettings; set: Set }) {
    return (
        <>
            <Head title="Запуск и трей" />
            <Block>
                <ToggleRow
                    label="Запускать вместе с системой"
                    caption="Иначе о сбоях на роутере splify2 не сообщит, пока его не откроют"
                    on={s.launchAtLogin}
                    onToggle={() => set({ launchAtLogin: !s.launchAtLogin })}
                />
                <ToggleRow
                    label="Сразу в трей"
                    caption="При запуске вместе с системой окно не открывается"
                    on={s.startHidden}
                    disabled={!s.launchAtLogin}
                    onToggle={() => set({ startHidden: !s.startHidden })}
                />
                <ToggleRow
                    label="Крестик сворачивает в трей"
                    caption="Выйти можно из меню значка в трее"
                    on={s.closeToTray}
                    onToggle={() => set({ closeToTray: !s.closeToTray })}
                />
            </Block>
        </>
    )
}

function Notify({ s, set }: { s: AppSettings; set: Set }) {
    const n = s.notify
    const [test, setTest] = useState('')
    const off = !n.enabled
    const row = (key: keyof AppSettings['notify'], label: string, caption?: string) => (
        <ToggleRow
            label={label}
            caption={caption}
            on={n[key]}
            disabled={off}
            onToggle={() => set({ notify: { [key]: !n[key] } })}
        />
    )
    return (
        <>
            <Head title="Уведомления" sub="Сообщения Windows, когда на роутере что-то сломалось" />
            <Block>
                <ToggleRow label="Уведомления" on={n.enabled} onToggle={() => set({ notify: { enabled: !n.enabled } })} />
                {row('sound', 'Со звуком')}
            </Block>
            <Block title="О чём сообщать">
                {row('router', 'Роутер пропал со связи')}
                {row('engine', 'Ядро steer не отвечает')}
                {row('outputs', 'Выход перестал отвечать')}
                {row('recover', 'Сбой прошёл')}
                {row('diag', 'Сбой в диагностике')}
            </Block>
            <Block title="Пока окно скрыто, проверять роутер">
                <Segmented
                    label="Как часто проверять"
                    value={String(s.pollHidden)}
                    onChange={(v) => set({ pollHidden: Number(v) })}
                    items={[
                        { value: '15', label: '15 с' },
                        { value: '30', label: '30 с' },
                        { value: '60', label: '1 мин' },
                        { value: '300', label: '5 мин' },
                    ]}
                />
            </Block>
            <div className="desk-row">
                <Button
                    variant="outline"
                    disabled={off}
                    onClick={() => desk.app.testNotification().then(() => setTest('Отправлено'), (e: Error) => setTest(e.message))}
                >
                    Проверить уведомление
                </Button>
                {test && <span className="desk-note">{test}</span>}
            </div>
        </>
    )
}

function RouterPage({ router, onDisconnect }: { router: ApiState | null; onDisconnect: () => void }) {
    const [info, setInfo] = useState<RouterInfo | null>(null)
    const [ask, dialog] = useConfirm()
    useEffect(() => { desk.api.info().then(setInfo, () => {}) }, [])
    const host = router?.base?.replace(/^https?:\/\//, '') ?? ''
    return (
        <>
            <Head title="Подключение" />
            <Block>
                <dl className="desk-kv">
                    <dt>Роутер</dt><dd>{router?.hostname || host || '—'}</dd>
                    <dt>Адрес</dt><dd>{host || '—'}</dd>
                    <dt>splify2</dt><dd>{info?.version ?? '—'}</dd>
                    <dt>Этот компьютер</dt><dd>{router?.device?.name ?? '—'}</dd>
                </dl>
            </Block>
            <div className="desk-row">
                <Button
                    variant="destructive"
                    onClick={async () => {
                        const ok = await ask({
                            title: 'Отключить этот компьютер от роутера?',
                            body: 'Чтобы подключиться снова, понадобится пароль роутера.',
                            confirmLabel: 'Отключить',
                        })
                        if (ok) onDisconnect()
                    }}
                >
                    Отключить этот компьютер
                </Button>
            </div>
            {dialog}
        </>
    )
}

function Devices() {
    const [list, setList] = useState<RouterDevice[] | null>(null)
    const [err, setErr] = useState('')
    const [ask, dialog] = useConfirm()
    const load = () => desk.api.devices().then((d) => { setList(d); setErr('') }, (e: Error) => setErr(e.message))
    useEffect(() => { load() }, [])
    return (
        <>
            <Head title="Устройства" sub="Компьютеры и программы, которым роутер доверяет" />
            {err && <div className="desk-error">{err}</div>}
            <Block>
                {!list && !err && <div className="desk-note">Загрузка…</div>}
                {list?.length === 0 && <div className="desk-note">Подключённых устройств нет</div>}
                {list?.map((d) => (
                    <div key={d.id} className="desk-device">
                        <MonitorCog aria-hidden="true" />
                        <div className="desk-device-text">
                            <div className="desk-device-name">
                                {d.name}
                                {d.current && <span className="desk-badge">это устройство</span>}
                            </div>
                            <div className="desk-device-sub">
                                {[platformName(d.platform), d.ip, `на связи ${ago(d.seen)}`].filter(Boolean).join(' · ')}
                            </div>
                        </div>
                        {!d.current && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={async () => {
                                    const ok = await ask({
                                        title: `Отключить «${d.name}»?`,
                                        body: 'Устройство перестанет управлять роутером, пока его не подключат заново паролем.',
                                        confirmLabel: 'Отключить',
                                    })
                                    if (!ok) return
                                    desk.api.revoke(d.id).then(load, (e: Error) => setErr(e.message))
                                }}
                            >
                                Отключить
                            </Button>
                        )}
                    </div>
                ))}
            </Block>
            {dialog}
        </>
    )
}

function platformName(p?: string): string {
    if (p === 'win32') return 'Windows'
    if (p === 'linux') return 'Linux'
    if (p === 'darwin') return 'macOS'
    return p || ''
}

function About() {
    const [app, setApp] = useState<{ version: string; electron: string; chrome: string } | null>(null)
    useEffect(() => { desk.app.info().then(setApp, () => {}) }, [])
    const link = (url: string, label: string) => (
        <Button variant="outline" onClick={() => desk.app.open(url)}>{label}</Button>
    )
    return (
        <>
            <div className="desk-about">
                <img src="/favicon.svg" alt="" aria-hidden="true" draggable={false} />
                <div>
                    <div className="desk-about-name">splify2 для компьютера</div>
                    <div className="sp-sub">версия {app?.version ?? '…'}</div>
                </div>
            </div>
            <Block>
                <dl className="desk-kv">
                    <dt>Electron</dt><dd>{app?.electron ?? '—'}</dd>
                    <dt>Chromium</dt><dd>{app?.chrome ?? '—'}</dd>
                </dl>
            </Block>
            <div className="desk-row">
                {link('https://t.me/ssplify', 'Чат поддержки')}
                {link('https://pay.cloudtips.ru/p/fb925110', 'Поддержать проект')}
                {link('https://github.com/splify2/splify2', 'GitHub')}
            </div>
        </>
    )
}

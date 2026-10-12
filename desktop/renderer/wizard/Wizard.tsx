import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Check, LoaderCircle, RefreshCw, Router, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { markSetupDone } from '@/components/board/SetupWizard'
import { Field, inputCls } from '@/components/formbits'
import { ToggleRow } from '@/components/ui/layout'
import { desk, type ApiState, type FoundRouter, type RouterInventory } from '../desk'
import { useSettings } from '../hooks'

type Step = 'welcome' | 'find' | 'password' | 'install' | 'done'

/** Мастер первого запуска: найти роутер, подключить, при нужде — поставить splify2. */
export default function Wizard({ onConnected }: { onConnected: (s: ApiState, setup?: boolean) => void }) {
    const [step, setStep] = useState<Step>('welcome')
    const [target, setTarget] = useState<FoundRouter | null>(null)
    const [password, setPassword] = useState('')
    const [connected, setConnected] = useState<ApiState | null>(null)

    return (
        <div className="desk-wizard">
            <div className="desk-wizard-card an-glass" aria-live="polite">
                {step === 'welcome' && <Welcome onNext={() => setStep('find')} />}
                {step === 'find' && (
                    <Find onPick={(r) => { setTarget(r); setStep('password') }} />
                )}
                {step === 'password' && target && (
                    <Password
                        target={target}
                        onBack={() => setStep('find')}
                        onConnected={(s) => { setConnected(s); setStep('done') }}
                        onInstall={(pw) => { setPassword(pw); setStep('install') }}
                    />
                )}
                {step === 'install' && target && (
                    <Install
                        target={target}
                        password={password}
                        onConnected={(s) => { setConnected(s); setStep('done') }}
                        onBack={() => setStep('password')}
                    />
                )}
                {step === 'done' && connected && <Done state={connected} onFinish={(setup) => onConnected(connected, setup)} />}
            </div>
        </div>
    )
}

function Logo() {
    return (
        <svg className="desk-wizard-logo" viewBox="0 0 64 64" aria-hidden="true">
            <rect x="2" y="2" width="60" height="60" rx="14" fill="#16121f" />
            <path className="desk-wizard-s" pathLength={100} d="M46 13 H31 a9.5 9.5 0 0 0 0 19 h2 a9.5 9.5 0 0 1 0 19 H18" />
        </svg>
    )
}

function Welcome({ onNext }: { onNext: () => void }) {
    return (
        <div className="desk-step desk-wizard-center">
            <Logo />
            <h1 className="sp-title">splify2 для компьютера</h1>
            <p className="sp-sub">Подключим роутер — это пара минут</p>
            <Button className="desk-wizard-main" onClick={onNext}>Начать</Button>
        </div>
    )
}

function routerLine(r: FoundRouter): string {
    if (r.kind === 'splify2') return `splify2 ${r.version ?? ''}`.trim()
    return 'OpenWrt · splify2 не подключён'
}

function Find({ onPick }: { onPick: (r: FoundRouter) => void }) {
    const [list, setList] = useState<FoundRouter[] | null>(null)
    const [manual, setManual] = useState('')
    const [checking, setChecking] = useState(false)
    const [err, setErr] = useState('')

    const scan = () => {
        setList(null)
        desk.wizard.discover().then(setList, () => setList([]))
    }
    useEffect(scan, [])

    async function check(e: FormEvent) {
        e.preventDefault()
        if (!manual.trim()) return
        setChecking(true)
        setErr('')
        try {
            const r = await desk.wizard.probe(manual.trim())
            if (r) onPick(r)
            else setErr('По этому адресу нет роутера OpenWrt')
        } catch (x) {
            setErr(x instanceof Error ? x.message : String(x))
        } finally {
            setChecking(false)
        }
    }

    return (
        <div className="desk-step">
            <h1 className="sp-title">Роутер в сети</h1>
            <p className="sp-sub">{list === null ? 'Ищем…' : list.length ? 'Выберите свой роутер' : 'Роутер не нашёлся — укажите адрес'}</p>
            <div className="desk-found">
                {list === null && (
                    <div className="desk-found-wait"><LoaderCircle className="desk-spin" aria-hidden="true" /> Ищем роутер</div>
                )}
                {list?.map((r) => (
                    <button key={r.address} type="button" className="desk-found-item" onClick={() => onPick(r)}>
                        <Router aria-hidden="true" />
                        <span className="desk-found-text">
                            <span className="desk-found-name">{r.hostname || r.address}</span>
                            <span className="desk-found-sub">{[r.hostname ? r.address : '', routerLine(r)].filter(Boolean).join(' · ')}</span>
                        </span>
                        {r.kind === 'splify2' && <Check className="desk-found-ok" aria-hidden="true" />}
                    </button>
                ))}
            </div>
            <form className="desk-wizard-manual" onSubmit={check}>
                <input
                    className={inputCls + ' desk-input'}
                    value={manual}
                    onChange={(e) => setManual(e.currentTarget.value)}
                    placeholder="Адрес роутера"
                    spellCheck={false}
                    aria-label="Адрес роутера"
                />
                <Button type="submit" variant="outline" disabled={checking || !manual.trim()}>
                    {checking ? <LoaderCircle className="desk-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
                    Проверить
                </Button>
            </form>
            {err && <div className="desk-error" role="alert">{err}</div>}
            {list !== null && (
                <button type="button" className="desk-wizard-link" onClick={scan}>
                    <RefreshCw aria-hidden="true" /> Искать снова
                </button>
            )}
        </div>
    )
}

function Password({ target, onBack, onConnected, onInstall }: {
    target: FoundRouter
    onBack: () => void
    onConnected: (s: ApiState) => void
    onInstall: (password: string) => void
}) {
    const [pass, setPass] = useState('')
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')
    const [inv, setInv] = useState<RouterInventory | null>(null)

    async function submit(e: FormEvent) {
        e.preventDefault()
        setBusy(true)
        setErr('')
        try {
            if (target.kind === 'splify2') {
                onConnected(await desk.api.connect(target.address, pass))
                return
            }
            setInv(await desk.wizard.inspect(target.address, pass))
        } catch (x) {
            setErr(x instanceof Error ? x.message : String(x))
        } finally {
            setBusy(false)
        }
    }

    if (inv) {
        const has = !!inv.splify2
        return (
            <div className="desk-step">
                <BackLink onClick={() => setInv(null)} />
                <h1 className="sp-title">{has ? 'Нужна новая версия splify2' : 'На роутере нет splify2'}</h1>
                <p className="sp-sub">
                    OpenWrt {inv.release}
                    {has ? ` · splify2 ${inv.splify2}` : ''}
                    {inv.steer ? ` · ядро steer ${inv.steer}` : ''}
                </p>
                <p className="desk-wizard-text">
                    {has
                        ? 'Установленная версия не умеет работать с приложением.'
                        : 'splify2 и ядро steer поставятся на роутер — это несколько минут.'}
                </p>
                <Button className="desk-wizard-main" onClick={() => onInstall(pass)}>
                    {has ? 'Обновить splify2' : 'Установить splify2'}
                </Button>
            </div>
        )
    }

    return (
        <form className="desk-step" onSubmit={submit}>
            <BackLink onClick={onBack} />
            <h1 className="sp-title">{target.hostname || target.address}</h1>
            <p className="sp-sub">{target.address} · {routerLine(target)}</p>
            <Field label="Пароль роутера">
                <input
                    className={inputCls + ' desk-input'}
                    type="password"
                    value={pass}
                    onChange={(e) => setPass(e.currentTarget.value)}
                    autoComplete="current-password"
                    autoFocus
                />
            </Field>
            <p className="desk-wizard-text">Тот же, что для входа в веб-интерфейс роутера. Пароль спрашивается один раз.</p>
            {err && <div className="desk-error" role="alert">{err}</div>}
            <Button type="submit" className="desk-wizard-main" disabled={busy}>
                {busy && <LoaderCircle className="desk-spin" aria-hidden="true" />}
                {busy ? 'Подключаем…' : 'Подключить'}
            </Button>
        </form>
    )
}

function Install({ target, password, onConnected, onBack }: {
    target: FoundRouter
    password: string
    onConnected: (s: ApiState) => void
    onBack: () => void
}) {
    const [lines, setLines] = useState<string[]>([])
    const [state, setState] = useState<'run' | 'ok' | 'old' | 'fail'>('run')
    const [err, setErr] = useState('')
    const logRef = useRef<HTMLPreElement>(null)

    useEffect(() => {
        const off = desk.wizard.onLog((l) => setLines((v) => [...v.slice(-400), l]))
        let alive = true
        ;(async () => {
            try {
                const r = await desk.wizard.install(target.address, password)
                if (!alive) return
                if (r.code !== 0) {
                    setState('fail')
                    setErr(`Установка остановилась (код ${r.code})`)
                    return
                }
                // splify2 стоит — подключаемся через его API; нет API — версия старше приложения.
                const found = await desk.wizard.probe(target.address)
                if (found?.kind !== 'splify2') {
                    setState('old')
                    return
                }
                setState('ok')
                onConnected(await desk.api.connect(target.address, password))
            } catch (x) {
                if (!alive) return
                setState('fail')
                setErr(x instanceof Error ? x.message : String(x))
            }
        })()
        return () => { alive = false; off() }
    }, [])

    useEffect(() => {
        const el = logRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [lines])

    return (
        <div className="desk-step">
            <h1 className="sp-title">
                {state === 'run' ? 'Ставим splify2' : state === 'ok' ? 'splify2 установлен' : state === 'old' ? 'splify2 установлен' : 'Установка не удалась'}
            </h1>
            <p className="sp-sub">
                {state === 'run' && <><LoaderCircle className="desk-spin desk-inline" aria-hidden="true" /> Не закрывайте окно — это несколько минут</>}
                {state === 'old' && 'Приложению нужна версия новее — подключите его после обновления splify2'}
                {state === 'fail' && err}
            </p>
            <pre ref={logRef} className="desk-wizard-log" aria-label="Ход установки">{lines.join('\n') || '…'}</pre>
            {(state === 'fail' || state === 'old') && (
                <div className="desk-row">
                    <Button variant="outline" onClick={onBack}>Назад</Button>
                    <Button variant="outline" onClick={() => desk.app.open(`http://${target.address}/cgi-bin/luci/admin/services/splify2`)}>
                        Открыть роутер в браузере
                    </Button>
                </div>
            )}
        </div>
    )
}

function Done({ state, onFinish }: { state: ApiState; onFinish: (setup: boolean) => void }) {
    const [s, set] = useSettings()
    return (
        <div className="desk-step">
            <div className="desk-wizard-check"><Check aria-hidden="true" /></div>
            <h1 className="sp-title">Готово</h1>
            <p className="sp-sub">Компьютер подключён к {state.hostname || state.base}</p>
            {s && (
                <div className="desk-block-body an-glass desk-wizard-prefs">
                    <ToggleRow
                        label="Сообщать о сбоях"
                        caption="Уведомление, когда роутер, ядро или выход перестали отвечать"
                        on={s.notify.enabled}
                        onToggle={() => set({ notify: { enabled: !s.notify.enabled } })}
                    />
                    <ToggleRow
                        label="Запускать вместе с системой"
                        caption="Чтобы сообщать о сбоях, даже когда окно закрыто"
                        on={s.launchAtLogin}
                        onToggle={() => set({ launchAtLogin: !s.launchAtLogin })}
                    />
                </div>
            )}
            {/* Мастер настройки splify2 — часть установки: пройти (панель откроется на нём) или
                пропустить (отметка «пройден» — в памяти интерфейса на роутере). */}
            <Button className="desk-wizard-main" onClick={() => { set({ wizardDone: true }); onFinish(true) }}>
                Настроить splify2
            </Button>
            <button
                type="button"
                className="desk-wizard-link"
                onClick={() => { set({ wizardDone: true }); void markSetupDone().finally(() => onFinish(false)) }}
            >
                Пропустить
            </button>
        </div>
    )
}

function BackLink({ onClick }: { onClick: () => void }) {
    return (
        <button type="button" className="desk-wizard-link desk-wizard-back" onClick={onClick}>
            <ArrowLeft aria-hidden="true" /> Назад
        </button>
    )
}

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, inputCls } from '@/components/formbits'
import { desk, type ApiState } from './desk'

/** Подключение компьютера к роутеру: адрес и пароль один раз, дальше — токены. */
export default function Connect({ initial, note, onConnected, onCancel, title }: {
    initial: string
    note: string
    onConnected: (s: ApiState) => void
    /** Добавление ещё одного роутера: можно вернуться к прежнему. */
    onCancel?: () => void
    title?: string
}) {
    const [addr, setAddr] = useState(initial || '192.168.1.1')
    const [pass, setPass] = useState('')
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState(note)

    async function submit(e: FormEvent) {
        e.preventDefault()
        setBusy(true)
        setErr('')
        try {
            onConnected(await desk.api.connect(addr, pass))
        } catch (x) {
            setErr(x instanceof Error ? x.message : String(x))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="desk-connect">
            <form className="desk-card an-glass" onSubmit={submit}>
                <img src="/favicon.svg" alt="" aria-hidden="true" className="desk-card-logo" draggable={false} />
                <h1 className="sp-title">{title ?? 'Подключение к роутеру'}</h1>
                <p className="sp-sub desk-card-sub">Пароль спрашивается один раз</p>
                <Field label="Адрес роутера">
                    <input
                        className={inputCls + ' desk-input'}
                        value={addr}
                        onChange={(e) => setAddr(e.currentTarget.value)}
                        placeholder="192.168.1.1"
                        autoComplete="off"
                        spellCheck={false}
                        required
                    />
                </Field>
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
                {err && <div className="desk-error" role="alert">{err}</div>}
                <Button type="submit" disabled={busy} className="desk-submit">
                    {busy ? 'Подключаем…' : 'Подключить'}
                </Button>
                {onCancel && (
                    <Button type="button" variant="ghost" disabled={busy} className="desk-submit" onClick={onCancel}>Отмена</Button>
                )}
            </form>
        </div>
    )
}

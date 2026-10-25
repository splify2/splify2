import { useEffect, useState } from 'react'
import { LoaderCircle, Plus, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/layout'
import { Switch } from '@/components/ui/switch'
import { useConfirm } from '@/components/ui/confirm'
import { inputCls } from '@/components/formbits'
import { cacheGet, cacheSet } from '@/lib/cache'
import type { ExtraSection } from '@/components/Console'
import { desk } from '../desk'
import { groupFamilies, groupSites, parseEvents, parseMemory } from './state'

/** ReCheck — обход DPI на трафике, который уходит в интернет напрямую, а не в туннели.
 *  Самостоятельная часть splify2: служба splify2-recheck и движок из отдельного пакета recheck;
 *  ядро steer и правила его не касаются. Только в приложении: под LuCI раздела нет.
 *  Настройка — методами recheck_info / recheck_set (docs/rpcd-api.md). */

export const recheckSection: ExtraSection = {
    id: 'recheck',
    label: 'ReCheck',
    icon: ShieldCheck,
    render: () => <ReCheck />,
}

interface Info {
    installed: boolean
    version: string
    running: boolean
    enabled: boolean
    interface: string
    wan: string
    epoch: number
    persist: boolean
    watch_active: boolean
    resources: string[]
    queued: number
    watched: number
    state: string
    events: string
}

type SetArgs = Partial<{
    enabled: boolean
    interface: string
    persist: boolean
    watch_active: boolean
    resources: string[]
    epoch_bump: boolean
    forget: boolean
}>

const GROUP = 'sp-board-group an-glass space-y-3 rounded-2xl border p-3'
const TILE = 'sp-board-tile an-glass min-w-0 space-y-3 rounded-2xl border p-3.5'
const tileHead = (t: string, extra?: React.ReactNode) => (
    <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-[13px] font-semibold">{t}</div>
        {extra}
    </div>
)

const day = (ms: number) => (ms > 0 ? new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '')
const stamp = (ms: number) => (ms > 0 ? new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

async function call(method: string, args: Record<string, unknown> = {}): Promise<Info & { ok?: boolean; error?: string }> {
    let r: Info & { ok?: boolean; error?: string }
    try {
        r = (await desk.api.call(method, args)) as Info & { ok?: boolean; error?: string }
    } catch (e) {
        /* Шлюз постарше приложения методов ReCheck не знает. */
        if ((e as { code?: string })?.code === 'no_method') throw new Error('Роутер не знает ReCheck — обновите splify2 на роутере')
        throw e
    }
    if (r && r.ok === false) throw new Error(r.error || 'не получилось')
    return r
}

const CACHE_KEY = 'recheck:info'

/** Состояние ReCheck с роутера: сразу — из памяти прошлого открытия, дальше опрос раз в 5 с.
 *  Отказ не глотается: без него экран висел бы на «Загрузка…», пока роутер не ответит, и ни слова
 *  о причине. Ответы приходят по порядку (запоздавший старый не затирает новый), а окно, скрытое
 *  в трей, роутер не опрашивает. */
function useInfo(): { info: Info | null; error: string; reload: () => void } {
    const [info, setInfo] = useState<Info | null>(() => cacheGet<Info>(CACHE_KEY))
    const [error, setError] = useState('')
    const [tick, setTick] = useState(0)
    useEffect(() => {
        let alive = true
        const n = ++seq
        call('recheck_info').then(
            (r) => { if (alive && n === seq) { cacheSet(CACHE_KEY, r); setInfo(r); setError('') } },
            (e: Error) => { if (alive && n === seq) setError(e.message) },
        )
        return () => { alive = false }
    }, [tick])
    useEffect(() => {
        const t = setInterval(() => { if (!document.hidden) setTick((x) => x + 1) }, 5000)
        const onShow = () => { if (!document.hidden) setTick((x) => x + 1) }
        document.addEventListener('visibilitychange', onShow)
        return () => { clearInterval(t); document.removeEventListener('visibilitychange', onShow) }
    }, [])
    return { info, error, reload: () => setTick((x) => x + 1) }
}
let seq = 0

function ReCheck() {
    const { info, error, reload } = useInfo()
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')
    const [ask, dialog] = useConfirm()

    async function set(args: SetArgs) {
        setBusy(true)
        setErr('')
        try {
            await call('recheck_set', args)
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
        } finally {
            setBusy(false)
            reload()
        }
    }

    if (!info) return error ? <div className="desk-error">{error}</div> : <div className="desk-note">Загрузка…</div>

    const mem = parseMemory(info.state || '')
    const sites = groupSites(mem.sites)
    const families = groupFamilies(mem.families)
    const bypassed = sites.filter((s) => s.mods.length > 0)
    const events = parseEvents(info.events || '')
    const state = !info.installed ? 'wait' : info.running ? 'ok' : info.enabled ? 'bad' : 'wait'
    const head = !info.installed ? 'Не установлен'
        : !info.enabled ? 'Выключен'
        : info.running ? `Работает · ${info.wan}`
        : 'Включён, но не запущен'

    return (
        <div className="desk-warp">
            {!info.installed && (
                <div className="desk-warp-banner an-glass">
                    <b>На роутере нет ReCheck.</b> Обход заработает, когда пакет recheck будет установлен.
                </div>
            )}
            {(err || error) && <div className="desk-error">{err || error}</div>}

            <section className={GROUP}>
                <header className="flex flex-wrap items-center gap-3 px-1 pt-1">
                    <span className="desk-warp-dot" data-state={state} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                        <h2 className="sp-sub truncate">{head}</h2>
                        {info.version && <div className="desk-note">версия {info.version}</div>}
                    </div>
                    {busy && <LoaderCircle className="desk-spin h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                    <Switch on={info.enabled} label="Обход DPI" disabled={busy || !info.installed} onClick={() => void set({ enabled: !info.enabled })} />
                </header>

                <div className="grid gap-3 sm:grid-cols-3">
                    <Stat label="Сайтов изучено" value={sites.length} />
                    <Stat label="С обходом" value={bypassed.length} />
                    <Stat label="Пакетов проверено" value={info.queued + info.watched} />
                </div>

                <div className={TILE}>
                    {tileHead('Сайты', mem.saved ? <span className="desk-note">на {stamp(mem.saved)}</span> : undefined)}
                    {sites.length === 0
                        ? <div className="desk-note">{info.running ? 'Пока ничего: сайты появятся, когда понадобится обход' : 'Пусто'}</div>
                        : <div className="max-h-[420px] overflow-auto"><Sites rows={sites} /></div>}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
                    <div className={TILE}>
                        {tileHead('События')}
                        {events.length === 0
                            ? <div className="desk-note">Пусто</div>
                            : (
                                <ul className="max-h-[320px] space-y-1 overflow-auto text-[12.5px]">
                                    {events.map((e, i) => (
                                        <li key={i} className="flex min-w-0 items-center gap-2">
                                            <span className="desk-warp-dot" data-state={e.tone} aria-hidden="true" />
                                            <span className="shrink-0 tabular-nums text-muted-foreground">{e.time}</span>
                                            <span className="min-w-0 truncate font-medium">{e.host || e.ip}</span>
                                            <span className="ml-auto shrink-0 text-muted-foreground">{e.text}{e.times > 1 ? ` ×${e.times}` : ''}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                    </div>
                    <div className={TILE}>
                        {tileHead('Семейства сайтов')}
                        {families.length === 0
                            ? <div className="desk-note">Пусто</div>
                            : (
                                <ul className="space-y-1.5 text-[12.5px]">
                                    {families.map((f, i) => (
                                        <li key={i} className="flex min-w-0 flex-wrap items-center gap-2">
                                            <span className="min-w-0 truncate font-medium">*.{f.suffix}</span>
                                            <span className="text-muted-foreground">{f.transport}</span>
                                            <Mods mods={f.mods} />
                                            <span className="ml-auto shrink-0 text-muted-foreground">{f.confirmed ? `до ${day(f.until)}` : 'пробно'}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                    </div>
                </div>
            </section>

            <section className={GROUP}>
                <header className="px-1 pt-1"><h2 className="sp-sub">Настройки</h2></header>
                <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
                    <div className={TILE}>
                        {tileHead('Выход в интернет')}
                        <Wan current={info.interface} auto={info.wan} disabled={busy} onSave={(v) => void set({ interface: v })} />
                    </div>
                    <div className={TILE}>
                        {tileHead('Изученное')}
                        <Segmented
                            label="Где хранить изученное"
                            value={info.persist ? 'keep' : 'tmp'}
                            onChange={(v) => void set({ persist: v === 'keep' })}
                            items={[
                                { value: 'tmp', label: 'До перезагрузки' },
                                { value: 'keep', label: 'Всегда' },
                            ]}
                        />
                    </div>
                    <div className={TILE}>
                        {tileHead('Провайдер сменился')}
                        <Button variant="outline" size="sm" disabled={busy} onClick={async () => {
                            const ok = await ask({
                                title: 'Подобрать обход заново?',
                                body: 'Найденные обходы будут стёрты, ReCheck подберёт их заново.',
                                confirmLabel: 'Подобрать заново',
                            })
                            if (ok) void set({ epoch_bump: true, forget: true })
                        }}>Подобрать заново</Button>
                    </div>
                    <div className={TILE}>
                        {tileHead('Долгие загрузки', (
                            <Switch
                                on={info.watch_active && info.resources.length > 0}
                                disabled={busy || info.resources.length === 0}
                                label="Следить за долгими загрузками"
                                onClick={() => void set({ watch_active: !info.watch_active })}
                            />
                        ))}
                        <Resources list={info.resources} disabled={busy} onChange={(resources) => void set(resources.length ? { resources } : { resources, watch_active: false })} />
                    </div>
                </div>
            </section>
            {dialog}
        </div>
    )
}

function Stat({ label, value }: { label: string; value: number }) {
    return (
        <div className={TILE.replace('space-y-3', 'space-y-0.5')}>
            <div className="text-[22px] font-semibold tabular-nums leading-tight">{value.toLocaleString('ru-RU')}</div>
            <div className="desk-note">{label}</div>
        </div>
    )
}

function Mods({ mods }: { mods: string[] }) {
    if (!mods.length) return <span className="text-muted-foreground">без обхода</span>
    return (
        <span className="flex flex-wrap gap-1">
            {mods.map((m) => <span key={m} className="an-glass rounded-full border px-2 py-0.5 text-[11.5px]">{m}</span>)}
        </span>
    )
}

function Sites({ rows }: { rows: ReturnType<typeof groupSites> }) {
    return (
        <table className="desk-warp-points">
            <thead>
                <tr><th>Сайт</th><th>Адреса</th><th /><th>Обход</th><th>Помнит</th></tr>
            </thead>
            <tbody>
                {rows.map((r) => (
                    <tr key={`${r.host}|${r.transport}|${r.ips[0]}`}>
                        <td className="max-w-[240px] truncate">{r.host || '—'}</td>
                        <td className="desk-mono max-w-[200px] truncate" title={r.ips.join('\n')}>
                            {r.ips[0]}{r.ips.length > 1 ? ` +${r.ips.length - 1}` : ''}
                        </td>
                        <td className="desk-note">{r.transport}</td>
                        <td><Mods mods={r.mods} /></td>
                        <td className="desk-note">{r.mods.length ? (r.confirmed ? `до ${day(r.until)}` : 'пробно') : ''}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}

function Wan({ current, auto, disabled, onSave }: { current: string; auto: string; disabled: boolean; onSave: (v: string) => void }) {
    const [mode, setMode] = useState(current ? 'own' : 'auto')
    const [v, setV] = useState(current)
    useEffect(() => { setMode(current ? 'own' : 'auto'); setV(current) }, [current])
    const ok = /^[A-Za-z0-9._@-]{1,15}$/.test(v)
    return (
        <div className="space-y-2">
            <Segmented
                label="Выход в интернет"
                value={mode}
                onChange={(m) => { setMode(m); if (m === 'auto' && current) onSave('') }}
                items={[
                    { value: 'auto', label: auto && !current ? `Сам · ${auto}` : 'Сам' },
                    { value: 'own', label: 'Своё устройство' },
                ]}
            />
            {mode === 'own' && (
                <form className="desk-warp-row" onSubmit={(e) => { e.preventDefault(); if (ok) onSave(v) }}>
                    <input className={inputCls + ' desk-input font-mono'} value={v} placeholder={auto || 'eth1'} spellCheck={false}
                        aria-label="Устройство" onChange={(e) => setV(e.currentTarget.value.trim())} />
                    <Button type="submit" size="sm" disabled={disabled || !ok || v === current}>Сохранить</Button>
                </form>
            )}
        </div>
    )
}

/** Адреса проверки: до 4 ссылок https на большие файлы — по ним движок проверяет, что загрузка не
 *  зависает на середине. */
function Resources({ list, disabled, onChange }: { list: string[]; disabled: boolean; onChange: (l: string[]) => void }) {
    const [v, setV] = useState('')
    const ok = /^https:\/\/\S+$/.test(v) && v.length <= 500 && !list.includes(v)
    return (
        <div className="space-y-2">
            {list.map((u) => (
                <div key={u} className="flex min-w-0 items-center gap-2 text-[12.5px]">
                    <span className="desk-mono min-w-0 flex-1 truncate" title={u}>{u}</span>
                    <button type="button" aria-label="Убрать адрес" disabled={disabled}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-transparent p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => onChange(list.filter((x) => x !== u))}>
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                </div>
            ))}
            {list.length === 0 && <div className="desk-note">Нужна ссылка на большой файл с сайта, где загрузки зависают</div>}
            {list.length < 4 && (
                <form className="desk-warp-row" onSubmit={(e) => { e.preventDefault(); if (ok) { onChange([...list, v]); setV('') } }}>
                    <input className={inputCls + ' desk-input font-mono text-xs'} value={v} placeholder="https://…" spellCheck={false}
                        aria-label="Ссылка на файл" onChange={(e) => setV(e.currentTarget.value.trim())} />
                    <Button type="submit" size="sm" variant="outline" disabled={disabled || !ok}><Plus aria-hidden="true" /> Добавить</Button>
                </form>
            )}
        </div>
    )
}

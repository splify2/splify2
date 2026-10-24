import { useEffect, useState, type FormEvent } from 'react'
import { Cloud, LoaderCircle, Plus, Radar, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/layout'
import { useConfirm } from '@/components/ui/confirm'
import { inputCls } from '@/components/formbits'
import Flag from '@/components/Flag'
import { PILL } from '@/components/board/NodePills'
import { pending, usePending } from '@/lib/pending'
import type { Live } from '@/lib/live'
import type { Output, Spec } from '@/lib/model'
import type { ExtraSection } from '@/components/Console'
import { desk, type WarpScan, type WarpState } from '../desk'

/** WarpBox — выходы Cloudflare WARP (`kind: warp`, модуль steer-warpbox). Только в приложении:
 *  под LuCI этого раздела нет. Настройка — в спеке через тот же pending, что у всей панели
 *  (правка применяется сама); состояние туннелей — из status (группа и её члены `<выход>.<n>`),
 *  точки входа и подбор — шлюз API /v1/warp. */
export const warpSection: ExtraSection = {
    id: 'warpbox',
    label: 'WarpBox',
    icon: Cloud,
    render: (live) => <WarpBox live={live} />,
}

/** Страны выхода, которые чаще всего берут. Остальные — вводом кода. */
const QUICK = ['RU', 'NL', 'DE', 'FI', 'SE', 'PL', 'GB', 'FR', 'US']

type WarpOut = Output & { extra?: Record<string, unknown> }

const isWarp = (o: Output) => (o.kind as string) === 'warp'

/** Точка «адрес:порт»; у MASQUE адрес бывает IPv6 — тогда в скобках. */
const hostPort = (ip: string, port?: number) => `${ip.includes(':') ? `[${ip}]` : ip}${port ? `:${port}` : ''}`

/** `status.outputs.<группа>.group.warp`: неизвестные значения отсутствуют. */
interface WarpStatus {
    mask?: string
    why?: string
    members?: { out: string; ip?: string; port?: number; colo?: string; seen?: string; ok?: boolean }[]
}
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const codes = (v: unknown) => (Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string') : undefined)

function editOut(spec: Spec, name: string, patch: Record<string, unknown>) {
    const o = spec.outputs[name] as WarpOut
    const extra = { ...(o.extra || {}) }
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete extra[k]
        else extra[k] = v
    }
    pending.edit({ ...spec, outputs: { ...spec.outputs, [name]: { ...o, extra } } })
}

function WarpBox({ live }: { live: Live }) {
    const { spec } = usePending()
    const [info, setInfo] = useState<WarpState | null>(null)
    const [infoErr, setInfoErr] = useState('')

    useEffect(() => {
        let alive = true
        const load = () => desk.warp.state().then(
            (s) => { if (alive) { setInfo(s); setInfoErr('') } },
            (e: Error) => { if (alive) setInfoErr(e.message) },
        )
        load()
        const t = setInterval(load, 10000)
        return () => { alive = false; clearInterval(t) }
    }, [])

    if (!spec) return <div className="desk-note">Загрузка…</div>
    const outs = Object.values(spec.outputs).filter(isWarp) as WarpOut[]

    return (
        <div className="desk-warp">
            {info && !info.module && (
                <div className="desk-warp-banner an-glass">
                    <b>На роутере нет модуля WarpBox.</b> Выход WARP заработает, когда модуль steer-warpbox будет установлен.
                </div>
            )}
            {info?.module && !info.kernel && (
                <div className="desk-warp-banner an-glass">
                    <b>В ядре роутера нет WireGuard.</b> Нужен пакет kmod-amneziawg или kmod-wireguard.
                </div>
            )}
            {infoErr && <div className="desk-error">{infoErr}</div>}
            {outs.map((o) => (
                <Group key={o.name} spec={spec} out={o} live={live} info={info} />
            ))}
            {outs.length === 0 ? <Create spec={spec} first /> : <Create spec={spec} />}
        </div>
    )
}

function Create({ spec, first = false }: { spec: Spec; first?: boolean }) {
    const [open, setOpen] = useState(first)
    const free = (n: string) => !spec.outputs[n]
    const [name, setName] = useState(free('warp') ? 'warp' : 'warp2')
    const ok = /^[a-z][a-z0-9_-]{0,14}$/.test(name) && free(name)

    function add(e: FormEvent) {
        e.preventDefault()
        if (!ok) return
        pending.edit({
            ...spec,
            /* Умолчания модуля: один туннель, страны любые. */
            outputs: { ...spec.outputs, [name]: { name, kind: 'warp' as Output['kind'] } as WarpOut },
        })
        setOpen(false)
    }

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                style={{ borderColor: 'color-mix(in srgb, var(--sp-muted-foreground) 45%, transparent)' }}
                className="flex h-[64px] w-full items-center justify-center gap-2 rounded-2xl border border-dashed bg-transparent text-sm text-muted-foreground transition-colors duration-200 hover:border-primary/50 hover:text-primary"
            >
                <Plus className="h-4 w-4" aria-hidden="true" /> Ещё один выход WARP
            </button>
        )
    }
    return (
        <form className="sp-board-group an-glass desk-warp-create space-y-3 rounded-2xl border p-4" onSubmit={add}>
            <div className="desk-warp-hero">
                <Cloud aria-hidden="true" />
                <div>
                    <div className="desk-warp-title">{first ? 'Выход через Cloudflare WARP' : 'Новый выход WARP'}</div>
                    <div className="desk-note">Бесплатный туннель Cloudflare: роутер сам регистрирует устройства, подбирает рабочие точки и меняет упавшие</div>
                </div>
            </div>
            <div className="desk-warp-row">
                <input
                    className={inputCls + ' desk-input'}
                    value={name}
                    onChange={(e) => setName(e.currentTarget.value.toLowerCase())}
                    aria-label="Имя выхода"
                    spellCheck={false}
                />
                <Button type="submit" disabled={!ok}>Добавить</Button>
                {!first && <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>}
            </div>
            {!ok && name && <div className="desk-note">{free(name) ? 'Латиница, цифры, «-» и «_», до 15 знаков' : 'Выход с таким именем уже есть'}</div>}
        </form>
    )
}

function Group({ spec, out, live, info }: { spec: Spec; out: WarpOut; live: Live; info: WarpState | null }) {
    const x = out.extra || {}
    /* По умолчанию туннель один (steer 2.1.0): самую быструю точку модуль держит у того же устройства. */
    const count = num(x.count, 1)
    const pick = x.pick === 'order' ? 'order' : 'latency'
    // MASQUE — туннели по HTTP/3, их держит сам модуль (вид членов warp-masque в ядре).
    const transport = x.transport === 'masque' ? 'masque' : 'awg'
    const only = codes(x.countries)
    const except = codes(x.exclude_countries)
    const st = live.status?.outputs?.[out.name]
    const g = st?.group
    const winfo = info?.groups.find((w) => w.name === out.name)
    const used = spec.channels.filter((c) => c.out === out.name).length
    const [ask, dialog] = useConfirm()

    const members = Array.from({ length: count }, (_, i) => `${out.name}.${i + 1}`)
    /* Что модуль знает о туннелях — `status.group.warp` (steer, ветка warpbox): точка, колония,
     * страна, которую видят сайты. Поля нет (модуль старше) — точка из файла туннеля (/v1/warp). */
    const wst = (g as { warp?: WarpStatus } | undefined)?.warp
    const selected = g?.selected ?? null
    const alive = new Set(g?.alive ?? [])
    /* Почему группа держится не за самый быстрый туннель (`status.group.why`, ядро steer): разница
     * меньше допуска — переключение рвало бы соединения ради нескольких миллисекунд. Без
     * пояснения 418 мс против 263 читались как поломка (поймал владелец). */
    const gx = g as { why?: string; tolerance?: number } | undefined
    const hold = gx?.why === 'in_tolerance' && selected
        ? ` · держится: разница с самым быстрым меньше ${gx.tolerance ?? 50} мс`
        : ''
    const head = !st ? 'Ещё не применён'
        : selected ? `Работает · через ${selected}${hold}`
        : 'Ни один туннель не отвечает'

    const GROUP = 'sp-board-group an-glass space-y-3 rounded-2xl border p-3'
    const TILE = 'sp-board-tile an-glass min-w-0 space-y-3 rounded-2xl border p-3.5'
    const tileHead = (t: string) => <div className="text-[13px] font-semibold">{t}</div>

    /* Блоками, как главная и правило: выход — блок, внутри плитки — туннели пилюлями, подбор
     * точек и по плитке на настройку. */
    return (
        <section className={GROUP}>
            <header className="flex flex-wrap items-center gap-3 px-1 pt-1">
                <span className="desk-warp-dot" data-state={!st ? 'wait' : selected ? 'ok' : 'bad'} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <h2 className="sp-sub truncate">{out.name}</h2>
                    <div className="desk-note">{head}{used ? ` · правил: ${used}` : ''}</div>
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={used > 0}
                    title={used ? 'Сначала уберите этот выход из правил' : undefined}
                    className="text-destructive"
                    onClick={async () => {
                        const ok = await ask({
                            title: `Удалить выход «${out.name}»?`,
                            body: 'Регистрации WARP останутся на роутере и пригодятся, если выход вернётся.',
                            confirmLabel: 'Удалить',
                        })
                        if (!ok) return
                        const outputs = { ...spec.outputs }
                        delete outputs[out.name]
                        pending.edit({ ...spec, outputs })
                    }}
                >
                    <Trash2 aria-hidden="true" /> Удалить
                </Button>
            </header>

            {wst?.why && <div className="desk-error">{wst.why}</div>}

            <div className={TILE}>
                {tileHead('Туннели')}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                    {members.map((m) => {
                        const w = winfo?.members.find((mm) => mm.name === m)
                        const ws = wst?.members?.find((mm) => mm.out === m)
                        const ep = ws?.ip ? hostPort(ws.ip, ws.port) : w?.endpoint
                        const lat = g?.latency?.[m]
                        const state = !st ? 'wait' : alive.has(m) ? 'ok' : 'bad'
                        const on = m === selected
                        return (
                            <div
                                key={m}
                                className={`${PILL} ${on ? 'border-primary/80 bg-primary/10' : ''}`}
                                title={on ? 'Несёт трафик' : undefined}
                            >
                                <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
                                    <span className="desk-warp-dot" data-state={state} aria-hidden="true" />
                                    <span className="min-w-0 truncate">{m}</span>
                                    <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                                        {typeof lat === 'number' ? `${lat} мс` : ''}
                                    </span>
                                </span>
                                <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
                                    {ws?.seen && <Flag cc={ws.seen} />}
                                    {ws?.colo && <span className="shrink-0">{ws.colo}</span>}
                                    <span className="min-w-0 truncate font-mono">{ep ?? (w?.reg ? 'подбирается точка' : 'регистрация')}</span>
                                </span>
                            </div>
                        )
                    })}
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
                <div className={TILE}>
                    {tileHead('Туннелей')}
                    <Segmented
                        label="Сколько туннелей"
                        value={String(count)}
                        onChange={(v) => editOut(spec, out.name, { count: Number(v) === 1 ? undefined : Number(v) })}
                        items={['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }))}
                    />
                </div>
                <div className={TILE}>
                    {tileHead('Какой туннель брать')}
                    <Segmented
                        label="Какой туннель брать"
                        value={pick}
                        onChange={(v) => editOut(spec, out.name, { pick: v === 'latency' ? undefined : v })}
                        items={[
                            { value: 'latency', label: 'Самый быстрый' },
                            { value: 'order', label: 'По порядку' },
                        ]}
                    />
                </div>
                <div className={TILE}>
                    {tileHead('Точки входа')}
                    <Scan group={out.name} applied={!!winfo} initial={info?.scans?.[out.name]} />
                </div>
                <div className={TILE}>
                    {tileHead('Страна выхода')}
                    <Countries
                        only={only}
                        except={except}
                        onChange={(o, e) => editOut(spec, out.name, { countries: o, exclude_countries: e })}
                    />
                </div>
            </div>

            <div className={TILE}>
                {tileHead('Протокол')}
                <Segmented
                    label="Протокол"
                    value={transport}
                    onChange={(v) => editOut(spec, out.name, { transport: v === 'awg' ? undefined : v })}
                    items={[
                        { value: 'awg', label: 'AmneziaWG' },
                        { value: 'masque', label: 'MASQUE' },
                    ]}
                />
            </div>
            {dialog}
        </section>
    )
}

/** Страны: «любая, кроме…» или «только…». */
function Countries({ only, except, onChange }: {
    only?: string[]
    except?: string[]
    onChange: (only: string[] | undefined, except: string[] | undefined) => void
}) {
    const mode = only?.length ? 'only' : 'except'
    // Ключей нет — страны любые (steer 2.1.0, docs/warp.md: RU по умолчанию не исключается).
    const list = mode === 'only' ? only! : except ?? []
    const [code, setCode] = useState('')

    const set = (next: string[]) => (mode === 'only'
        ? onChange(next.length ? next : undefined, undefined)
        : onChange(undefined, next.length ? next : undefined))
    const add = (c: string) => {
        const cc = c.trim().toUpperCase()
        if (!/^[A-Z]{2}$/.test(cc) || list.includes(cc)) return
        set([...list, cc])
        setCode('')
    }

    return (
        <div className="desk-warp-countries">
            <Segmented
                label="Как выбирать страну"
                value={mode}
                onChange={(m) => (m === 'only' ? onChange(['NL'], undefined) : onChange(undefined, undefined))}
                items={[
                    { value: 'except', label: 'Любая, кроме' },
                    { value: 'only', label: 'Только' },
                ]}
            />
            <div className="desk-warp-chips">
                {list.map((c) => (
                    <span key={c} className="desk-warp-chip">
                        <Flag cc={c} /> {c}
                        <button type="button" aria-label={`Убрать ${c}`} onClick={() => set(list.filter((x) => x !== c))}><X /></button>
                    </span>
                ))}
                {list.length === 0 && <span className="desk-note">{mode === 'except' ? 'без исключений' : ''}</span>}
            </div>
            <div className="desk-warp-chips">
                {QUICK.filter((c) => !list.includes(c)).map((c) => (
                    <button key={c} type="button" className="desk-warp-chip desk-warp-chip-add" onClick={() => add(c)}>
                        <Flag cc={c} /> {c}
                    </button>
                ))}
                <form className="desk-warp-code" onSubmit={(e) => { e.preventDefault(); add(code) }}>
                    <input
                        className={inputCls}
                        value={code}
                        maxLength={2}
                        placeholder="код"
                        aria-label="Код страны"
                        onChange={(e) => setCode(e.currentTarget.value)}
                    />
                </form>
            </div>
        </div>
    )
}

const CLASS_TEXT = ['годна', 'колония занята', 'без HTTPS']

function Scan({ group, applied, initial }: { group: string; applied: boolean; initial?: WarpScan }) {
    const [scan, setScan] = useState<WarpScan | null>(initial ?? null)
    const [err, setErr] = useState('')

    useEffect(() => { if (initial && !scan) setScan(initial) }, [initial])

    useEffect(() => {
        if (!scan?.running) return
        const t = setInterval(() => desk.warp.scanState(group).then(setScan, () => {}), 3000)
        return () => clearInterval(t)
    }, [scan?.running, group])

    const start = () => {
        setErr('')
        desk.warp.scan(group).then(
            () => desk.warp.scanState(group).then(setScan, () => {}),
            (e: Error) => setErr(e.message),
        )
    }
    const pts = scan?.result?.points ?? []

    return (
        <div className="desk-warp-scan">
            <div className="desk-warp-row">
                <Button variant="outline" size="sm" disabled={!applied || scan?.running} onClick={start}>
                    {scan?.running ? <LoaderCircle className="desk-spin" aria-hidden="true" /> : <Radar aria-hidden="true" />}
                    {scan?.running ? 'Подбираем точки…' : 'Подобрать точки'}
                </Button>
                {!applied && <span className="desk-note">После сохранения</span>}
                {scan?.result && !scan.running && (
                    <span className="desk-note">
                        {scan.result.ok !== false ? `найдено: ${pts.length}` : scan.result.error}
                        {scan.result.filtered ? ` · отсеяно фильтром стран: ${scan.result.filtered}` : ''}
                    </span>
                )}
            </div>
            {err && <div className="desk-error">{err}</div>}
            {pts.length > 0 && !scan?.running && scan?.result?.transport === 'masque' && (
                <table className="desk-warp-points">
                    <thead>
                        <tr><th>Точка</th><th>Задержка</th><th /></tr>
                    </thead>
                    <tbody>
                        {pts.map((p) => (
                            <tr key={hostPort(p.ip, p.port)} data-class={p.ok ? 0 : 2}>
                                <td className="desk-mono">{hostPort(p.ip, p.port)}</td>
                                <td>{typeof p.rtt === 'number' && p.rtt >= 0 ? `${p.rtt} мс` : '—'}</td>
                                <td className="desk-note">{p.ok ? 'годна' : p.error || 'не ответила'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            {pts.length > 0 && !scan?.running && scan?.result?.transport !== 'masque' && (
                <table className="desk-warp-points">
                    <thead>
                        <tr><th>Точка</th><th>Колония</th><th>Задержка</th><th>Потери</th><th /></tr>
                    </thead>
                    <tbody>
                        {pts.map((p) => (
                            <tr key={hostPort(p.ip, p.port)} data-class={p.class}>
                                <td className="desk-mono">{hostPort(p.ip, p.port)}</td>
                                <td><Flag cc={p.cc} /> {p.colo || '—'}</td>
                                <td>{typeof p.rtt === 'number' && p.rtt >= 0 ? `${p.rtt} мс` : '—'}</td>
                                <td>{p.loss ?? 0}%</td>
                                <td className="desk-note">{CLASS_TEXT[p.class ?? -1] ?? ''}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    )
}

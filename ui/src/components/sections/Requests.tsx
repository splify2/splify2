import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Pause, Play, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Block, CardHead, Segmented } from '@/components/ui/layout'
import { DayChart, Spark } from '@/components/ui/spark'
import { bitRate, human, type Live } from '@/lib/live'
import { DAY_MS, BIN_MS } from '@/lib/history'
import { devList } from '@/lib/model'
import { explainSummary } from '@/lib/engineerr'
import { usePending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { agoText, hostPort, matches, nodesOf, rulesOf, tcpWord, type Conn, type ConnsReply } from '@/lib/observe'
import type { DnsLog } from '@/lib/rpc'

import { S } from '@/copy'
/** «Запросы»: что ядро steer делает с трафиком прямо сейчас — в одном месте.
 *
 *  Три взгляда на один вопрос «куда ушло»: ИМЕНА (что спрашивали у резолвера ядра и какое
 *  правило, выход и узел им достались), СОЕДИНЕНИЯ (кто, куда и через какой выход идёт) и ТРАФИК
 *  (скорость и история выходов, клиенты). Прежде это были две карточки в «Диагностике» со своими
 *  таймерами, и «Почему сюда» жило отдельно, на главной.
 *
 *  Данные не спрашиваются отсюда: экран просит тему у общего опроса (live.want) и получает ответ
 *  в том же такте, что и состояние. Пауза отпускает тему — роутеру это ничего не стоит, — а
 *  показанное остаётся как есть: человек читает строку, которая иначе уехала бы вниз. */

type Tab = 'names' | 'conns' | 'traffic'

/** Поле поиска с кнопкой очистки. */
function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
    return (
        <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {value && (
                <button
                    type="button"
                    onClick={() => onChange('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={S.observe.ochistitPoisk}
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    )
}

/** «Почему сюда»: ответ ядра на тот же вопрос, что задаёт строка «Куда пойдёт запрос» на главной. */
function Why({ address }: { address: string }) {
    const [open, setOpen] = useState(false)
    const [text, setText] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const summary = text ? explainSummary(text) : null
    const toggle = () => {
        if (open) { setOpen(false); return }
        setOpen(true)
        setBusy(true)
        rpc.explain(address)
            .then((r) => setText(r.text))
            .catch((e) => setText(String(e instanceof Error ? e.message : e)))
            .finally(() => setBusy(false))
    }
    return (
        <>
            <button type="button" onClick={toggle} aria-expanded={open} className="bg-transparent p-0 text-[11px] text-primary hover:underline">
                {open ? S.requests.skryt : S.requests.pochemuSyuda}
            </button>
            {open && (
                <div className="basis-full rounded-lg border border-border bg-muted p-2 text-[12px]">
                    {busy ? S.requests.sprashivaem : summary ? (
                        <>
                            <p>{summary}</p>
                            <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">{text}</pre>
                        </>
                    ) : (
                        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px]">{text}</pre>
                    )}
                </div>
            )}
        </>
    )
}

function NameRow({ n, live }: { n: NonNullable<DnsLog['names']>[number]; live: Live }) {
    const nodes = nodesOf(live.status, n.out)
    return (
        <li className="space-y-0.5 py-2 first:pt-0 last:pb-0">
            <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[13px]">{n.name}</span>
                <span className={`shrink-0 text-[13px] ${n.out ? 'font-medium' : 'text-muted-foreground'}`}>
                    {n.out ?? S.observe.mimoPravil}
                </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-subtle">
                {n.channel && <span>{S.observe.poPravilu(n.channel)}</span>}
                {nodes.length > 0 && <span>{S.requests.cherezUzel(nodes.join(', '))}</span>}
                <span>{S.observe.raz(n.count)}</span>
                <span>{agoText(n.ago)}</span>
                <Why address={n.name} />
            </div>
        </li>
    )
}

function ConnRow({ c, who, rules, nodes }: { c: Conn; who: string | null; rules: string[]; nodes: string[] }) {
    const tcp = c.proto === 'tcp' ? tcpWord(c.state) : null
    const down = c.reply_bytes
    const up = c.bytes
    return (
        <li className="space-y-0.5 py-2 first:pt-0 last:pb-0">
            <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
                    <span className="min-w-0 truncate">{who || c.src}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 truncate font-mono text-[12px]">{hostPort(c.dst, c.dport)}</span>
                </span>
                <span className={`shrink-0 text-[13px] font-medium ${c.out ? '' : 'text-muted-foreground'}`}>
                    {c.out ?? S.observe.vyhodUbran}
                </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-subtle">
                {rules.length > 0 && (
                    <span>{rules.length === 1 ? S.observe.poPravilu(rules[0]) : S.observe.poOdnomuIzPravil(rules.join(', '))}</span>
                )}
                {nodes.length > 0 && <span>{S.requests.cherezUzel(nodes.join(', '))}</span>}
                <span>{c.proto.toUpperCase()}</span>
                {who && <span>{c.src}</span>}
                {tcp && <span>{tcp}</span>}
                {(down !== undefined || up !== undefined) && (
                    <span className="tabular-nums">↓ {human(down ?? 0)} ↑ {human(up ?? 0)}</span>
                )}
                <Why address={c.dst} />
            </div>
        </li>
    )
}

/** Выходы: скорость сейчас, спарклайн, график за сутки и сколько прошло с запуска — по
 *  устройствам выхода (у пула из нескольких туннелей их несколько, и скорость выхода — сумма). */
function OutputsStats({ live }: { live: Live }) {
    const { spec } = usePending()
    const now = Date.now()
    const rows = Object.entries(live.status?.outputs ?? {})
        .filter(([n, o]) => o.kind !== 'direct' && (!spec || !!spec.outputs[n]) && !spec?.outputs[n]?.part_of)
        .map(([name, o]) => ({ name, devs: devList(o).length ? devList(o) : devList(spec?.outputs[name]) }))
        .filter((r) => r.devs.length > 0)
    if (rows.length === 0) return <p className="text-sm text-muted-foreground">{S.requests.vyhodovNet}</p>
    return (
        <ul className="divide-y divide-border">
            {rows.map(({ name, devs }) => {
                const keys = devs.map((d) => 'dev:' + d)
                const fine = live.history.series(...keys)
                const last = fine[fine.length - 1]
                const rx = devs.reduce((a, d) => a + Number(live.devs?.[d]?.rx ?? 0), 0)
                const tx = devs.reduce((a, d) => a + Number(live.devs?.[d]?.tx ?? 0), 0)
                return (
                    <li key={name} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate text-[13px] font-medium">{name}</span>
                            <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
                                {last && (last.down > 0 || last.up > 0) && (
                                    <span className="flex gap-2 text-foreground">
                                        <span>↓ {bitRate(last.down)}</span>
                                        <span>↑ {bitRate(last.up)}</span>
                                    </span>
                                )}
                                <Spark points={fine} />
                            </span>
                        </div>
                        <DayChart
                            points={live.history.daySeries(...keys)}
                            now={now}
                            dayMs={DAY_MS}
                            binMs={BIN_MS}
                            peakText={(m) => S.stats.pik(bitRate(m))}
                            label={S.stats.grafikVyhoda(name)}
                        />
                        <div className="text-[11px] tabular-nums text-subtle">
                            {S.requests.vsego} ↓ {human(rx)} ↑ {human(tx)}
                        </div>
                    </li>
                )
            })}
        </ul>
    )
}

/** Клиенты: сколько каждый унёс через выходы — по счётчикам открытых соединений (их ведёт ядро
 *  Linux, и без них блока нет: нуль был бы неправдой). Имена — из аренд DHCP. */
function ClientsStats({ conns, leases }: { conns: Conn[]; leases: Record<string, string> }) {
    const rows = useMemo(() => {
        const by = new Map<string, { up: number; down: number }>()
        for (const c of conns) {
            if (c.bytes === undefined && c.reply_bytes === undefined) continue
            const r = by.get(c.src) ?? { up: 0, down: 0 }
            r.up += c.bytes ?? 0
            r.down += c.reply_bytes ?? 0
            by.set(c.src, r)
        }
        return [...by.entries()].sort((a, b) => b[1].up + b[1].down - (a[1].up + a[1].down))
    }, [conns])
    if (rows.length === 0) return <p className="text-sm text-muted-foreground">{S.requests.klientovNet}</p>
    return (
        <ul className="divide-y divide-border">
            {rows.map(([src, v]) => (
                <li key={src} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="min-w-0 truncate text-[13px]">{leases[src] || src}</span>
                    <span className="shrink-0 text-xs tabular-nums text-subtle">↓ {human(v.down)} ↑ {human(v.up)}</span>
                </li>
            ))}
        </ul>
    )
}

export default function Requests({ live }: { live: Live; board?: boolean }) {
    const [tab, setTab] = useState<Tab>('names')
    const [paused, setPaused] = useState(false)
    const [q, setQ] = useState('')
    const [ruled, setRuled] = useState<'all' | 'ruled'>('all')
    const { spec } = usePending()
    const { want } = live

    /* Темы круга — только пока экран открыт, вкладка нужна и нет паузы. */
    const wantNames = tab === 'names'
    const wantConns = tab !== 'names'
    useEffect(() => {
        if (paused) return
        const off = wantNames ? want('dnsLog') : want('conns')
        return off
    }, [paused, wantNames, wantConns, want])

    /* Показанное — последний полученный ответ: пауза и смена вкладки не стирают его, а следующий
     * ответ заменяет. Тема сбрасывается в опросе при уходе — это держит «Загрузка…» честным
     * только на первом открытии. */
    const [names, setNames] = useState<DnsLog | null>(null)
    const [conns, setConns] = useState<ConnsReply | null>(null)
    useEffect(() => { if (live.dnsLog) setNames(live.dnsLog) }, [live.dnsLog])
    useEffect(() => { if (live.conns) setConns(live.conns) }, [live.conns])

    /* Имена из аренд DHCP: «iPhone» читается, 192.168.1.23 — нет. Один раз на экран. */
    const [leases, setLeases] = useState<Record<string, string>>({})
    useEffect(() => {
        rpc.leases()
            .then((r) => setLeases(Object.fromEntries((r.leases || []).filter((l) => l.name && l.name !== '*').map((l) => [l.ip, l.name]))))
            .catch(() => {})
    }, [])

    const nameList = useMemo(() => names?.names || [], [names])
    const shownNames = useMemo(
        () => nameList.filter((n) => (ruled === 'all' || n.channel) && matches(q, [n.name, n.channel, n.out, ...nodesOf(live.status, n.out)])),
        [nameList, q, ruled, live.status],
    )
    const connList = useMemo(() => conns?.conns || [], [conns])
    const shownConns = useMemo(
        () => connList.filter((c) => matches(q, [c.src, c.dst, c.dport, c.proto, c.out, leases[c.src], ...rulesOf(spec, c.out), ...nodesOf(live.status, c.out)])),
        [connList, q, leases, spec, live.status],
    )

    const loading = (t: unknown) => t === null
    const search = (
        <div className="flex items-center gap-2">
            <SearchBox value={q} onChange={setQ} placeholder={tab === 'names' ? S.requests.poiskImen : S.requests.poiskSoedineniy} />
            <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-xs" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
                {paused ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}
                <span>{paused ? S.requests.prodolzhit : S.requests.pauza}</span>
            </Button>
        </div>
    )

    return (
        <div className="space-y-4">
            <Segmented<Tab>
                label={S.requests.vkladki}
                items={[
                    { value: 'names', label: S.requests.imena },
                    { value: 'conns', label: S.requests.soedineniya },
                    { value: 'traffic', label: S.requests.trafik },
                ]}
                value={tab}
                onChange={setTab}
            />

            {tab === 'names' && (
                <Block>
                    <CardHead title={S.observe.imena} meta={names?.running && nameList.length ? nameList.length : undefined} />
                    {loading(names) ? (
                        <p className="py-4 text-center text-sm text-muted-foreground">{S.observe.zagruzka}</p>
                    ) : !names?.running ? (
                        <p className="text-sm text-muted-foreground">{S.observe.rezolverNeZapushchen}</p>
                    ) : nameList.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{S.observe.imenNet}</p>
                    ) : (
                        <div className="space-y-2">
                            {search}
                            <Segmented<'all' | 'ruled'>
                                label={S.observe.kakieImena}
                                items={[
                                    { value: 'all', label: S.observe.vse },
                                    { value: 'ruled', label: S.observe.podPravilami },
                                ]}
                                value={ruled}
                                onChange={setRuled}
                            />
                            {paused && <p className="text-xs text-muted-foreground">{S.requests.naPauze}</p>}
                            {shownNames.length === 0 ? (
                                <p className="py-3 text-center text-xs text-muted-foreground">{S.observe.nichegoNeNaydeno}</p>
                            ) : (
                                <ul className="max-h-[32rem] divide-y divide-border overflow-auto pr-1">
                                    {shownNames.map((n) => <NameRow key={n.name} n={n} live={live} />)}
                                </ul>
                            )}
                        </div>
                    )}
                </Block>
            )}

            {tab === 'conns' && (
                <Block>
                    <CardHead
                        title={S.observe.soedineniya}
                        meta={conns && !conns.error ? (conns.truncated ? S.observe.pokazanyIz(conns.shown ?? connList.length, conns.total ?? connList.length) : connList.length) : undefined}
                    />
                    {loading(conns) ? (
                        <p className="py-4 text-center text-sm text-muted-foreground">{S.observe.zagruzka}</p>
                    ) : conns?.error ? (
                        <p className="text-sm text-muted-foreground">{S.observe.soedineniyaNedostupny}</p>
                    ) : connList.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{S.observe.soedineniyNet}</p>
                    ) : (
                        <div className="space-y-2">
                            {search}
                            {paused && <p className="text-xs text-muted-foreground">{S.requests.naPauze}</p>}
                            {shownConns.length === 0 ? (
                                <p className="py-3 text-center text-xs text-muted-foreground">{S.observe.nichegoNeNaydeno}</p>
                            ) : (
                                <ul className="max-h-[32rem] divide-y divide-border overflow-auto pr-1">
                                    {shownConns.map((c, i) => (
                                        <ConnRow
                                            key={`${c.proto}-${c.src}-${c.sport ?? ''}-${c.dst}-${c.dport ?? ''}-${i}`}
                                            c={c}
                                            who={leases[c.src] || null}
                                            rules={rulesOf(spec, c.out)}
                                            nodes={nodesOf(live.status, c.out)}
                                        />
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </Block>
            )}

            {tab === 'traffic' && (
                <>
                    <Block>
                        <CardHead title={S.requests.vyhody} />
                        <OutputsStats live={live} />
                    </Block>
                    {conns && !conns.error && connList.some((c) => c.bytes !== undefined || c.reply_bytes !== undefined) && (
                        <Block>
                            <CardHead title={S.requests.klienty} meta={S.requests.vOtkrytyh} />
                            <ClientsStats conns={connList} leases={leases} />
                        </Block>
                    )}
                </>
            )}
        </div>
    )
}

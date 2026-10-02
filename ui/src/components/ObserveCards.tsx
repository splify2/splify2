import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, RefreshCw, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Block, CardHead } from '@/components/ui/layout'
import { human } from '@/lib/live'
import { usePending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { hostPort, matches, rulesOf, tcpWord, type Conn } from '@/lib/observe'

import { S } from '@/copy'
/** «Что ядро steer делает с трафиком прямо сейчас» — в «Диагностике», рядом с проверками.
 *
 *  Соединения: какие соединения ядро повело в свои выходы — кто, куда, через какой выход и по
 *  какому правилу (`steer conns`). Ответ читается целиком из памяти ядра Linux, без процессов, —
 *  поэтому его можно спрашивать на круге экрана, как журнал.
 *
 *  Опрос — пока экран открыт и вкладка видна, раз в пять секунд, как у журнала рядом: общий круг
 *  страницы этого не спрашивает, и закрытая «Диагностика» не стоит роутеру ничего. */

const POLL_MS = 5000

/** Вызов по кругу, пока компонент на экране и вкладка видна; `pull` — спросить сейчас. */
function usePoll<T>(fn: () => Promise<T>): { data: T | null; failed: boolean; busy: boolean; pull: () => void } {
    const [data, setData] = useState<T | null>(null)
    const [failed, setFailed] = useState(false)
    const [busy, setBusy] = useState(false)
    const alive = useRef(true)
    const ask = useCallback(() => {
        setBusy(true)
        fn()
            .then((d) => { if (alive.current) { setData(d); setFailed(false) } })
            .catch(() => { if (alive.current) setFailed(true) })
            .finally(() => { if (alive.current) setBusy(false) })
    }, [fn])
    useEffect(() => {
        alive.current = true
        ask()
        const id = setInterval(() => { if (!document.hidden) ask() }, POLL_MS)
        return () => { alive.current = false; clearInterval(id) }
    }, [ask])
    return { data, failed, busy, pull: ask }
}

/** Поле поиска с кнопкой очистки — та же форма, что у журнала. */
function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
    return (
        <div className="relative">
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

function Refresh({ busy, onClick, label }: { busy: boolean; onClick: () => void; label: string }) {
    return (
        <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            disabled={busy}
            onClick={onClick}
            aria-label={label}
        >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            <span>{S.observe.obnovit}</span>
        </Button>
    )
}

/** Одно соединение строкой: кто → куда, справа выход; под ними правило, протокол, состояние и
 *  объём в обе стороны (если ядро Linux его считает). */
function ConnRow({ c, who, rules }: { c: Conn; who: string | null; rules: string[] }) {
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
            <div className="flex flex-wrap gap-x-2 text-[11px] text-subtle">
                {rules.length > 0 && (
                    <span>{rules.length === 1 ? S.observe.poPravilu(rules[0]) : S.observe.poOdnomuIzPravil(rules.join(', '))}</span>
                )}
                <span>{c.proto.toUpperCase()}</span>
                {who && <span>{c.src}</span>}
                {tcp && <span>{tcp}</span>}
                {(down !== undefined || up !== undefined) && (
                    <span className="tabular-nums">↓ {human(down ?? 0)} ↑ {human(up ?? 0)}</span>
                )}
            </div>
        </li>
    )
}

/** Соединения, которые ядро повело в свои выходы. */
export function ConnsCard() {
    const ask = useCallback(() => rpc.conns(), [])
    const { data, failed, busy, pull } = usePoll(ask)
    const [q, setQ] = useState('')
    const { spec } = usePending()
    /* Имена устройств из аренд DHCP: «iPhone» читается, 192.168.1.23 — нет. Один раз на экран:
     * аренды меняются реже, чем человек смотрит на соединения. */
    const [leases, setLeases] = useState<Record<string, string>>({})
    useEffect(() => {
        rpc.leases()
            .then((r) => setLeases(Object.fromEntries((r.leases || []).filter((l) => l.name && l.name !== '*').map((l) => [l.ip, l.name]))))
            .catch(() => {})
    }, [])

    const conns = useMemo(() => data?.conns || [], [data])
    const shown = useMemo(
        () =>
            conns.filter((c) =>
                matches(q, [c.src, c.dst, c.dport, c.proto, c.out, leases[c.src], ...rulesOf(spec, c.out)]),
            ),
        [conns, q, leases, spec],
    )
    const bad = failed || !!data?.error

    return (
        <Block>
            <CardHead
                title={S.observe.soedineniya}
                meta={data && !bad ? (data.truncated ? S.observe.pokazanyIz(data.shown ?? conns.length, data.total ?? conns.length) : conns.length) : undefined}
                action={<Refresh busy={busy} onClick={pull} label={S.observe.obnovitSoedineniya} />}
            />
            {data === null && !failed ? (
                <p className="py-4 text-center text-sm text-muted-foreground">{S.observe.zagruzka}</p>
            ) : bad ? (
                <p className="text-sm text-muted-foreground">{S.observe.soedineniyaNedostupny}</p>
            ) : conns.length === 0 ? (
                <p className="text-sm text-muted-foreground">{S.observe.soedineniyNet}</p>
            ) : (
                <div className="space-y-2">
                    <SearchBox value={q} onChange={setQ} placeholder={S.observe.poiskSoedineniy} />
                    {shown.length === 0 ? (
                        <p className="py-3 text-center text-xs text-muted-foreground">{S.observe.nichegoNeNaydeno}</p>
                    ) : (
                        <ul className="max-h-96 divide-y divide-border overflow-auto pr-1">
                            {shown.map((c, i) => (
                                <ConnRow
                                    key={`${c.proto}-${c.src}-${c.sport ?? ''}-${c.dst}-${c.dport ?? ''}-${i}`}
                                    c={c}
                                    who={leases[c.src] || null}
                                    rules={rulesOf(spec, c.out)}
                                />
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </Block>
    )
}

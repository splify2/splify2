import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, Gauge, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/layout'
import Flag from '@/components/Flag'
import { NodePill, useSubProbe } from '@/components/board/NodePills'
import { rpc } from '@/lib/rpc'
import { subsRemember, subsRemembered } from '@/lib/subs'
import { plainName } from '@/lib/nodename'
import { devList, isPart, isTunnelKind, type Output, type Spec } from '@/lib/model'
import { type Live } from '@/lib/live'
import { useSubNodes, type SubNode } from '@/lib/subnodes'
import { applyTarget, EMPTY_TARGET, sharedWith, subPickKey, targetOf, type Mode, type SubPick, type Target } from '@/lib/ruleout'
import { S } from '@/copy'

/** «Куда» правила в приложении для компьютера: блок во всю ширину под остальными, в нём друг под
 *  другом подписки, WARP и свои туннели (владелец: «отдельно подписки, отдельно WARP, отдельно WG
 *  друг под другом»). У подписок и своих туннелей в начале блока — режим, дальше пилюли; у WARP
 *  пилюля — конфигурация целиком. Длинный список сворачивается явно. Набор пишется в спеку сразу
 *  (lib/ruleout.ts): одинаковые наборы у правил — один общий выход, правка общего разводит. */

type Sub = { name: string; title?: string; path: string; present: boolean }

/** Вид устройства словом. */
const DEV_KIND: Record<string, string> = { wireguard: 'WireGuard', amneziawg: 'AmneziaWG', awg: 'AmneziaWG', openvpn: 'OpenVPN', tun: 'TUN', xsteer: 'xsteer' }

/** Сколько пилюль подписки видно до «Показать все» (выбранные видны всегда). */
const FOLD = 11

const MODES: { value: Mode; label: string }[] = [
    { value: 'latency', label: S.ruleTarget.samyyBystryy },
    { value: 'order', label: S.ruleTarget.pervyyZhivoy },
    { value: 'manual', label: S.ruleTarget.vruchnuyu },
    { value: 'balance', label: S.ruleTarget.razdacha },
]

export default function RuleTarget({ spec, index, live, onSpec }: {
    spec: Spec
    index: number
    live: Live
    onSpec: (next: Spec) => void
}) {
    const ch = spec.channels[index]
    const parsed = useMemo(() => targetOf(spec, ch.out), [spec, ch.out])
    const [t, setT] = useState<Target>(() => parsed ?? structuredClone(EMPTY_TARGET))
    /* Выход сменился не отсюда (отмена, перечитывание после применения) — выбор по нему. */
    useEffect(() => { if (parsed) setT(parsed) }, [parsed])

    const [subs, setSubs] = useState<Sub[]>(() => subsRemembered() ?? [])
    const [devices, setDevices] = useState<{ name: string; up: boolean; kind: string; owner?: string }[]>([])
    useEffect(() => {
        rpc.subList().then((r) => { setSubs(r.subs || []); subsRemember(r.subs) }).catch(() => {})
        rpc.devices().then((d) => setDevices(d.devices || [])).catch(() => setDevices([]))
    }, [])

    function put(next: Target) {
        setT(next)
        const s = applyTarget(spec, index, next)
        if (s !== spec) onSpec(s)
    }

    const outs = spec.outputs
    const warps = Object.entries(outs).filter(([, o]) => o.kind === ('warp' as Output['kind']))
    /* Свои туннели: устройства роутера, кроме заведённых ядром и служебных частей, и выходы
     * своих туннелей ядра (awg, xsteer). */
    const steerDevs = new Set(Object.entries(outs).filter(([, o]) => isPart(o) || isTunnelKind(o.kind)).flatMap(([n, o]) => [n, ...devList(o)]))
    /* Туннели WARP — «<выход>.<n>» и устройство MASQUE: их ведёт модуль, а не человек. */
    const warpDev = (d: string) => warps.some(([n]) => d.startsWith(`${n}.`) || d.startsWith(`${n}-`))
    const own: { key: string; name: string; foot: string; up?: boolean }[] = [
        ...devices.filter((d) => d.owner !== 'steer' && !steerDevs.has(d.name) && !warpDev(d.name))
            .map((d) => ({ key: `dev:${d.name}`, name: d.name, foot: DEV_KIND[d.kind] || d.kind || S.ruleTarget.tunnel, up: d.up })),
        ...Object.entries(outs).filter(([, o]) => o.kind === 'awg' || o.kind === 'xsteer')
            .map(([n, o]) => ({ key: `out:${n}`, name: n, foot: o.kind === 'awg' ? 'AmneziaWG' : 'xsteer', up: live.status?.outputs?.[n]?.up })),
    ]

    const shared = sharedWith(spec, index)
    const empty = !t.direct && !t.subs.picks.length && !t.warp.length && !t.own.picks.length
    const state = t.direct
        ? S.ruleTarget.napryamuyu
        : empty
          ? S.ruleTarget.nichegoNeVybrano
          : shared.length ? S.ruleTarget.obschiySPravilom(shared.join(', ')) : S.ruleTarget.svoyVyhod

    /** Пилюля подписки: отметить или снять. «Вручную» — один узел: отметка заменяет прежний. */
    function toggleSub(p: SubPick) {
        const k = subPickKey(p)
        const on = t.subs.picks.some((x) => subPickKey(x) === k)
        let picks: SubPick[]
        if (on) picks = t.subs.picks.filter((x) => subPickKey(x) !== k)
        else if (t.subs.mode === 'manual') picks = [p]
        /* «Авто» и узлы той же подписки и протокола вместе не значат ничего: одно заменяет другое. */
        else if (p.idx === undefined) picks = [...t.subs.picks.filter((x) => !(x.sub === p.sub && x.proto === p.proto)), p]
        else picks = [...t.subs.picks.filter((x) => !(x.sub === p.sub && x.proto === p.proto && x.idx === undefined)), p]
        put({ ...t, direct: false, subs: { ...t.subs, picks } })
    }

    /** «Авто» подписки — все её протоколы разом: отметить заменяет узлы, снять — убирает. */
    function toggleAuto(sub: string, protos: SubPick['proto'][], on: boolean) {
        const rest = t.subs.picks.filter((x) => !(x.sub === sub && protos.includes(x.proto)))
        const picks = on ? rest : t.subs.mode === 'manual' ? [{ sub, proto: protos[0] }] : [...rest, ...protos.map((proto) => ({ sub, proto }))]
        put({ ...t, direct: false, subs: { ...t.subs, picks } })
    }

    function toggleOwn(key: string) {
        const on = t.own.picks.includes(key)
        const picks = on ? t.own.picks.filter((x) => x !== key) : t.own.mode === 'manual' ? [key] : [...t.own.picks, key]
        put({ ...t, direct: false, own: { ...t.own, picks } })
    }

    function toggleWarp(name: string) {
        const warp = t.warp.includes(name) ? t.warp.filter((x) => x !== name) : [...t.warp, name]
        put({ ...t, direct: false, warp })
    }

    const setMode = (sec: 'subs' | 'own', mode: Mode) => {
        const cur = t[sec]
        const picks = (mode === 'manual' ? cur.picks.slice(0, 1) : cur.picks) as never
        put({ ...t, [sec]: { mode, picks } })
    }

    return (
        <section className="sp-board-group an-glass space-y-3 rounded-2xl border p-3">
            <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-1">
                <div className="min-w-0">
                    <h2 className="sp-sub">{S.ruleTarget.kuda}</h2>
                    <div className={`text-xs ${empty ? 'text-warning-fg' : 'text-muted-foreground'}`}>{state}</div>
                </div>
                <div className="w-64 max-w-full">
                    <Segmented
                        label={S.ruleTarget.kuda}
                        value={t.direct ? 'direct' : 'tunnel'}
                        onChange={(v) => {
                            if (v === 'direct') put({ ...t, direct: true })
                            else setT({ ...t, direct: false })
                        }}
                        items={[
                            { value: 'tunnel', label: S.ruleTarget.cherezTunnel },
                            { value: 'direct', label: S.ruleTarget.napryamuyu },
                        ]}
                    />
                </div>
            </div>
            {!parsed && !t.direct && ch.out && outs[ch.out] && (
                <p className="px-1 text-xs text-muted-foreground">{S.ruleTarget.seychasVyhod(ch.out)}</p>
            )}

            {!t.direct && (
                <>
                    {subs.length > 0 && (
                        <Part title={S.ruleTarget.podpiski} mode={t.subs.mode} onMode={(m) => setMode('subs', m)}>
                            {subs.map((s) => (
                                <SubPills
                                    key={s.path}
                                    sub={s}
                                    picks={t.subs.picks}
                                    rank={t.subs.mode === 'order' && t.subs.picks.length > 1}
                                    live={live}
                                    onToggle={toggleSub}
                                    onAuto={(protos, on) => toggleAuto(s.path, protos, on)}
                                />
                            ))}
                        </Part>
                    )}

                    {warps.length > 0 && (
                        <Part title={S.ruleTarget.warp}>
                            <Grid>
                                {warps.map(([n, o]) => (
                                    <WarpPill key={n} name={n} o={o} live={live} chosen={t.warp.includes(n)} onClick={() => toggleWarp(n)} />
                                ))}
                            </Grid>
                        </Part>
                    )}

                    {own.length > 0 && (
                        <Part title={S.ruleTarget.svoiTunneli} mode={t.own.mode} onMode={(m) => setMode('own', m)}>
                            <Grid>
                                {own.map((d) => {
                                    const at = t.own.picks.indexOf(d.key)
                                    return (
                                        <Pill
                                            key={d.key}
                                            title={d.name}
                                            foot={d.foot}
                                            chosen={at >= 0}
                                            rank={t.own.mode === 'order' && t.own.picks.length > 1 && at >= 0 ? at + 1 : undefined}
                                            on={d.up}
                                            onClick={() => toggleOwn(d.key)}
                                        />
                                    )
                                })}
                            </Grid>
                        </Part>
                    )}
                </>
            )}
        </section>
    )
}

/** Блок «Куда»: подписки, WARP или свои туннели. Режим — в начале блока. */
function Part({ title, mode, onMode, children }: { title: string; mode?: Mode; onMode?: (m: Mode) => void; children: ReactNode }) {
    return (
        <div className="sp-board-tile an-glass space-y-3 rounded-2xl border p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[13px] font-semibold">{title}</div>
                {mode && onMode && (
                    <div className="w-full sm:w-[560px]">
                        <Segmented label={title} value={mode} onChange={onMode} items={MODES} />
                    </div>
                )}
            </div>
            {children}
        </div>
    )
}

function Grid({ children }: { children: ReactNode }) {
    return <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">{children}</div>
}

/** Пилюля без замера — своё устройство или WARP. */
function Pill({ title, foot, chosen, rank, on, onClick }: {
    title: string
    foot: string
    chosen: boolean
    rank?: number
    on?: boolean
    onClick: () => void
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={chosen}
            className={[
                'an-glass relative flex min-w-0 flex-col gap-1 rounded-xl border px-3 py-2 text-left transition-[border-color,box-shadow] duration-200 hover:border-primary/50',
                chosen ? 'border-primary/80 bg-primary/10 shadow-[0_0_0_2px_color-mix(in_srgb,var(--sp-primary)_25%,transparent)]' : '',
            ].join(' ')}
        >
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
                <span className="truncate">{title}</span>
                {on !== undefined && <span className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${on ? 'bg-success' : 'bg-destructive'}`} aria-hidden="true" />}
            </span>
            <span className="truncate text-[11.5px] text-muted-foreground">{foot}</span>
            {rank !== undefined && <Rank n={rank} />}
        </button>
    )
}

function Rank({ n }: { n: number }) {
    return (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
            {n}
        </span>
    )
}

function WarpPill({ name, o, live, chosen, onClick }: { name: string; o: Output; live: Live; chosen: boolean; onClick: () => void }) {
    const x = (o.extra || {}) as { count?: number; transport?: string }
    const st = live.status?.outputs?.[name]
    const w = (st?.group as { warp?: { members?: { ok?: boolean }[] } } | undefined)?.warp
    const total = w?.members?.length ?? x.count ?? 0
    const ok = w?.members?.filter((m) => m.ok).length
    const foot = [x.transport === 'masque' ? 'MASQUE' : 'AmneziaWG', total ? S.ruleTarget.izRabotayut(ok ?? total, total) : ''].filter(Boolean).join(' · ')
    return <Pill title={name} foot={foot} chosen={chosen} on={st ? !!st.up : undefined} onClick={onClick} />
}

/** Пилюли одной подписки: «Авто» и по пилюле на конфигурацию, с проверкой задержки. */
function SubPills({ sub, picks, rank, live, onToggle, onAuto }: {
    sub: Sub
    picks: SubPick[]
    rank: boolean
    live: Live
    onToggle: (p: SubPick) => void
    onAuto: (protos: SubPick['proto'][], on: boolean) => void
}) {
    const nodes = useSubNodes(sub.path, sub.present)
    const { lat, probe, probing } = useSubProbe(sub.path)
    const [open, setOpen] = useState(false)
    const keys = picks.map(subPickKey)
    const pickOf = (n: SubNode): SubPick => ({ sub: sub.path, proto: n.proto, idx: n.index })
    const protos = [...new Set((nodes || []).map((n) => n.proto))]
    const autoOn = protos.length > 0 && protos.every((p) => keys.includes(subPickKey({ sub: sub.path, proto: p })))

    /* Узлы, которые ядро держит сейчас. */
    const working = new Set<string>()
    for (const st of Object.values(live.status?.outputs || {})) {
        for (const a of st.vless?.active || []) working.add(plainName(a.name))
        if (st.vless?.node) working.add(plainName(st.vless.node))
        if (st.proxy?.node) working.add(plainName(st.proxy.node))
        if (st.hysteria2?.node) working.add(plainName(st.hysteria2.node))
    }

    const list = nodes || []
    const shown = open ? list : list.filter((n, i) => i < FOLD || keys.includes(subPickKey(pickOf(n))))

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 truncate text-xs text-muted-foreground">
                    {sub.title || sub.name}{nodes ? ` · ${nodes.length}` : ''}
                </div>
                <Button variant="ghost" size="sm" onClick={() => nodes && probe(nodes)} disabled={!nodes?.length || probing}>
                    {probing ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Gauge aria-hidden="true" />}
                    {S.subsBoard.proveritZaderzhku}
                </Button>
            </div>
            {nodes === null && sub.present && <p className="text-xs text-muted-foreground">{S.vlessScreen.zagruzka}</p>}
            {!sub.present && <p className="text-xs text-muted-foreground">{S.vlessScreen.neSkachana}</p>}
            {list.length > 0 && (
                <Grid>
                    <button
                        type="button"
                        onClick={() => onAuto(protos, autoOn)}
                        aria-pressed={autoOn}
                        className={[
                            'an-glass flex min-w-0 flex-col gap-1 rounded-xl border px-3 py-2 text-left transition-[border-color,box-shadow] duration-200 hover:border-primary/50',
                            autoOn ? 'border-primary/80 bg-primary/10 shadow-[0_0_0_2px_color-mix(in_srgb,var(--sp-primary)_25%,transparent)]' : '',
                        ].join(' ')}
                    >
                        <span className="flex items-center gap-1.5 text-[13px] font-semibold"><Flag cc={undefined} />{S.ruleTarget.avto}</span>
                        <span className="truncate text-[11.5px] text-muted-foreground">{S.ruleTarget.lyubayaRabochaya}</span>
                    </button>
                    {shown.map((n) => {
                        const at = keys.indexOf(subPickKey(pickOf(n)))
                        return (
                            <div key={n.key} className="relative">
                                <NodePill
                                    node={n}
                                    lat={lat[n.key]}
                                    chosen={at >= 0}
                                    on={working.has(n.name)}
                                    onClick={() => onToggle(pickOf(n))}
                                />
                                {rank && at >= 0 && <Rank n={at + 1} />}
                            </div>
                        )
                    })}
                </Grid>
            )}
            {list.length > FOLD && (
                <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 bg-transparent px-1 text-xs text-primary">
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                    {open ? S.subsBoard.svernut : S.subsBoard.pokazatVse(list.length)}
                </button>
            )}
        </div>
    )
}

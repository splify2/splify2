import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, Cloud, Link2, LoaderCircle, Network, Search } from 'lucide-react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { inputCls } from '@/components/formbits'
import ListPills from '@/components/board/ListPills'
import { rpc } from '@/lib/rpc'
import { notify } from '@/lib/notify'
import { pending, usePending } from '@/lib/pending'
import { customServices, toAllowDomainsServices, toCatalog, wantedFirst, type Channel, type ServiceEntry, type Spec } from '@/lib/model'
import { pathFor, srsProbe } from '@/lib/rulefiles'
import { applyTarget, EMPTY_TARGET, type Target } from '@/lib/ruleout'
import { subProtos } from '@/lib/subnodes'
import { isSubSource } from '@/lib/validate'
import { PRESETS } from '@/lib/dnspresets'
import { S } from '@/copy'
import { PluginGuard, SlotView } from '@/plugins/boundary'
import { registry, useRegistry, type Reg } from '@/plugins/registry'
import type { Slots } from '@/plugins/api'

/** Мастер первоначальной настройки splify2 (владелец): через что пустить трафик, что пустить, каким
 *  DNS спрашивать — и первое правило готово. Показывается на главной, пока на роутере нет ни одного
 *  правила и мастер не пройден (отметка — в памяти интерфейса на роутере, `ui_set`). Пишет спеку
 *  тем же путём, что и правка правила: выход — lib/ruleout, применение — общее (pending). */

/** Ветка «через что»: `sub`, `own` или `<владелец>:<id>` ветки плагина (слот `setupVia`, например WARP). */
type Via = string
type ViaSlot = Parameters<Slots['setupVia']>[0]
const plugKey = (r: Reg<ViaSlot>) => `${r.owner}:${r.id}`

/** Готовые серверы DNS, которые мастер предлагает сразу; остальные — на вкладке DNS. */
const DNS_PICK = ['cloudflare', 'google', 'quad9-doh', 'adguard-doh', 'yandex', 'comss']
const PRESET_TITLE = new Map(S.dns.presetTitles)

/** Отметка «мастер пройден» в памяти интерфейса на роутере. */
export async function setupDone(): Promise<boolean> {
    try {
        const r = await rpc.uiGet()
        return !!(r.state && (JSON.parse(r.state) as { setup?: number }).setup)
    } catch {
        return true
    }
}
export async function markSetupDone() {
    let st: Record<string, unknown> = {}
    try { st = JSON.parse((await rpc.uiGet()).state || '{}') } catch { /* пусто */ }
    await rpc.uiSet(JSON.stringify({ ...st, setup: 1 })).catch(() => undefined)
}

export default function SetupWizard({ onDone, railHost }: {
    onDone: () => void
    /** Колонка рельса (приложение для ПК): пока идёт настройка, в ней — шаги мастера. */
    railHost?: Element | null
}) {
    const { spec } = usePending()
    const [step, setStep] = useState(0)
    const [via, setVia] = useState<Via | null>(null)
    const [url, setUrl] = useState('')
    const [dev, setDev] = useState('')
    const [picked, setPicked] = useState<string[]>([])
    const [q, setQ] = useState('')
    const [dns, setDns] = useState('')
    const [busy, setBusy] = useState(false)
    /** Подписка, уже скачанная на шаге 1: имя и путь файла. */
    const [sub, setSub] = useState<{ name: string; path: string } | null>(null)

    const [services, setServices] = useState<ServiceEntry[]>([])
    const [local, setLocal] = useState<Record<string, { count: number; mtime: number }>>({})
    const [devices, setDevices] = useState<{ name: string; up: boolean; kind: string; owner?: string }[]>([])
    /* Ветки плагинов: доступна ли каждая — спрашивается у плагина (строка — почему нет). */
    useRegistry()
    const plugVias = registry.list<ViaSlot>('setupVia')
    const [viaOk, setViaOk] = useState<Record<string, true | string>>({})
    /** Выходы, которые выбранная ветка плагина завела и отдала мастеру (`done`). */
    const [plugOuts, setPlugOuts] = useState<string[]>([])
    useEffect(() => {
        let alive = true
        for (const r of plugVias)
            r.value.available().then((v) => { if (alive) setViaOk((m) => ({ ...m, [plugKey(r)]: v })) }, () => { if (alive) setViaOk((m) => ({ ...m, [plugKey(r)]: true })) })
        return () => { alive = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [plugVias.map(plugKey).join()])
    useEffect(() => {
        rpc.manifest().then((m) => setServices(wantedFirst(toCatalog(m).services)))
            .catch(() => rpc.allowDomains().then((a) => setServices(wantedFirst(toAllowDomainsServices(a)))).catch(() => setServices([])))
        rpc.localLists().then((d) => setLocal(d.files || {})).catch(() => setLocal({}))
        rpc.devices().then((d) => setDevices((d.devices || []).filter((x) => x.owner !== 'steer'))).catch(() => setDevices([]))
    }, [])
    const all = useMemo(() => [...services, ...customServices(local)], [services, local])
    const shown = all.filter((sv) => {
        const s = q.trim().toLowerCase()
        return !s || sv.name.toLowerCase().includes(s) || sv.id.toLowerCase().includes(s)
    })

    async function skip() {
        await markSetupDone()
        try { sessionStorage.removeItem('desk:setup') } catch { /* нет памяти — нечего снимать */ }
        onDone()
    }

    /** Шаг 1 → 2: подписку скачать сейчас — ошибку ссылки человек видит здесь, а не в конце. */
    async function next1() {
        if (via !== 'sub') { setStep(2); return }
        const v = url.trim()
        if (!isSubSource(v)) { notify(S.vlessScreen.nuzhnaSsylkaPodpiskiHttp, 'warning'); return }
        setBusy(true)
        try {
            const list = await rpc.subList().catch(() => ({ subs: [] as { name: string; path: string }[] }))
            const taken = new Set(list.subs.map((x) => x.name))
            let name = 'sub1'
            for (let k = 2; taken.has(name); k++) name = `sub${k}`
            const r = await rpc.subSet(v, name, '')
            if (!r.ok) { notify(r.error || S.vlessScreen.podpiskaNeSohranilas, 'error'); return }
            if (r.warn) notify(r.warn, 'warning')
            const again = await rpc.subList()
            const s = again.subs.find((x) => x.name === name)
            if (!s) { notify(S.vlessScreen.podpiskaNeSohranilas, 'error'); return }
            setSub({ name, path: s.path })
            setStep(2)
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy(false)
        }
    }

    async function finish() {
        if (!spec) return
        setBusy(true)
        try {
            let sp: Spec = structuredClone(spec)
            /* Куда. */
            const t: Target = structuredClone(EMPTY_TARGET)
            if (via === 'sub' && sub) {
                const protos = await subProtos(sub.path)
                t.subs = { mode: 'order', picks: (protos.length ? protos : ['vless' as const]).map((proto) => ({ sub: sub.path, proto })) }
            } else if (plugVias.some((r) => plugKey(r) === via) && plugOuts.length) {
                /* Выходы плагин уже завёл в черновике панели (spec): правило ведёт в них. */
                t.warp = plugOuts
            } else if (via === 'own' && dev) {
                t.own = { mode: 'manual', picks: [`dev:${dev}`] }
            }
            /* Что: сервисы — списками, набор каталога — как скажет роутер (файлом или списками). */
            const chosen = all.filter((sv) => picked.includes(sv.id))
            const ch: Channel = { name: chosen.length === 1 ? chosen[0].name : S.setup.imyaPravila, out: 'direct', match: {} }
            const pref = new Set<string>(), doms = new Set<string>(), srs = new Set<string>()
            for (const sv of chosen) {
                const r = sv.srs ? await srsProbe(sv, local) : { asked: false }
                if ('set' in r && r.set) { srs.add(r.set); continue }
                for (const f of sv.prefixes) pref.add(pathFor(f))
                for (const f of sv.domains) doms.add(pathFor(f))
            }
            ch.match = {
                prefixes_files: pref.size ? [...pref] : undefined,
                domains_files: doms.size ? [...doms] : undefined,
                srs_files: srs.size ? [...srs] : undefined,
                mode: doms.size || srs.size ? 'fakeip' : undefined,
            }
            sp = { ...sp, channels: [...sp.channels, ch] }
            sp = applyTarget(sp, sp.channels.length - 1, t)
            /* DNS: выбранный сервер — для всех запросов (как карточка на вкладке DNS). */
            const p = PRESETS.find((x) => x.name === dns)
            if (p) {
                const d = { ...(sp.dns || {}), upstreams: { ...(sp.dns?.upstreams || {}), [p.name]: { ...p.up } }, upstream: p.name }
                d.other = p.name
                sp = { ...sp, dns: d }
            }
            pending.edit(sp)
            await markSetupDone()
            try { sessionStorage.removeItem('desk:setup') } catch { /* нет памяти — нечего снимать */ }
            onDone()
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy(false)
        }
    }

    const canNext = step === 1 ? (via === 'sub' ? !!url.trim() : via === 'own' ? !!dev : plugOuts.length > 0)
        : step === 2 ? picked.length > 0 : true
    const titles = [S.setup.zagolovok, S.setup.cherezChto, S.setup.chtoPustit, S.setup.kakSprashivat, S.setup.vseGotovo]

    const steps = [S.setup.cherezChto, S.setup.chtoPustit, S.setup.kakSprashivat, S.setup.vseGotovo]
    const rail = railHost && createPortal(
        /* Колонка — той же ширины и того же стекла, что рельс (Rail.tsx): иначе раздел съезжал влево. */
        <aside className="an-glass-chrome flex w-[236px] shrink-0 self-stretch flex-col gap-1 border-r p-4" aria-label={S.setup.zagolovok}>
            <div className="px-1.5 pb-3 pt-1 text-sm font-semibold">{S.setup.zagolovok}</div>
            {steps.map((t, i) => {
                const n = i + 1
                const cur = step === n
                const done = step > n
                return (
                    <div key={t} aria-current={cur ? 'step' : undefined}
                        className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm ${cur ? 'bg-primary/15 font-semibold text-primary' : done ? 'text-foreground' : 'text-muted-foreground'}`}>
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${cur ? 'bg-primary text-primary-foreground' : done ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'}`}>
                            {done ? <Check className="h-3 w-3" aria-hidden="true" /> : n}
                        </span>
                        {t}
                    </div>
                )
            })}
        </aside>,
        railHost,
    )

    /* Карточка — по центру окна: и по ширине, и по высоте видимой части раздела. */
    return (
        <div className="flex min-h-[calc(100vh-150px)] items-center justify-center">
        <div className="w-full max-w-3xl">
            {rail}
            <section className="sp-board-group an-glass space-y-4 rounded-2xl border p-5">
                <div className="flex items-center gap-3">
                    {step > 0 && (
                        <button type="button" onClick={() => setStep(step - 1)} disabled={busy} aria-label={S.layout.nazad}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground">
                            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        </button>
                    )}
                    <div className="min-w-0 flex-1">
                        {step > 0 && step < 4 && <div className="text-xs text-muted-foreground">{S.setup.shag(step, 3)}</div>}
                        <h1 className="sp-title">{titles[step]}</h1>
                    </div>
                    {step > 0 && step < 4 && (
                        <Button variant="ghost" size="sm" onClick={() => void skip()} disabled={busy}>{S.setup.propustit}</Button>
                    )}
                </div>

                <div key={step} className="sp-wiz-step space-y-3">
                    {step === 0 && <p className="text-sm text-muted-foreground">{S.setup.vvedenie}</p>}

                    {step === 1 && (
                        <>
                            <div className="grid gap-3 sm:grid-cols-3">
                                <Choice on={via === 'sub'} icon={<Link2 className="h-5 w-5" />} title={S.setup.podpiska} note={S.setup.podpiskaNote} onClick={() => setVia('sub')} />
                                {plugVias.map((r) => {
                                    const ok = viaOk[plugKey(r)]
                                    return (
                                        <Choice key={plugKey(r)} on={via === plugKey(r)} icon={<Cloud className="h-5 w-5" />} title={r.value.label}
                                            note={typeof ok === 'string' ? ok : r.value.caption ?? ''} off={typeof ok === 'string'}
                                            onClick={() => { setPlugOuts([]); setVia(plugKey(r)) }} />
                                    )
                                })}
                                <Choice on={via === 'own'} icon={<Network className="h-5 w-5" />} title={S.setup.svoyTunnel} note={devices.length ? S.setup.svoyNote : S.setup.svoyNet} off={!devices.length} onClick={() => setVia('own')} />
                            </div>
                            {via === 'sub' && (
                                <textarea
                                    className={inputCls + ' h-20 w-full resize-y py-2 font-mono text-xs'}
                                    value={url}
                                    onChange={(e) => setUrl(e.currentTarget.value)}
                                    placeholder={S.subsBoard.ssylkaPlaceholder}
                                    spellCheck={false}
                                    autoFocus
                                />
                            )}
                            {plugVias.filter((r) => plugKey(r) === via).map((r) => (
                                <PluginGuard key={plugKey(r)} name={r.owner}>
                                    <SlotView render={() => r.value.render(setPlugOuts)} />
                                </PluginGuard>
                            ))}
                            {via === 'own' && devices.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {devices.map((d) => (
                                        <button key={d.name} type="button" onClick={() => setDev(d.name)}
                                            className={`rounded-xl border px-3 py-1.5 text-sm ${dev === d.name ? 'border-primary/80 bg-primary/10 text-foreground' : 'bg-transparent text-muted-foreground hover:border-primary/50'}`}>
                                            {d.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {step === 2 && (
                        <>
                            <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3">
                                <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <input
                                    value={q}
                                    onChange={(e) => setQ(e.currentTarget.value)}
                                    placeholder={S.ruleEditor.poiskPoKataloguServisy}
                                    className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
                                />
                                {picked.length > 0 && <span className="shrink-0 text-xs text-muted-foreground">{S.ruleEditor.servisov(picked.length)}</span>}
                            </div>
                            <div className="max-h-[52vh] overflow-y-auto pr-1">
                                <ListPills
                                    shown={shown}
                                    chosen={picked}
                                    probing={new Set()}
                                    searching={!!q.trim()}
                                    onPick={(sv) => setPicked((p) => (p.includes(sv.id) ? p.filter((x) => x !== sv.id) : [...p, sv.id]))}
                                />
                            </div>
                        </>
                    )}

                    {step === 3 && (
                        <div className="grid gap-3 sm:grid-cols-3">
                            <Choice on={!dns} title={S.dns.dnsProvaydera} note={S.dns.kakNaRoutere} onClick={() => setDns('')} />
                            {DNS_PICK.map((n) => PRESETS.find((p) => p.name === n)).filter(Boolean).map((p) => (
                                <Choice key={p!.name} on={dns === p!.name} title={PRESET_TITLE.get(p!.name) ?? p!.name} note={p!.up.url.replace(/^[a-z0-9]+:\/\//i, '').split('/')[0]} onClick={() => setDns(p!.name)} />
                            ))}
                        </div>
                    )}

                    {step === 4 && (
                        <div className="space-y-2 text-sm">
                            <Row k={S.setup.cherezChto} v={via === 'sub' ? S.setup.podpiska : via === 'own' ? dev : plugVias.find((r) => plugKey(r) === via)?.value.label ?? ''} />
                            <Row k={S.setup.chtoPustit} v={all.filter((sv) => picked.includes(sv.id)).map((sv) => sv.name).join(', ')} />
                            <Row k="DNS" v={dns ? PRESET_TITLE.get(dns) ?? dns : S.dns.dnsProvaydera} />
                            <p className="pt-1 text-xs text-muted-foreground">{S.setup.potomMozhno}</p>
                        </div>
                    )}
                </div>

                {/* Приветствие: две крупные кнопки под текстом — «Начать» слева, «Пропустить» справа. */}
                {step === 0 && (
                    <div className="grid grid-cols-2 gap-3">
                        <Button size="lg" className="h-12 text-base" onClick={() => setStep(1)}>{S.setup.nachat}</Button>
                        <Button size="lg" variant="outline" className="h-12 text-base" onClick={() => void skip()} disabled={busy}>{S.setup.propustit}</Button>
                    </div>
                )}
                {/* Кнопка шага — по центру. */}
                <div className="flex justify-center gap-2">
                    {step > 0 && step < 4 && (
                        <Button size="lg" className="min-w-40" onClick={() => (step === 1 ? void next1() : setStep(step + 1))} disabled={!canNext || busy}>
                            {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                            {S.setup.dalee}
                        </Button>
                    )}
                    {step === 4 && (
                        <Button size="lg" className="min-w-40" onClick={() => void finish()} disabled={busy}>
                            {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                            {S.setup.gotovo}
                        </Button>
                    )}
                </div>
            </section>
        </div>
        </div>
    )
}

function Choice({ on, icon, title, note, off, onClick }: { on: boolean; icon?: ReactNode; title: string; note: string; off?: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={off}
            aria-pressed={on}
            className={[
                'sp-board-tile an-glass flex min-h-[104px] min-w-0 flex-col items-start gap-1.5 rounded-2xl border p-4 text-left transition-[border-color,box-shadow] duration-200 hover:border-primary/50 disabled:opacity-50',
                on ? 'border-primary/80 bg-primary/10 shadow-[inset_0_1px_0_var(--an-glass-edge),0_0_0_2px_color-mix(in_srgb,var(--sp-primary)_25%,transparent)]' : '',
            ].join(' ')}
        >
            {icon && <span className="text-primary">{icon}</span>}
            <span className="text-sm font-semibold">{title}</span>
            <span className="text-xs text-muted-foreground">{note}</span>
        </button>
    )
}

function Row({ k, v }: { k: string; v: string }) {
    return (
        <div className="flex gap-3">
            <span className="w-28 shrink-0 text-muted-foreground">{k}</span>
            <span className="min-w-0">{v}</span>
        </div>
    )
}

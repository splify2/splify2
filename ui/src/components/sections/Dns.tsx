import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Block, CardHead, FieldRow, KV, Segmented } from '@/components/ui/layout'
import { inputCls } from '@/components/formbits'
import { notify } from '@/lib/notify'
import { pending } from '@/lib/pending'
import { useSpecCopy } from '@/lib/speccopy'
import { rpc, type DnsLog } from '@/lib/rpc'
import { isPart, type DomainMode, type DnsSpec, type Spec, type Upstream, type UpstreamGroup } from '@/lib/model'
import { type Live } from '@/lib/live'
import { dnsGroupsSupported, dnsOtherSupported } from '@/lib/engine'

import { S } from '@/copy'
/** DNS: какими серверами и через какой выход резолвер движка спрашивает имена под правилами.
 *
 *  Резолвер движка отвечает только на имена, которые попали под правило; остальные спрашивает
 *  системный DNS роутера, как раньше. Здесь выбирается, КУДА уходят вопросы о тех именах: DoH,
 *  DoT, DoQ или обычный DNS, напрямую или через выход. Серверы, которые уже настроены на самом
 *  роутере (dnsmasq, https-dns-proxy), этот раздел не трогает. */

const NAME_RE = /^[A-Za-z0-9_.-]{1,31}$/

/* Готовые серверы. Каждый проверен 2026-10-03: DoH — запросом с роутера в России на каждый адрес
 * начальной загрузки (ips); DoT — запросом и рукопожатием TLS на 853 с того же роутера; DoQ —
 * запросом (с роутера QUIC проверить нечем). Недоступное из России не включено: AdGuard без
 * фильтров, Mullvad, DoT у malw.link, DoQ у остальных. «Geo» — сервер помогает с геоблоком: на
 * закрытые для России сервисы (chatgpt.com, gemini.google.com, claude.ai) отвечает адресом своего
 * прокси, а не настоящим. */
const PRESET_TITLE = new Map(S.dns.presetTitles)

const PRESETS: { name: string; up: Upstream }[] = [
    { name: 'cloudflare', up: { url: 'https://cloudflare-dns.com/dns-query', ips: ['1.1.1.1', '1.0.0.1'] } },
    { name: 'cloudflare-dot', up: { url: 'tls://cloudflare-dns.com', ips: ['1.1.1.1', '1.0.0.1'] } },
    { name: 'cloudflare-sec', up: { url: 'https://security.cloudflare-dns.com/dns-query', ips: ['1.1.1.2', '1.0.0.2'] } },
    { name: 'cloudflare-fam', up: { url: 'https://family.cloudflare-dns.com/dns-query', ips: ['1.1.1.3', '1.0.0.3'] } },
    { name: 'google', up: { url: 'https://dns.google/dns-query', ips: ['8.8.8.8', '8.8.4.4'] } },
    { name: 'google-dot', up: { url: 'tls://dns.google', ips: ['8.8.8.8', '8.8.4.4'] } },
    { name: 'quad9-doh', up: { url: 'https://dns.quad9.net/dns-query', ips: ['9.9.9.9', '149.112.112.112'] } },
    { name: 'quad9', up: { url: 'tls://dns.quad9.net', ips: ['9.9.9.9', '149.112.112.112'] } },
    { name: 'quad9-doq', up: { url: 'quic://dns.quad9.net', ips: ['9.9.9.9', '149.112.112.112'] } },
    { name: 'adguard-doh', up: { url: 'https://dns.adguard-dns.com/dns-query', ips: ['94.140.14.14', '94.140.15.15'] } },
    { name: 'adguard-dot', up: { url: 'tls://dns.adguard-dns.com', ips: ['94.140.14.14', '94.140.15.15'] } },
    { name: 'adguard', up: { url: 'quic://dns.adguard-dns.com', ips: ['94.140.14.14', '94.140.15.15'] } },
    { name: 'adguard-fam', up: { url: 'https://family.adguard-dns.com/dns-query', ips: ['94.140.14.15', '94.140.15.16'] } },
    { name: 'adguard-fam-doq', up: { url: 'quic://family.adguard-dns.com', ips: ['94.140.14.15', '94.140.15.16'] } },
    { name: 'yandex', up: { url: 'https://common.dot.dns.yandex.net/dns-query', ips: ['77.88.8.8', '77.88.8.1'] } },
    { name: 'yandex-dot', up: { url: 'tls://common.dot.dns.yandex.net', ips: ['77.88.8.8', '77.88.8.1'] } },
    { name: 'yandex-safe', up: { url: 'https://safe.dot.dns.yandex.net/dns-query', ips: ['77.88.8.88', '77.88.8.2'] } },
    { name: 'opendns', up: { url: 'https://doh.opendns.com/dns-query', ips: ['208.67.222.222', '208.67.220.220'] } },
    { name: 'opendns-dot', up: { url: 'tls://dns.opendns.com', ips: ['208.67.222.222', '208.67.220.220'] } },
    { name: 'controld', up: { url: 'https://freedns.controld.com/p0', ips: ['76.76.2.0', '76.76.10.0'] } },
    { name: 'comss', up: { url: 'https://dns.comss.one/dns-query', ips: ['83.220.169.155', '212.109.195.93'] } },
    { name: 'comss-dot', up: { url: 'tls://dns.comss.one', ips: ['83.220.169.155', '212.109.195.93'] } },
    { name: 'comss-doq', up: { url: 'quic://dns.comss.one', ips: ['83.220.169.155', '212.109.195.93'] } },
    { name: 'xbox-dns', up: { url: 'https://xbox-dns.ru/dns-query', ips: ['111.88.96.50', '111.88.96.51'] } },
    { name: 'xbox-dns-dot', up: { url: 'tls://xbox-dns.ru', ips: ['111.88.96.50', '111.88.96.51'] } },
    { name: 'malw', up: { url: 'https://dns.malw.link/dns-query', ips: ['193.23.209.189'] } },
    { name: 'yo1nk', up: { url: 'https://dns.yo1nk.app/dns-query', ips: ['109.120.137.190'] } },
    { name: 'yo1nk-dot', up: { url: 'tls://dns.yo1nk.app', ips: ['109.120.137.190'] } },
]

const STATE_TEXT: Record<string, string> = {
    ready: S.dns.rabotaet,
    idle: S.dns.zhdetVoprosov,
    connecting: S.dns.soedinyaetsya,
    down: S.dns.neOtvechaet,
    unmarked: S.dns.vyhodNeRazmechen,
    'no-tls': S.dns.nuzhnaSborkaSTls,
}

const PROTO_TEXT: Record<string, string> = { udp: 'DNS', tcp: S.dns.dnsPoTcp, dot: 'DoT', doh: 'DoH', doq: 'DoQ' }

const listOf = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)

/** Куда уходят вопросы: DNS роутера (ключа нет), один сервер или группа из нескольких. */
type TargetKind = 'router' | 'single' | 'group'

/** Свободное имя для новой группы: base, base2, … — среди серверов и групп. */
function freeName(base: string, dns: DnsSpec): string {
    const taken = (n: string) => !!dns.upstreams?.[n] || !!dns.groups?.[n]
    let n = base
    for (let k = 2; taken(n); k++) n = `${base}${k}`
    return n
}

/** Ссылается ли на группу что-то, кроме ключа `skip` раздела dns: правила, общий сервер, other. */
function groupUsed(spec: Spec, dns: DnsSpec, name: string, skip: 'upstream' | 'other'): boolean {
    if (skip !== 'upstream' && dns.upstream === name) return true
    if (skip !== 'other' && dns.other === name) return true
    return spec.channels.some((c) => c.dns === name)
}

/** Выбор сервера для одного назначения (`dns.upstream` или `dns.other`): DNS роутера, один сервер
 *  из добавленных или несколько — группа с порядком и режимом «сразу все / по очереди». Группу
 *  назначение заводит само (имя rules/other) и убирает, когда она больше никому не нужна. */
function DnsTarget({ spec, dns, which, label, names, canGroup, log, onDns }: {
    spec: Spec
    dns: DnsSpec
    which: 'upstream' | 'other'
    label: string
    names: string[]
    canGroup: boolean
    log: DnsLog | null
    onDns: (next: DnsSpec) => void
}) {
    const cur = dns[which]
    const group: UpstreamGroup | undefined = cur ? dns.groups?.[cur] : undefined
    const kind: TargetKind = !cur ? 'router' : group ? 'group' : 'single'

    /** Назначить target; прежняя группа, если на неё больше никто не ссылается, уходит. */
    function assign(target: string | undefined, groups?: Record<string, UpstreamGroup>) {
        const next: DnsSpec = { ...dns, groups: { ...(groups ?? dns.groups ?? {}) }, [which]: target }
        if (cur && cur !== target && next.groups?.[cur] && !groupUsed(spec, next, cur, which)) delete next.groups[cur]
        if (next.groups && !Object.keys(next.groups).length) delete next.groups
        if (!target) delete next[which]
        onDns(next)
    }
    function choose(k: TargetKind) {
        if (k === kind) return
        if (k === 'router') return assign(undefined)
        if (k === 'single') return assign(group?.servers[0] ?? names[0])
        const gname = freeName(which === 'upstream' ? 'rules' : 'other', dns)
        const first = cur && !group ? cur : names[0]
        assign(gname, { ...(dns.groups || {}), [gname]: { servers: first ? [first] : [], mode: 'failover' } })
    }
    function setGroup(g: UpstreamGroup) {
        if (!cur) return
        onDns({ ...dns, groups: { ...(dns.groups || {}), [cur]: g } })
    }
    const st = cur ? log?.upstreams?.find((u) => u.name === cur) : undefined
    const items: { value: TargetKind; label: string }[] = [
        { value: 'router', label: S.dns.dnsRoutera },
        { value: 'single', label: S.dns.odinServer },
    ]
    if (canGroup || kind === 'group') items.push({ value: 'group', label: S.dns.neskolkoServerov })
    const rest = group ? names.filter((n) => !group.servers.includes(n)) : []
    const move = (i: number, j: number) => {
        if (!group || j < 0 || j >= group.servers.length) return
        const sv = [...group.servers]
        const [x] = sv.splice(i, 1)
        sv.splice(j, 0, x)
        setGroup({ ...group, servers: sv })
    }
    return (
        <div className="space-y-2 py-3">
            <div className="text-sm text-subtle">{label}</div>
            {names.length > 0 || kind !== 'router' ? (
                <Segmented label={label} value={kind} onChange={choose} items={items} />
            ) : (
                <p className="text-xs text-muted-foreground">{S.dns.dnsRoutera}</p>
            )}
            {kind === 'single' && (
                <select
                    value={cur}
                    aria-label={S.dns.serverDlya(label)}
                    onChange={(e) => assign(e.currentTarget.value || undefined)}
                    className={`${inputCls} w-full`}
                >
                    {cur && !names.includes(cur) && <option value={cur}>{cur}</option>}
                    {names.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
            )}
            {kind === 'group' && group && (
                <div className="space-y-2">
                    <Segmented
                        label={S.dns.kakSprashivatGruppu(label)}
                        value={group.mode === 'race' ? 'race' : 'failover'}
                        onChange={(v) => setGroup({ ...group, mode: v })}
                        items={[
                            { value: 'failover', label: S.dns.poOcheredi },
                            { value: 'race', label: S.dns.srazuVse },
                        ]}
                    />
                    <ol className="space-y-1">
                        {group.servers.map((m, i) => {
                            const ms = st?.servers?.find((x) => x.name === m)
                            return (
                                <li key={m} className="flex items-center gap-2 text-sm">
                                    <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
                                    <span className="min-w-0 flex-1 truncate font-mono">{m}</span>
                                    {ms && ms.pause > 0 && <span className="shrink-0 text-xs text-destructive">{S.dns.pauza(ms.pause)}</span>}
                                    {group.mode !== 'race' && st?.active === m && <span className="shrink-0 text-xs text-muted-foreground">{S.dns.otvechaetPervym}</span>}
                                    <button type="button" aria-label={S.dns.vyshe(m)} onClick={() => move(i, i - 1)} disabled={i === 0}
                                        className="sp-row bg-transparent p-0 text-muted-foreground disabled:opacity-30">
                                        <ArrowUp className="h-4 w-4" />
                                    </button>
                                    <button type="button" aria-label={S.dns.nizhe(m)} onClick={() => move(i, i + 1)} disabled={i === group.servers.length - 1}
                                        className="sp-row bg-transparent p-0 text-muted-foreground disabled:opacity-30">
                                        <ArrowDown className="h-4 w-4" />
                                    </button>
                                    <button type="button" aria-label={S.dns.ubratIzGruppy(m)} disabled={group.servers.length === 1}
                                        onClick={() => setGroup({ ...group, servers: group.servers.filter((x) => x !== m) })}
                                        className="sp-row bg-transparent p-0 text-muted-foreground hover:text-destructive disabled:opacity-30">
                                        <X className="h-4 w-4" />
                                    </button>
                                </li>
                            )
                        })}
                    </ol>
                    {rest.length > 0 && (
                        <select
                            value=""
                            aria-label={S.dns.dobavitVGruppu(label)}
                            onChange={(e) => {
                                const v = e.currentTarget.value
                                if (v) setGroup({ ...group, servers: [...group.servers, v] })
                            }}
                            className={`${inputCls} w-full`}
                        >
                            <option value="">{S.dns.dobavitServer}</option>
                            {rest.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                    )}
                </div>
            )}
        </div>
    )
}

export default function Dns({ live }: { live?: Live }) {
    const [spec, setSpec] = useSpecCopy()
    const [log, setLog] = useState<DnsLog | null>(null)
    const [preset, setPreset] = useState(PRESETS[0].name)

    useEffect(() => {
        let stop = false
        const tick = () => rpc.dnsLog().then((l) => { if (!stop) setLog(l) }).catch(() => { if (!stop) setLog(null) })
        void tick()
        const id = setInterval(tick, 5000)
        return () => { stop = true; clearInterval(id) }
    }, [])

    if (!spec) return <div className="p-5 text-sm text-muted-foreground">{S.dns.zagruzka}</div>

    const dns: DnsSpec = spec.dns || {}
    const ups = dns.upstreams || {}
    const names = Object.keys(ups)
    const groups = dns.groups || {}
    /* Группы и сервер для остальных — по умению ядра; записанное в спеке видно и снимается и без него. */
    const canGroup = dnsGroupsSupported(live?.status)
    const showOther = dnsOtherSupported(live?.status) || !!dns.other
    const outs = Object.entries(spec.outputs)
        .filter(([, o]) => !isPart(o) && o.kind !== 'direct' && o.kind !== 'zapret' && o.kind !== 'tgws' && o.kind !== 'group')
        .map(([n]) => n)

    function setDns(next: DnsSpec) {
        const clean: DnsSpec = { ...next }
        if (clean.upstreams && !Object.keys(clean.upstreams).length) delete clean.upstreams
        if (clean.groups && !Object.keys(clean.groups).length) delete clean.groups
        if (!clean.upstream) delete clean.upstream
        if (!clean.other) delete clean.other
        if (!clean.bootstrap?.length) delete clean.bootstrap
        if (!clean.cache) delete clean.cache
        const out: Spec = { ...spec!, dns: Object.keys(clean).length ? clean : undefined }
        setSpec(out)
        pending.edit(out)
    }
    function setUp(name: string, up: Upstream) {
        setDns({ ...dns, upstreams: { ...ups, [name]: up } })
    }
    function rename(old: string, nn: string) {
        if (!NAME_RE.test(nn) || (nn !== old && (ups[nn] || groups[nn]))) return
        const next: Record<string, Upstream> = {}
        for (const [k, v] of Object.entries(ups)) next[k === old ? nn : k] = v
        /* Правила, общий сервер, сервер остальных и группы ссылаются на имя — уводим их за ним. */
        const channels = spec!.channels.map((c) => (c.dns === old ? { ...c, dns: nn } : c))
        const g: Record<string, UpstreamGroup> = {}
        for (const [k, v] of Object.entries(groups)) g[k] = { ...v, servers: v.servers.map((m) => (m === old ? nn : m)) }
        const d: DnsSpec = {
            ...dns,
            upstreams: next,
            groups: Object.keys(g).length ? g : undefined,
            upstream: dns.upstream === old ? nn : dns.upstream,
            other: dns.other === old ? nn : dns.other,
        }
        if (!d.groups) delete d.groups
        if (!d.other) delete d.other
        const out: Spec = { ...spec!, channels, dns: d }
        setSpec(out)
        pending.edit(out)
    }
    function remove(name: string) {
        const used = spec!.channels.filter((c) => c.dns === name).map((c) => c.name)
        if (used.length) { notify(S.dns.serverVybranVPravilah(name, used.join(', ')), 'warning'); return }
        const inGroups = Object.entries(groups).filter(([, g]) => g.servers.includes(name)).map(([k]) => k)
        if (inGroups.length) { notify(S.dns.serverVGruppe(name), 'warning'); return }
        const rest = { ...ups }
        delete rest[name]
        setDns({
            ...dns,
            upstreams: rest,
            upstream: dns.upstream === name ? undefined : dns.upstream,
            other: dns.other === name ? undefined : dns.other,
        })
    }
    function addPreset() {
        const p = PRESETS.find((x) => x.name === preset)
        if (!p) return
        let name = p.name
        let k = 2
        while (ups[name]) name = `${p.name}${k++}`
        setUp(name, { ...p.up })
    }
    function addCustom() {
        let name = 'dns'
        let k = 2
        while (ups[name]) name = `dns${k++}`
        setUp(name, { url: 'https://' })
    }

    /** Срок записи кэша (`dns.cache_ttl`): поле пустое — умолчание ядра (`def`). */
    type TtlKey = 'min' | 'max' | 'negative'
    function setTtl(k: TtlKey, v: number | undefined) {
        const t = { ...(dns.cache_ttl || {}) }
        if (v === undefined) delete t[k]
        else t[k] = v
        const next: DnsSpec = { ...dns, cache_ttl: t }
        if (!Object.keys(t).length) delete next.cache_ttl
        setDns(next)
    }
    const ttlInput = (k: TtlKey, def: number, min: number, max: number) => (
        <input
            type="number"
            inputMode="numeric"
            value={dns.cache_ttl?.[k] ?? ''}
            min={min}
            max={max}
            placeholder={String(def)}
            onChange={(e) => {
                const v = e.currentTarget.value.trim()
                const n = Number(v)
                setTtl(k, v === '' || !Number.isInteger(n) ? undefined : Math.min(max, Math.max(min, n)))
            }}
            className={`${inputCls} w-full`}
        />
    )

    const state = (n: string) => log?.upstreams?.find((u) => u.name === n)
    const mode: DomainMode = dns.mode || 'fakeip'

    /* Состояние сервера точкой, как у выходов в приложении: зелёная — отвечает или ждёт
     * вопросов, жёлтая — соединяется, красная — не отвечает или не может работать вовсе. */
    const dotOf = (st?: string) =>
        !st ? 'bg-muted-foreground'
            : st === 'ready' || st === 'idle' ? 'bg-success'
                : st === 'connecting' ? 'bg-warning' : 'bg-destructive'

    /* Bode: раскладка приложения. Серверы — строками одной карточки через линию, у каждого
     * шапка «точка · имя · состояние · убрать» и поля строками «подпись — поле»; режим — двумя
     * сегментами вместо двух радиокнопок столбиком. */
    return (
        <div className="space-y-4">
            <Block>
                <CardHead title={S.dns.serveryDns} meta={names.length ? S.dns.serverov(names.length) : undefined} />
                {names.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                        {S.dns.serverovNetImenaPod}</p>
                )}
                {names.length > 0 && (
                    <div className="divide-y divide-border">
                        {names.map((n) => {
                            const u = ups[n]
                            const s = state(n)
                            return (
                                <div key={n} className="space-y-1 py-3 first:pt-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className={`h-2 w-2 shrink-0 rounded-full ${dotOf(s?.state)}`} aria-hidden="true" />
                                        <input
                                            defaultValue={n}
                                            aria-label={S.dns.imyaServera(n)}
                                            onBlur={(e) => rename(n, e.currentTarget.value.trim())}
                                            className={`${inputCls} w-40 font-mono`}
                                        />
                                        {s && (
                                            <span className={`text-xs ${s.state === 'down' || s.state === 'no-tls' ? 'text-destructive' : 'text-muted-foreground'}`}>
                                                {PROTO_TEXT[s.proto] || s.proto} · {STATE_TEXT[s.state] || s.state}
                                                {s.ok !== undefined ? S.dns.otvetov(s.ok) : ''}
                                                {s.http ? S.dns.http(s.http) : ''}
                                                {s.early || s.early_rejected ? S.dns.early(s.early ?? 0, s.early_rejected ?? 0) : ''}
                                            </span>
                                        )}
                                        <span className="flex-1" />
                                        <button type="button" aria-label={S.dns.ubrat(n)} onClick={() => remove(n)} className="sp-row bg-transparent p-0 text-muted-foreground hover:text-destructive">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                    <FieldRow label={S.dns.adres}>
                                        <input
                                            value={u.url}
                                            onChange={(e) => setUp(n, { ...u, url: e.currentTarget.value.trim() })}
                                            placeholder="https://dns.example/dns-query"
                                            className={`${inputCls} w-full font-mono`}
                                        />
                                    </FieldRow>
                                    <FieldRow label={S.dns.cherezVyhod}>
                                        <select
                                            value={u.out || ''}
                                            onChange={(e) => setUp(n, { ...u, out: e.currentTarget.value || undefined })}
                                            className={`${inputCls} w-full`}
                                        >
                                            <option value="">{S.dns.napryamuyu}</option>
                                            {outs.map((o) => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                    </FieldRow>
                                    <FieldRow label={S.dns.adresaServera}>
                                        <input
                                            defaultValue={(u.ips || []).join(', ')}
                                            onBlur={(e) => setUp(n, { ...u, ips: listOf(e.currentTarget.value) })}
                                            placeholder="1.1.1.1, 1.0.0.1"
                                            className={`${inputCls} w-full font-mono`}
                                        />
                                    </FieldRow>
                                    <FieldRow label={S.dns.razreshatImyaCherez}>
                                        <input
                                            defaultValue={(u.bootstrap || []).join(', ')}
                                            onBlur={(e) => {
                                                const bs = listOf(e.currentTarget.value)
                                                const { bootstrap: _b, ...rest } = u
                                                setUp(n, bs.length ? { ...rest, bootstrap: bs } : rest)
                                            }}
                                            placeholder={S.dns.poUmolchaniyuObschie}
                                            className={`${inputCls} w-full font-mono`}
                                        />
                                    </FieldRow>
                                    {/* Ошибка — только когда сервер не отвечает (точка красная): ядро держит
                                        последнюю ошибку и при работающем сервере — «нет ответа» стояла под
                                        «работает · ответов: 5551», а «сервер закрыл соединение» (DoH-сервер
                                        сам закрывает простаивающее соединение) — под «ждёт вопросов». */}
                                    {s?.error && s.state !== 'ready' && s.state !== 'idle' && s.state !== 'connecting' &&
                                        !(s.last_ok_ago != null && s.error_ago != null && s.last_ok_ago < s.error_ago) &&
                                        <p className="text-xs text-destructive">{s.error}</p>}
                                </div>
                            )
                        })}
                    </div>
                )}
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    <select
                        value={preset}
                        aria-label={S.dns.dobavit}
                        onChange={(e) => setPreset(e.currentTarget.value)}
                        className={`${inputCls} min-w-0 flex-1`}
                    >
                        {PRESETS.map((p) => <option key={p.name} value={p.name}>{PRESET_TITLE.get(p.name) ?? p.name}</option>)}
                    </select>
                    <Button onClick={addPreset}><Plus className="h-4 w-4" aria-hidden="true" /> {S.dns.dobavit2}</Button>
                    <Button variant="secondary" onClick={addCustom}>{S.dns.svoyAdres}</Button>
                </div>
            </Block>

            <Block>
                <CardHead title={S.dns.kakSprashivat} />
                <div className="divide-y divide-border">
                    <DnsTarget spec={spec} dns={dns} which="upstream" label={S.dns.dlyaImenPodPravilami}
                        names={names} canGroup={canGroup} log={log} onDns={setDns} />
                    {showOther && (
                        <>
                            <DnsTarget spec={spec} dns={dns} which="other" label={S.dns.dlyaOstalnyhSaytov}
                                names={names} canGroup={canGroup} log={log} onDns={setDns} />
                            {log?.other && log.other.pause > 0 && (
                                <p className="py-1 text-xs text-destructive">{S.dns.ostalnyeCherezRouter(log.other.pause)}</p>
                            )}
                        </>
                    )}
                    <FieldRow label={S.dns.serveryDlyaRazresheniyaImen}>
                        <input
                            defaultValue={(dns.bootstrap || []).join(', ')}
                            onBlur={(e) => setDns({ ...dns, bootstrap: listOf(e.currentTarget.value).slice(0, 4) })}
                            placeholder="1.1.1.1, 8.8.8.8"
                            className={`${inputCls} w-full font-mono`}
                        />
                    </FieldRow>
                    <div className="space-y-2 py-3">
                        <div className="text-sm text-subtle">{S.dns.rezhimDomennyhPravil}</div>
                        <Segmented
                            label={S.dns.rezhimDomennyhPravil}
                            value={mode}
                            onChange={(v) => setDns({ ...dns, mode: v === 'fakeip' ? undefined : v })}
                            items={[
                                { value: 'fakeip', label: S.dns.poddelnyeAdresa },
                                { value: 'realip', label: S.dns.nastoyaschieAdresa },
                            ]}
                        />
                        <p className="text-xs text-muted-foreground">
                            {mode === 'fakeip'
                                ? S.dns.tochneePoDomenamZnachenie
                                : S.dns.trassirovkaViditNastoyaschieUzly}
                        </p>
                    </div>
                    <FieldRow label={S.dns.zapiseyVKesheOtvetov}>
                        <input
                            type="number"
                            inputMode="numeric"
                            value={dns.cache ?? ''}
                            min={0}
                            placeholder={S.dns.n0BezKesha}
                            onChange={(e) => {
                                const v = e.currentTarget.value.trim()
                                const n = Number(v)
                                setDns({ ...dns, cache: v === '' || !Number.isFinite(n) ? undefined : n })
                            }}
                            className={`${inputCls} w-full`}
                        />
                    </FieldRow>
                    {!!dns.cache && (
                        <>
                            <FieldRow label={S.dns.hranitNeMenshe}>{ttlInput('min', 10, 0, 86400)}</FieldRow>
                            <FieldRow label={S.dns.hranitNeDolshe}>{ttlInput('max', 3600, 1, 604800)}</FieldRow>
                            <FieldRow label={S.dns.otritsatelnyyOtvetHranit}>{ttlInput('negative', 30, 0, 86400)}</FieldRow>
                            {(dns.cache_ttl?.min ?? 10) > (dns.cache_ttl?.max ?? 3600) && (
                                <p className="py-1 text-xs text-destructive">{S.dns.minBolsheMax}</p>
                            )}
                        </>
                    )}
                    {log?.cache && (
                        <div className="py-2.5">
                            <KV
                                k={S.dns.kesh}
                                v={S.dns.vKesheIzPopadaniy(log.cache.entries, log.cache.max, log.cache.hits, log.cache.misses)}
                            />
                        </div>
                    )}
                </div>
            </Block>
        </div>
    )
}

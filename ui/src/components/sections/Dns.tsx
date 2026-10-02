import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Block, CardHead, FieldRow, KV, Segmented } from '@/components/ui/layout'
import { inputCls } from '@/components/formbits'
import { notify } from '@/lib/notify'
import { pending } from '@/lib/pending'
import { rpc, type DnsLog } from '@/lib/rpc'
import { isPart, type DomainMode, type DnsSpec, type Spec, type Upstream } from '@/lib/model'
import { type Live } from '@/lib/live'

import { S } from '@/copy'
/** DNS: какими серверами и через какой выход резолвер движка спрашивает имена под правилами.
 *
 *  Резолвер движка отвечает только на имена, которые попали под правило; остальные спрашивает
 *  системный DNS роутера, как раньше. Здесь выбирается, КУДА уходят вопросы о тех именах: DoH,
 *  DoT, DoQ или обычный DNS, напрямую или через выход. Серверы, которые уже настроены на самом
 *  роутере (dnsmasq, https-dns-proxy), этот раздел не трогает. */

const NAME_RE = /^[A-Za-z0-9_.-]{1,31}$/

const PRESETS: { title: string; name: string; up: Upstream }[] = [
    { title: 'Cloudflare (DoH)', name: 'cloudflare', up: { url: 'https://cloudflare-dns.com/dns-query', ips: ['1.1.1.1', '1.0.0.1'] } },
    { title: 'Google (DoH)', name: 'google', up: { url: 'https://dns.google/dns-query', ips: ['8.8.8.8', '8.8.4.4'] } },
    { title: 'Quad9 (DoT)', name: 'quad9', up: { url: 'tls://dns.quad9.net', ips: ['9.9.9.9', '149.112.112.112'] } },
    { title: 'AdGuard (DoQ)', name: 'adguard', up: { url: 'quic://dns.adguard-dns.com', ips: ['94.140.14.14', '94.140.15.15'] } },
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

export default function Dns(_props: { live?: Live }) {
    const [spec, setSpec] = useState<Spec | null>(null)
    const [log, setLog] = useState<DnsLog | null>(null)
    const [preset, setPreset] = useState(PRESETS[0].name)

    useEffect(() => {
        pending.load().then(setSpec).catch(() => setSpec(null))
    }, [])
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
    const outs = Object.entries(spec.outputs)
        .filter(([, o]) => !isPart(o) && o.kind !== 'direct' && o.kind !== 'zapret' && o.kind !== 'tgws' && o.kind !== 'group')
        .map(([n]) => n)

    function setDns(next: DnsSpec) {
        const clean: DnsSpec = { ...next }
        if (clean.upstreams && !Object.keys(clean.upstreams).length) delete clean.upstreams
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
        if (!NAME_RE.test(nn) || (nn !== old && ups[nn])) return
        const next: Record<string, Upstream> = {}
        for (const [k, v] of Object.entries(ups)) next[k === old ? nn : k] = v
        /* Правила и общий сервер ссылаются на имя — уводим их за ним. */
        const channels = spec!.channels.map((c) => (c.dns === old ? { ...c, dns: nn } : c))
        const d: DnsSpec = { ...dns, upstreams: next, upstream: dns.upstream === old ? nn : dns.upstream }
        const out: Spec = { ...spec!, channels, dns: d }
        setSpec(out)
        pending.edit(out)
    }
    function remove(name: string) {
        const used = spec!.channels.filter((c) => c.dns === name).map((c) => c.name)
        if (used.length) { notify(S.dns.serverVybranVPravilah(name, used.join(', ')), 'warning'); return }
        const rest = { ...ups }
        delete rest[name]
        setDns({ ...dns, upstreams: rest, upstream: dns.upstream === name ? undefined : dns.upstream })
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
                                    {s?.error && <p className="text-xs text-destructive">{s.error}</p>}
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
                        {PRESETS.map((p) => <option key={p.name} value={p.name}>{p.title}</option>)}
                    </select>
                    <Button onClick={addPreset}><Plus className="h-4 w-4" aria-hidden="true" /> {S.dns.dobavit2}</Button>
                    <Button variant="secondary" onClick={addCustom}>{S.dns.svoyAdres}</Button>
                </div>
            </Block>

            <Block>
                <CardHead title={S.dns.kakSprashivat} />
                <div className="divide-y divide-border">
                    <FieldRow label={S.dns.serverPoUmolchaniyuDlya}>
                        <select
                            value={dns.upstream || ''}
                            onChange={(e) => setDns({ ...dns, upstream: e.currentTarget.value || undefined })}
                            className={`${inputCls} w-full`}
                        >
                            <option value="">{S.dns.sistemnyyDnsRoutera}</option>
                            {names.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </FieldRow>
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

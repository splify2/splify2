import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, NumField, Radio, inputCls } from '@/components/formbits'
import { notify } from '@/lib/notify'
import { pending } from '@/lib/pending'
import { rpc, type DnsLog } from '@/lib/rpc'
import { isPart, type DomainMode, type DnsSpec, type Spec, type Upstream } from '@/lib/model'
import { type Live } from '@/lib/live'

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
    ready: 'работает',
    idle: 'ждёт вопросов',
    connecting: 'соединяется',
    down: 'не отвечает',
    unmarked: 'выход не размечен',
    'no-tls': 'нужна сборка с TLS',
}

const PROTO_TEXT: Record<string, string> = { udp: 'DNS', tcp: 'DNS по TCP', dot: 'DoT', doh: 'DoH', doq: 'DoQ' }

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

    if (!spec) return <div className="p-5 text-sm text-muted-foreground">Загрузка…</div>

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
        if (used.length) { notify(`Сервер «${name}» выбран в правилах: ${used.join(', ')}`, 'warning'); return }
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

    const state = (n: string) => log?.upstreams?.find((u) => u.name === n)
    const mode: DomainMode = dns.mode || 'fakeip'

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Серверы DNS</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {names.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                            Серверов нет: имена под правилами спрашиваются у системного DNS роутера.
                        </p>
                    )}
                    {names.map((n) => {
                        const u = ups[n]
                        const s = state(n)
                        return (
                            <div key={n} className="space-y-3 rounded-lg border border-border p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <input
                                        defaultValue={n}
                                        aria-label={`имя сервера ${n}`}
                                        onBlur={(e) => rename(n, e.currentTarget.value.trim())}
                                        className={`${inputCls} w-40 font-mono`}
                                    />
                                    {s && (
                                        <span className={`text-xs ${s.state === 'down' || s.state === 'no-tls' ? 'text-destructive' : 'text-muted-foreground'}`}>
                                            {PROTO_TEXT[s.proto] || s.proto} · {STATE_TEXT[s.state] || s.state}
                                            {s.ok !== undefined ? ` · ответов: ${s.ok}` : ''}
                                        </span>
                                    )}
                                    <span className="flex-1" />
                                    <button type="button" aria-label={`убрать ${n}`} onClick={() => remove(n)} className="sp-row bg-transparent p-0 text-muted-foreground hover:text-destructive">
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                                <Field label="Адрес">
                                    <input
                                        value={u.url}
                                        onChange={(e) => setUp(n, { ...u, url: e.currentTarget.value.trim() })}
                                        placeholder="https://dns.example/dns-query"
                                        className={`${inputCls} w-full font-mono`}
                                    />
                                </Field>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Через выход">
                                        <select
                                            value={u.out || ''}
                                            onChange={(e) => setUp(n, { ...u, out: e.currentTarget.value || undefined })}
                                            className={`${inputCls} w-full`}
                                        >
                                            <option value="">напрямую</option>
                                            {outs.map((o) => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                    </Field>
                                    <Field label="Адреса сервера">
                                        <input
                                            defaultValue={(u.ips || []).join(', ')}
                                            onBlur={(e) => setUp(n, { ...u, ips: listOf(e.currentTarget.value) })}
                                            placeholder="1.1.1.1, 1.0.0.1"
                                            className={`${inputCls} w-full font-mono`}
                                        />
                                    </Field>
                                </div>
                                {s?.error && <p className="text-xs text-destructive">{s.error}</p>}
                            </div>
                        )
                    })}
                    <div className="flex flex-wrap items-end gap-2">
                        <Field label="Добавить">
                            <select value={preset} onChange={(e) => setPreset(e.currentTarget.value)} className={`${inputCls}`}>
                                {PRESETS.map((p) => <option key={p.name} value={p.name}>{p.title}</option>)}
                            </select>
                        </Field>
                        <Button onClick={addPreset}><Plus className="h-4 w-4" aria-hidden="true" /> Добавить</Button>
                        <Button variant="secondary" onClick={addCustom}>Свой адрес</Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Как спрашивать</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                    <Field label="Сервер по умолчанию для имён под правилами">
                        <select
                            value={dns.upstream || ''}
                            onChange={(e) => setDns({ ...dns, upstream: e.currentTarget.value || undefined })}
                            className={`${inputCls} w-full`}
                        >
                            <option value="">системный DNS роутера</option>
                            {names.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </Field>
                    <Field label="Серверы для разрешения имён серверов (обычный DNS)">
                        <input
                            defaultValue={(dns.bootstrap || []).join(', ')}
                            onBlur={(e) => setDns({ ...dns, bootstrap: listOf(e.currentTarget.value).slice(0, 4) })}
                            placeholder="1.1.1.1, 8.8.8.8"
                            className={`${inputCls} w-full font-mono`}
                        />
                    </Field>
                    <div className="space-y-1">
                        <div className="sp-label uppercase tracking-wide text-muted-foreground">Режим доменных правил</div>
                        <Radio on={mode === 'fakeip'} onClick={() => setDns({ ...dns, mode: undefined })}>
                            <span className="font-medium">Поддельные адреса</span>
                            <span className="block text-xs text-muted-foreground">точнее по доменам, значение по умолчанию</span>
                        </Radio>
                        <Radio on={mode === 'realip'} onClick={() => setDns({ ...dns, mode: 'realip' })}>
                            <span className="font-medium">Настоящие адреса</span>
                            <span className="block text-xs text-muted-foreground">трассировка видит настоящие узлы</span>
                        </Radio>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <NumField
                            label="Записей в кэше ответов"
                            value={dns.cache}
                            onChange={(v) => setDns({ ...dns, cache: v })}
                            placeholder="0 — без кэша"
                            min={0}
                        />
                        {log?.cache && (
                            <div className="self-end pb-2 text-xs text-muted-foreground">
                                в кэше {log.cache.entries} из {log.cache.max} · попаданий {log.cache.hits}, промахов {log.cache.misses}
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

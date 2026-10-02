// Граница между моделью интерфейса и спекой движка 2.0 (docs/spec-v2.md).
//
// ЗАЧЕМ СЛОЙ. Интерфейс держит модель «правило → список → выход» (Spec в model.ts): пулы с
// частями, правила с сужением по портам, клиенты прямо в правиле. Спека v2 устроена иначе:
// клиенты, списки и выходы — отдельные разделы со своими именами, а правила только на них
// ссылаются; пул — группа `kind: group`, VLESS — `kind: tunnel, protocol: vless`. Переписывать
// тридцать компонентов под эту раскладку значило бы потерять всё, что в них отлажено, поэтому
// перевод стоит на единственной границе: `decodeSpec` на чтении (rpc.specGet / appliedGet) и
// `encodeSpec` на записи (pending.flush). Всё, что между ними, работает с прежней моделью.
//
// ЧТО ПИШЕТСЯ НА ДИСК. JSON-объект с `"version": 2`. Спека v2 — YAML, а JSON — его
// подмножество, и движок узнаёт формат по содержимому, а не по имени файла (spec-v2.md,
// «Формат и файл»). Писать YAML из интерфейса нечем и незачем: сериализатор JSON безопасен по
// построению, а файл остаётся тем же `/etc/steer/spec.json`, который знают init-скрипт движка,
// keep.d и бэкенд.
//
// ПРЕЖНЯЯ СПЕКА v1 (`schema`) читается прежним путём (normalizeSpec) и при первом же сохранении
// уезжает уже как v2: человек ничего не переносит руками. Признак «прочитана v1» — непустое
// `Spec.schema`; у спеки, прочитанной из v2, его нет.
//
// ПУЛ. Выход-пул модели (kind=interface с несколькими `devices`) пишется группой
// `pick: order|latency` с членами `<пул>.<устройство>` — kind=interface с этим устройством.
// Ровно так переводит пул v1 `steer spec convert`, и члены выходят в конец списка выходов:
// реестр меток раздаёт их по порядку, прежние выходы сохраняют свои. Части пула (выходы
// vless со своим устройством) остаются обычными туннелями; ключа `part_of` в v2 нет (неизвестный
// ключ — отказ разбора), поэтому при чтении часть узнаётся по устройству: туннель, чьё
// устройство названо членом пула и на который не ссылается ни одно правило.
//
// СУЖЕНИЕ. Правило «подсети с портами» в v2 — отдельное правило со своим списком
// (`proto`/`ports` — свойство списка). Спутник в модели получает имя «<правило> (порты)»; при
// чтении правила с таким именем и тем же выходом складываются обратно в родителя.

import {
    normalizeSpec,
    withDirect,
    type Channel,
    type DnsSpec,
    type Narrow,
    type Output,
    type OutputKind,
    type OutputStatus,
    type Spec,
    type Status,
    type Upstream,
} from '@/lib/model'

import { S } from '@/copy'
type J = Record<string, unknown>

const isObj = (v: unknown): v is J => !!v && typeof v === 'object' && !Array.isArray(v)

/** Перечень: список либо одно значение (spec-v2.md, «Общие правила разбора»). */
function arr(v: unknown): string[] {
    if (Array.isArray(v)) return v.map((x) => String(x))
    if (v === undefined || v === null || v === '') return []
    return [String(v)]
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

const MAC_RE = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i
const NAME_OK = /^[A-Za-z0-9_.-]{1,31}$/
const SUFFIX_RE = /^(.*) \(порты( \d+)?\)$/

/** Прочитана ли спека из прежней формы (v1). */
export function wasV1(spec: Spec): boolean {
    return spec.schema !== undefined
}

/** Спека с диска → модель интерфейса. Принимает v2 (`version`), v1 (`schema`) и мусор (его
 *  разбирает normalizeSpec так же, как раньше: пустая спека вместо падения). */
export function decodeSpec(raw: unknown): Spec {
    if (isObj(raw) && 'version' in raw && !('schema' in raw)) return decodeV2(raw)
    const spec = normalizeSpec(raw as Spec)
    if (!spec || !isObj(spec.outputs)) return spec
    /* `via` спеки v1 — `over` модели. */
    for (const o of Object.values(spec.outputs)) {
        const legacy = o as Output & { via?: string }
        if (legacy.via !== undefined) {
            if (!legacy.over) legacy.over = legacy.via
            delete legacy.via
        }
    }
    return spec
}

// ---------------------------------------------------------------------------------------
// чтение v2

/** Протоколы туннеля, которые модель интерфейса знает как свои виды выхода. Остальные (trojan,
 *  shadowsocks, socks, http, vmess из steer-proxy и любой будущий) читаются видом `tunnel` с
 *  протоколом как есть: прежде они читались как vless и уезжали обратно `protocol: vless` —
 *  туннель молча менял протокол при первом же сохранении любой правки. */
const OWN_TUNNEL = new Set(['vless', 'hysteria2'])

function decodeOutput(name: string, o: J): Output {
    const kindRaw = str(o.kind) || 'direct'
    /* Ключ, который модель разобрала, — в `used`; всё остальное уходит в `extra` и пишется
     * обратно как есть. Так ключ, знакомый одному виду, но стоящий у другого, тоже не теряется. */
    const used = new Set<string>(['kind'])
    const take = (k: string) => { used.add(k); return o[k] }
    const out: Output = { name, kind: 'direct' }
    let kind: OutputKind
    if (kindRaw === 'tunnel') {
        const proto = str(o.protocol)
        if (proto && OWN_TUNNEL.has(proto)) { used.add('protocol'); kind = proto as OutputKind }
        else {
            kind = 'tunnel'
            if (proto) { used.add('protocol'); out.protocol = proto }
        }
    } else kind = kindRaw as OutputKind
    out.kind = kind
    const dev = str(take('device'))
    if (dev) out.device = dev
    const onFail = str(take('on_fail'))
    if (onFail) out.on_fail = onFail as Output['on_fail']
    const over = str(take('over'))
    if (over) out.over = over
    const v6 = str(take('ipv6'))
    if (v6) out.ipv6 = v6 as Output['ipv6']
    const prefix = str(take('prefix'))
    if (prefix) out.prefix = prefix
    if (isObj(o.obfs)) {
        used.add('obfs')
        out.obfs = {
            mode: (str(o.obfs.mode) as 'wg-over-tcp' | undefined) || 'wg-over-tcp',
            server: String(o.obfs.server ?? ''),
            listen: String(o.obfs.listen ?? ''),
        }
    }
    if (kind === 'vless' || kind === 'hysteria2' || kind === 'tunnel') {
        const sub = str(take('subscription'))
        if (sub) out.sub_file = sub
        if (Array.isArray(o.nodes) && o.nodes.every((n) => Number.isInteger(n))) {
            used.add('nodes')
            if (o.nodes.length) out.nodes = o.nodes as number[]
        }
    }
    if (kind === 'vless' || kind === 'hysteria2') {
        const tr = arr(take('transport'))
        if (tr.length) out.transport = tr
    }
    if (kind === 'xsteer' || kind === 'awg') {
        const conf = str(take('conf'))
        if (conf) out.conf = conf
    }
    if (kind === 'xsteer') {
        const st = str(take('stream'))
        if (st) out.stream = st
        const sp = num(take('stream_port'))
        if (sp !== undefined) out.stream_port = sp
    }
    if (kind === 'tgws') {
        const dm = str(take('domain'))
        if (dm) out.domain = dm
    }
    if (kind === 'zapret') {
        const s = str(take('strategy'))
        if (s) out.opts_file = s
    }
    if (kind === 'group') {
        out.members = arr(take('members'))
        out.pick = (str(take('pick')) as Output['pick']) || 'order'
        const d = str(take('default'))
        if (d) out.default = d
        for (const k of ['tolerance', 'interval', 'idle_timeout'] as const) {
            const n = num(take(k))
            if (n !== undefined) out[k] = n
        }
        const u = str(take('url'))
        if (u) out.url = u
        if (Array.isArray(take('weights'))) out.weights = (o.weights as unknown[]).map(Number)
    }
    const extra: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o)) if (!used.has(k)) extra[k] = v
    if (Object.keys(extra).length) out.extra = extra
    return out
}

/** Устройство, которое несёт выход: своё либо выведенное из имени (первые 15 знаков). */
function deviceOf(o: Output): string {
    return o.device || o.name.slice(0, 15)
}

function decodeUpstream(u: unknown): Upstream | string | undefined {
    if (typeof u === 'string') return u
    if (!isObj(u)) return undefined
    const out: Upstream = { url: String(u.url ?? '') }
    const o = str(u.out)
    if (o) out.out = o
    const ips = arr(u.ips)
    if (ips.length) out.ips = ips
    const bs = arr(u.bootstrap)
    if (bs.length) out.bootstrap = bs
    return out
}

function decodeDns(d: J): DnsSpec | undefined {
    const out: DnsSpec = {}
    const mode = str(d.mode)
    if (mode === 'fakeip' || mode === 'realip') out.mode = mode
    const cache = num(d.cache)
    if (cache !== undefined) out.cache = cache
    if (isObj(d.cache_ttl)) {
        const t: NonNullable<DnsSpec['cache_ttl']> = {}
        for (const k of ['min', 'max', 'negative'] as const) {
            const n = num((d.cache_ttl as J)[k])
            if (n !== undefined) t[k] = n
        }
        out.cache_ttl = t
    }
    const up = str(d.upstream)
    if (up) out.upstream = up
    const bs = arr(d.bootstrap)
    if (bs.length) out.bootstrap = bs
    if (isObj(d.upstreams)) {
        const ups: Record<string, Upstream> = {}
        for (const [k, v] of Object.entries(d.upstreams)) {
            const u = decodeUpstream(v)
            if (u && typeof u !== 'string') ups[k] = u
        }
        if (Object.keys(ups).length) out.upstreams = ups
    }
    return Object.keys(out).length ? out : undefined
}

function decodeV2(d: J): Spec {
    const lan = isObj(d.lan) ? d.lan : {}
    const clients = isObj(d.clients) ? d.clients : {}
    const lists = isObj(d.lists) ? d.lists : {}
    const outs = isObj(d.outputs) ? d.outputs : {}
    const rules = Array.isArray(d.rules) ? d.rules : []
    const dnsRaw = isObj(d.dns) ? d.dns : {}

    const outputs: Record<string, Output> = {}
    for (const [name, o] of Object.entries(outs)) if (isObj(o)) outputs[name] = decodeOutput(name, o)

    /* Правила читаются до разбора пулов: «часть» — это туннель, на который правила не ссылаются. */
    const channels: Channel[] = []
    rules.forEach((r, i) => {
        if (!isObj(r)) return
        const ch: Channel = { name: str(r.name) || `rule-${i + 1}`, match: {}, out: String(r.out ?? '') }
        if (r.enabled === false) ch.enabled = false
        if (str(r.scope) === 'device') ch.scope = 'device'
        const forNames = arr(r.for).filter((n) => n !== 'lan')
        const from: string[] = []
        for (const n of forNames) {
            const c = clients[n]
            if (!isObj(c)) continue
            for (const a of arr(c.addr)) from.push(a)
            for (const m of arr(c.mac)) from.push(m)
        }
        if (from.length) ch.from = from
        const resolve = str(r.resolve)
        if (resolve === 'fakeip' || resolve === 'realip') ch.match.mode = resolve
        const dns = decodeUpstream(r.dns)
        if (dns) ch.dns = dns
        const toNames = arr(r.to)
        const narrow: Record<string, Narrow> = {}
        const pf: string[] = []
        const df: string[] = []
        const srs: string[] = []
        for (const n of toNames) {
            if (n === 'all') { ch.match.any = true; continue }
            const l = lists[n]
            if (!isObj(l)) continue
            const nw: Narrow = {}
            const proto = str(l.proto)
            if (proto === 'tcp' || proto === 'udp' || proto === 'both') nw.proto = proto
            const ports = arr(l.ports)
            if (ports.length) nw.ports = ports
            const narrowed = !!(nw.proto || nw.ports)
            if (l.all === true) {
                ch.match.any = true
                if (narrowed) {
                    if (nw.proto) ch.match.proto = nw.proto
                    if (nw.ports) ch.match.ports = nw.ports
                }
            }
            for (const f of arr(l.prefixes_file)) { pf.push(f); if (narrowed) narrow[f] = nw }
            for (const f of arr(l.domains_file)) { df.push(f); if (narrowed) narrow[f] = nw }
            for (const f of arr(l.srs)) srs.push(f)
        }
        if (pf.length) ch.match.prefixes_files = pf
        if (df.length) ch.match.domains_files = df
        if (srs.length) ch.match.srs_files = srs
        if (Object.keys(narrow).length) ch.narrow = narrow
        channels.push(ch)
    })

    /* Спутники с портами — обратно в родителей (см. шапку). */
    const folded: Channel[] = []
    for (const ch of channels) {
        const m = SUFFIX_RE.exec(ch.name)
        const parent = m ? [...folded].reverse().find((p) => p.name === m[1] && p.out === ch.out) : undefined
        if (parent && !ch.match.any) {
            parent.match = {
                ...parent.match,
                prefixes_files: [...(parent.match.prefixes_files || []), ...(ch.match.prefixes_files || [])],
            }
            if (ch.match.domains_files?.length)
                parent.match.domains_files = [...(parent.match.domains_files || []), ...ch.match.domains_files]
            parent.narrow = { ...(parent.narrow || {}), ...(ch.narrow || {}) }
            continue
        }
        folded.push(ch)
    }

    /* Пулы: группа order/latency, все члены которой — kind=interface с именем «<группа>.…». */
    const referenced = new Set<string>()
    for (const c of folded) referenced.add(c.out)
    for (const [gname, g] of Object.entries(outputs)) {
        if (g.kind !== 'group') continue
        if (g.pick !== 'order' && g.pick !== 'latency') continue
        const members = g.members || []
        if (!members.length) continue
        const ok = members.every((mn) => {
            const m = outputs[mn]
            return m && m.kind === 'interface' && mn.startsWith(`${gname}.`) && !!m.device &&
                !m.ipv6 && !m.obfs && !m.over && !m.extra
        })
        if (!ok || g.default || g.weights) continue
        const devices = members.map((mn) => outputs[mn].device as string)
        const pool: Output = { name: gname, kind: 'interface', devices, device: devices[0] }
        if (g.on_fail) pool.on_fail = g.on_fail
        pool.pick = g.pick
        for (const k of ['tolerance', 'interval', 'idle_timeout', 'url'] as const) {
            if (g[k] !== undefined) (pool as unknown as Record<string, unknown>)[k] = g[k]
        }
        if (g.extra) pool.extra = g.extra
        for (const mn of members) delete outputs[mn]
        outputs[gname] = pool
        /* Части пула: туннели, чьё устройство названо членом, без ссылок из правил. */
        for (const o of Object.values(outputs)) {
            if ((o.kind === 'vless' || o.kind === 'hysteria2') && !o.part_of && !referenced.has(o.name) &&
                devices.includes(deviceOf(o))) o.part_of = gname
        }
    }
    /* Пул из одного устройства без частей — обычный выход-интерфейс. */
    for (const o of Object.values(outputs)) {
        if (o.kind === 'interface' && o.devices?.length === 1) {
            const only = o.devices[0]
            const isPart = Object.values(outputs).some((p) => p.part_of === o.name && deviceOf(p) === only)
            if (!isPart && !o.pick) { o.device = only; delete o.devices }
        }
    }

    const spec: Spec = { outputs: withDirect(outputs), channels: folded }
    const devs = arr(lan.devices)
    if (devs.length) spec.lan_devices = devs
    const addr = arr(lan.addr)
    if (addr.length) spec.from_default = addr
    if (dnsRaw.traceroute_hops === true) spec.traceroute_hops = true
    const dns = decodeDns(dnsRaw)
    if (dns) spec.dns = dns
    return spec
}

/** Состояние движка → вид, к которому привык интерфейс: пул, записанный группой с членами
 *  «<пул>.<устройство>», снова один выход kind=interface со списком устройств, а его члены из
 *  перечня выходов уходят. Та же свёртка, что у спеки (decodeV2): без неё счётчик «VPN», блоки
 *  туннелей на главной и проверка устройств видели бы служебные члены как отдельные выходы, а
 *  пул — как группу, которой в списке «свои туннели» не место. Остальные группы (выбор вручную,
 *  веса, члены-выходы) остаются группами и показываются как есть. */
export function foldStatus(st: Status): Status {
    const outs = st?.outputs
    if (!outs) return st
    const hidden = new Set<string>()
    const pools = new Set<string>()
    for (const [g, o] of Object.entries(outs)) {
        const gr = o.kind === 'group' ? o.group : undefined
        if (!gr || (gr.pick !== 'order' && gr.pick !== 'latency') || !gr.members.length) continue
        if (!gr.members.every((m) => m.startsWith(`${g}.`) && outs[m]?.kind === 'interface')) continue
        pools.add(g)
        for (const m of gr.members) hidden.add(m)
    }
    if (!pools.size) return st
    const next: Record<string, OutputStatus> = {}
    for (const [n, o] of Object.entries(outs)) {
        if (hidden.has(n)) continue
        if (pools.has(n)) {
            const members = o.group!.members
            const { group: _g, ...rest } = o
            next[n] = {
                ...rest,
                kind: 'interface',
                devices: o.devices?.length ? o.devices : members.map((m) => outs[m].device || ''),
            }
            continue
        }
        next[n] = o
    }
    return { ...st, outputs: next }
}

// ---------------------------------------------------------------------------------------
// запись v2

/** Имя для списка или клиента: по имени правила, если оно годится в идентификатор, иначе
 *  `<префикс><номер>`; занятое получает числовой хвост. */
function makeNamer(prefix: string) {
    const used = new Set<string>()
    return (base: string, n: number): string => {
        let name = /^[A-Za-z0-9_-]{1,24}$/.test(base) ? base : `${prefix}${n}`
        let k = 2
        while (used.has(name)) name = `${/^[A-Za-z0-9_-]{1,24}$/.test(base) ? base : prefix + n}_${k++}`
        used.add(name)
        return name
    }
}

const narrowKey = (n?: Narrow) => (n && (n.proto || n.ports?.length) ? `${n.proto || ''}|${(n.ports || []).join(',')}` : '')

function encodeOutput(o: Output): J {
    const out: J = {}
    const put = (k: string, v: unknown) => {
        if (v === undefined || v === null || v === '') return
        if (Array.isArray(v) && v.length === 0) return
        out[k] = v
    }
    switch (o.kind) {
        case 'direct':
            out.kind = 'direct'
            break
        case 'interface':
            out.kind = 'interface'
            put('device', o.device || o.devices?.[0])
            put('obfs', o.obfs)
            put('ipv6', o.ipv6)
            put('prefix', o.ipv6 === 'routed' ? o.prefix : undefined)
            break
        case 'vless':
        case 'hysteria2': {
            out.kind = 'tunnel'
            out.protocol = o.kind
            put('subscription', o.sub_file)
            const nodes = o.nodes?.length ? o.nodes : typeof o.node === 'number' && o.node >= 0 ? [o.node] : []
            put('nodes', nodes)
            put('device', o.device)
            if (o.kind === 'vless' && o.transport?.length) put('transport', o.transport.length === 1 ? o.transport[0] : o.transport)
            break
        }
        case 'tunnel':
            /* Протокол, которого модель не знает своим видом: всё, кроме общих ключей туннеля,
             * лежит в `extra` и пишется ниже как есть. */
            out.kind = 'tunnel'
            put('protocol', o.protocol)
            put('subscription', o.sub_file)
            put('nodes', o.nodes)
            put('device', o.device)
            break
        case 'xsteer':
            out.kind = 'xsteer'
            put('conf', o.conf)
            put('stream', o.stream)
            put('stream_port', o.stream_port)
            put('device', o.device)
            break
        case 'awg':
            out.kind = 'awg'
            put('conf', o.conf)
            put('device', o.device)
            put('ipv6', o.ipv6)
            put('prefix', o.ipv6 === 'routed' ? o.prefix : undefined)
            break
        case 'tgws':
            out.kind = 'tgws'
            put('domain', o.domain)
            break
        case 'zapret':
            out.kind = 'zapret'
            put('strategy', o.opts_file)
            break
        case 'group':
            out.kind = 'group'
            put('members', o.members)
            put('pick', o.pick || 'order')
            put('default', o.pick === 'manual' ? o.default : undefined)
            if (o.pick === 'latency') {
                put('tolerance', o.tolerance)
                put('interval', o.interval)
                put('url', o.url)
                put('idle_timeout', o.idle_timeout)
            }
            put('weights', o.pick === 'balance' ? o.weights : undefined)
            put('ipv6', o.ipv6 === 'off' ? 'off' : undefined)
            break
    }
    put('on_fail', o.kind === 'direct' ? undefined : o.on_fail)
    put('over', o.over)
    if (o.kind === 'zapret' || o.kind === 'group') put('ipv6', o.ipv6 === 'off' ? 'off' : undefined)
    if (o.extra) for (const [k, v] of Object.entries(o.extra)) if (!(k in out)) out[k] = v
    return out
}

function encodeUpstream(u: Upstream): J {
    const out: J = { url: u.url }
    if (u.out) out.out = u.out
    if (u.ips?.length) out.ips = u.ips
    if (u.bootstrap?.length) out.bootstrap = u.bootstrap
    return out
}

function encodeDns(spec: Spec): J | undefined {
    const d = spec.dns || {}
    const out: J = {}
    if (d.mode) out.mode = d.mode
    if (spec.traceroute_hops) out.traceroute_hops = true
    if (d.cache !== undefined && d.cache > 0) out.cache = d.cache
    if (d.cache_ttl && Object.keys(d.cache_ttl).length) out.cache_ttl = d.cache_ttl
    if (d.bootstrap?.length) out.bootstrap = d.bootstrap
    if (d.upstream) out.upstream = d.upstream
    if (d.upstreams && Object.keys(d.upstreams).length) {
        const ups: J = {}
        for (const [k, v] of Object.entries(d.upstreams)) ups[k] = encodeUpstream(v)
        out.upstreams = ups
    }
    return Object.keys(out).length ? out : undefined
}

/** Модель интерфейса → спека v2 (объект; на диск уезжает JSON.stringify от него). */
export function encodeSpec(spec: Spec): J {
    const doc: J = { version: 2 }
    const devs = spec.lan_devices?.length ? spec.lan_devices : spec.lan_device ? [spec.lan_device] : []
    const lan: J = {}
    if (devs.length) lan.devices = devs
    if (spec.from_default?.length) lan.addr = spec.from_default
    if (Object.keys(lan).length) doc.lan = lan

    /* ---- выходы ---- */
    const outputs: J = {}
    const tail: [string, J][] = []
    const used = new Set<string>(Object.keys(spec.outputs || {}))
    for (const [name, o] of Object.entries(spec.outputs || {})) {
        const parts = Object.values(spec.outputs).filter((p) => p.part_of === name)
        const isPool = o.kind === 'interface' &&
            ((o.devices?.length ?? 0) > 1 || parts.length > 0 || !!o.pick)
        if (!isPool) {
            outputs[name] = encodeOutput(o)
            continue
        }
        const members: string[] = []
        ;(o.devices || (o.device ? [o.device] : [])).forEach((d, i) => {
            let m = `${name}.${d}`
            if (!NAME_OK.test(m) || used.has(m)) m = `${name}.${i + 1}`
            let k = 2
            while (used.has(m)) m = `${name}.${i + 1}_${k++}`
            used.add(m)
            members.push(m)
            tail.push([m, { kind: 'interface', device: d }])
        })
        const g: J = { kind: 'group', pick: o.pick === 'latency' ? 'latency' : 'order', members }
        if (g.pick === 'latency') {
            if (o.tolerance !== undefined) g.tolerance = o.tolerance
            if (o.interval !== undefined) g.interval = o.interval
            if (o.url) g.url = o.url
            if (o.idle_timeout !== undefined) g.idle_timeout = o.idle_timeout
        }
        if (o.on_fail) g.on_fail = o.on_fail
        if (o.extra) for (const [k, v] of Object.entries(o.extra)) if (!(k in g)) g[k] = v
        outputs[name] = g
    }
    for (const [m, v] of tail) outputs[m] = v
    if (Object.keys(outputs).length) doc.outputs = outputs

    /* ---- правила, списки, клиенты ---- */
    const rules: J[] = []
    const lists: Record<string, J> = {}
    const clients: Record<string, J> = {}
    const listName = makeNamer('l')
    const clientName = makeNamer('c')
    ;(spec.channels || []).forEach((ch, idx) => {
        const n = idx + 1
        let forRef: string | string[] | undefined
        if (ch.from?.length) {
            const macs = ch.from.filter((x) => MAC_RE.test(x))
            const addrs = ch.from.filter((x) => !MAC_RE.test(x))
            const names: string[] = []
            if (addrs.length) { const cn = clientName(ch.name, n); clients[cn] = { addr: addrs }; names.push(cn) }
            if (macs.length) { const cn = clientName(`${ch.name}_mac`, n); clients[cn] = { mac: macs }; names.push(cn) }
            /* Адреса вместе с MAC в одном правиле движок отвергает («разнесите по правилам»);
             * пишем как есть, чтобы отказ сказал это сам, а не терять часть клиентов молча. */
            forRef = names.length === 1 ? names[0] : names
        }
        const base = (over: Partial<J>): J => {
            const r: J = { name: ch.name }
            if (forRef) r.for = forRef
            Object.assign(r, over)
            r.out = ch.out
            if (ch.match.mode) r.resolve = ch.match.mode
            if (ch.dns) r.dns = typeof ch.dns === 'string' ? ch.dns : encodeUpstream(ch.dns)
            if (ch.enabled === false) r.enabled = false
            if (ch.scope === 'device') r.scope = 'device'
            return r
        }
        if (ch.match.any) {
            const nw = { proto: ch.match.proto, ports: ch.match.ports }
            if (narrowKey(nw)) {
                const ln = listName(ch.name, n)
                lists[ln] = { all: true, ...(nw.proto ? { proto: nw.proto } : {}), ...(nw.ports?.length ? { ports: nw.ports } : {}) }
                rules.push(base({ to: [ln] }))
            } else rules.push(base({ to: 'all' }))
            return
        }
        /* Файлы по ключу сужения: без сужения — само правило, с сужением — спутники. */
        type G = { n?: Narrow; pf: string[]; df: string[]; srs: string[] }
        const groups = new Map<string, G>()
        const grp = (f: string): G => {
            const k = narrowKey(ch.narrow?.[f])
            if (!groups.has(k)) groups.set(k, { n: k ? ch.narrow?.[f] : undefined, pf: [], df: [], srs: [] })
            return groups.get(k)!
        }
        for (const f of ch.match.prefixes_files || []) grp(f).pf.push(f)
        for (const f of ch.match.domains_files || []) grp(f).df.push(f)
        for (const f of ch.match.srs_files || []) grp(f).srs.push(f)
        const order = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0))
        order.forEach((k, gi) => {
            const g = groups.get(k)!
            const ln = listName(gi === 0 ? ch.name : `${ch.name}_${gi + 1}`, n)
            const l: J = {}
            if (g.pf.length) l.prefixes_file = g.pf
            if (g.df.length) l.domains_file = g.df
            if (g.srs.length) l.srs = g.srs
            if (g.n?.proto) l.proto = g.n.proto
            if (g.n?.ports?.length) l.ports = g.n.ports
            lists[ln] = l
            const r = base({ to: [ln] })
            if (gi > 0) r.name = gi === 1 ? S.specv2.porty(ch.name) : S.specv2.porty2(ch.name, gi)
            rules.push(r)
        })
    })
    if (Object.keys(clients).length) doc.clients = clients
    if (Object.keys(lists).length) doc.lists = lists
    const dns = encodeDns(spec)
    if (dns) doc.dns = dns
    if (rules.length) doc.rules = rules
    return doc
}

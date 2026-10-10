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
// IPv6 ПУЛА. Ключ `ipv6` ядро берёт у члена, а самолечение при apply пишет его каждому члену по его
// устройству (у одного есть адрес IPv6 — nat, у другого нет — off). Поэтому у пула он один (`ipv6`),
// пока у всех членов-интерфейсов одинаков, а когда разный или не у всех — по устройствам
// (`ipv6_by_device`): пул остаётся пулом, а не рассыпается на группу и выходы-члены после «Применить».
//
// СУЖЕНИЕ. Правило «подсети с портами» в v2 — отдельное правило со своим списком
// (`proto`/`ports` — свойство списка). Спутник в модели получает имя «<правило> (порты)»; при
// чтении правила с таким именем и тем же выходом складываются обратно в родителя.
//
// АДРЕСА И MAC. Клиентов разных видов в одном правиле ядро 2.0 не сводит («ещё не
// поддерживается: разнесите их по правилам»), поэтому правило модели с адресами и MAC пишется
// правилами подряд — по одному на вид, одинаковыми, кроме `for`, — а при чтении соседние правила
// с тем же именем и всем остальным, но с клиентами другого вида, склеиваются обратно.
//
// КЛЮЧИ, КОТОРЫХ МОДЕЛЬ НЕ ЗНАЕТ, доезжают обратно во всех разделах: `extra` у выхода, правила,
// апстрима, `dns`, `lan` и верхнего уровня; ключи списка (`override_port`…) — по его файлам
// (`file_extra`), и файлы с разными ключами расходятся по спутникам, как с разным сужением;
// список без файлов и клиент не из адресов и MAC (`uid`, `self` телефона…) — целиком
// (`raw_lists`, `raw_clients`). Ядро v2 незнакомый ключ отвергает, поэтому «незнакомый» здесь —
// знакомый ядру, но не модели: потерять его при правке соседнего правила значило бы молча
// поменять маршрутизацию.

import {
    insecureApplies,
    ipv6Of,
    isTunnelKind,
    normalizeSpec,
    poolIpv6,
    PROXY_KINDS,
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
    type UpstreamGroup,
    isUpstreamGroup,
} from '@/lib/model'

import { fragmentApplies } from '@/lib/dnsurl'
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

/** Ключи объекта, которых нет в `known`, — то, что модель не разбирает и пишет обратно как
 *  есть. Пусто — undefined, чтобы в модели не появлялось пустых `extra`. */
function rest(o: J, known: readonly string[]): J | undefined {
    const out: J = {}
    for (const [k, v] of Object.entries(o)) if (!known.includes(k)) out[k] = v
    return Object.keys(out).length ? out : undefined
}

/** Ключи разделов спеки v2, которые модель разбирает (src/model/v2.c). */
const TOP_KEYS = ['version', 'lan', 'clients', 'lists', 'outputs', 'dns', 'rules'] as const
const LAN_KEYS = ['devices', 'addr'] as const
const CLIENT_KEYS = ['addr', 'mac'] as const
const LIST_KEYS = ['srs', 'prefixes_file', 'domains_file', 'proto', 'ports', 'all'] as const
const RULE_KEYS = ['name', 'for', 'to', 'out', 'resolve', 'dns', 'enabled', 'scope'] as const
const DNS_KEYS = ['mode', 'cache', 'cache_ttl', 'upstream', 'upstreams', 'other', 'bootstrap', 'traceroute_hops'] as const
const UPSTREAM_KEYS = ['url', 'out', 'ips', 'bootstrap', 'fragment'] as const
const GROUP_KEYS = ['servers', 'mode'] as const
const OBFS_KEYS = ['mode', 'server', 'listen'] as const

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

/** Протоколы туннеля, которые модель интерфейса знает как свои виды выхода: vless, hysteria2 и
 *  прокси steer-proxy (trojan, shadowsocks, socks, http, vmess). Незнакомый протокол читается
 *  видом `tunnel` с протоколом как есть: прежде они читались как vless и уезжали обратно `protocol: vless` —
 *  туннель молча менял протокол при первом же сохранении любой правки. */
const OWN_TUNNEL = new Set<string>(['vless', 'hysteria2', ...PROXY_KINDS])

/** Режимы раздачи пула узлов — те же имена, что у `by` группы balance. */
const POOL_BY = ['connection', 'site', 'site_client'] as const
/** Умолчания ядра для пула узлов: их `steer spec convert` не печатает, не пишет и интерфейс. */
const POOL_INTERVAL = 60
const poolSilence = (kind: string) => (kind === 'hysteria2' ? 30 : 20)

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
        const ox = rest(o.obfs, OBFS_KEYS)
        if (ox) out.obfs.extra = ox
    }
    if (isTunnelKind(kind) || kind === 'tunnel') {
        const sub = str(take('subscription'))
        if (sub) out.sub_file = sub
        if (Array.isArray(o.nodes) && o.nodes.every((n) => Number.isInteger(n))) {
            used.add('nodes')
            if (o.nodes.length) out.nodes = o.nodes as number[]
        }
        /* Какие узлы не брать — у всех протоколов туннеля (spec-v2.md, «exclude и exclude_name»). */
        const ex = arr(take('exclude'))
        if (ex.length) out.exclude = ex
        const exn = arr(take('exclude_name'))
        if (exn.length) out.exclude_name = exn
        /* Пул узлов (spec-v2.md, «Пул узлов туннеля»): слежка — у всех протоколов, сколько узлов
         * сразу и раздача — у всех, кроме hysteria2: у него эти ключи ядро отвергает, и такие
         * (чужие) уезжают в extra и обратно как есть. Целое — в поле модели, иное — тоже как есть. */
        const int = (k: string) => Number.isInteger(o[k]) ? (take(k) as number) : undefined
        const iv = int('interval')
        if (iv !== undefined) out.interval = iv
        const si = int('silence')
        if (si !== undefined) out.silence = si
        if (kind !== 'hysteria2') {
            const ac = int('active')
            if (ac !== undefined) out.active = ac
            const by = str(o.by)
            if (by && (POOL_BY as readonly string[]).includes(by)) { used.add('by'); out.by = by as Output['by'] }
        }
    }
    /* insecure — только у видов с TLS; у остальных ядро ключ отвергает, и такой (чужой) ключ
     * уезжает в extra и обратно как есть, а не исчезает молча. */
    if (insecureApplies(kind) && typeof o.insecure === 'boolean') {
        used.add('insecure')
        if (o.insecure) out.insecure = true
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
        const by = str(take('by'))
        if (by) out.by = by as Output['by']
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

/** Группа серверов (`{ servers, mode }`); режим, которого модель не знает, остаётся в extra. */
function decodeGroup(u: J): UpstreamGroup {
    const out: UpstreamGroup = { servers: arr(u.servers) }
    const m = str(u.mode)
    if (m === 'race' || m === 'failover') out.mode = m
    const x = rest(u, GROUP_KEYS)
    if (m && !out.mode) (out.extra ??= {}).mode = u.mode
    if (x) out.extra = { ...(out.extra || {}), ...x }
    return out
}

function decodeUpstream(u: unknown): Upstream | UpstreamGroup | string | undefined {
    if (typeof u === 'string') return u
    if (!isObj(u)) return undefined
    if (Array.isArray(u.servers) && u.url === undefined) return decodeGroup(u)
    const out: Upstream = { url: String(u.url ?? '') }
    const o = str(u.out)
    if (o) out.out = o
    const ips = arr(u.ips)
    if (ips.length) out.ips = ips
    const bs = arr(u.bootstrap)
    if (bs.length) out.bootstrap = bs
    if (u.fragment === true) out.fragment = true
    const x = rest(u, UPSTREAM_KEYS)
    if (x) out.extra = x
    /* Не `true` и не `false` — чужое значение: пишется обратно как есть, а не теряется. */
    if (u.fragment !== undefined && typeof u.fragment !== 'boolean') (out.extra ??= {}).fragment = u.fragment
    return out
}

function decodeDns(d: J): DnsSpec | undefined {
    const out: DnsSpec = {}
    const mode = str(d.mode)
    if (mode === 'fakeip' || mode === 'realip') out.mode = mode
    const cache = num(d.cache)
    if (cache !== undefined) out.cache = cache
    /* cache_ttl — как есть: модель его не правит, а незнакомый ключ в нём тоже чей-то. */
    if (isObj(d.cache_ttl)) out.cache_ttl = { ...d.cache_ttl } as DnsSpec['cache_ttl']
    const up = str(d.upstream)
    if (up) out.upstream = up
    const other = str(d.other)
    if (other) out.other = other
    const bs = arr(d.bootstrap)
    if (bs.length) out.bootstrap = bs
    if (isObj(d.upstreams)) {
        const ups: Record<string, Upstream> = {}
        const groups: Record<string, UpstreamGroup> = {}
        for (const [k, v] of Object.entries(d.upstreams)) {
            const u = decodeUpstream(v)
            if (isUpstreamGroup(u)) groups[k] = u
            else if (u && typeof u !== 'string') ups[k] = u
        }
        if (Object.keys(ups).length) out.upstreams = ups
        if (Object.keys(groups).length) out.groups = groups
    }
    const x = rest(d, DNS_KEYS)
    if (x) out.extra = x
    return Object.keys(out).length ? out : undefined
}

/** Совпадают ли два правила во всём, кроме клиентов. */
function sameButClients(a: Channel, b: Channel): boolean {
    const strip = ({ from: _f, raw_clients: _r, ...x }: Channel) => JSON.stringify(x)
    return strip(a) === strip(b)
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
    /** Виды клиентов правила: a — адреса, m — MAC, x — клиенты как есть. */
    const kinds = new Map<Channel, Set<string>>()
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
            /* Клиент с ключом, которого модель не знает (uid, self, app телефона…), — целиком как
             * есть: разложить его по `from` значило бы потерять ключ, а правило — сузить. */
            if (rest(c, CLIENT_KEYS)) { (ch.raw_clients ||= {})[n] = c; continue }
            for (const a of arr(c.addr)) from.push(a)
            for (const m of arr(c.mac)) from.push(m)
        }
        if (from.length) ch.from = from
        const ks = new Set<string>()
        if (from.some((x) => MAC_RE.test(x))) ks.add('m')
        if (from.some((x) => !MAC_RE.test(x))) ks.add('a')
        if (ch.raw_clients) ks.add('x')
        kinds.set(ch, ks)
        const rx = rest(r, RULE_KEYS)
        if (rx) ch.extra = rx
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
            const lx = rest(l, LIST_KEYS)
            const files = [...arr(l.prefixes_file), ...arr(l.domains_file), ...arr(l.srs)]
            /* Список без файлов (встроенные domains/prefixes…) модель не выражает — целиком. */
            if (!files.length && l.all !== true) { (ch.raw_lists ||= {})[n] = l; continue }
            if (lx) {
                if (l.all === true) ch.all_extra = lx
                for (const f of files) (ch.file_extra ||= {})[f] = lx
            }
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
            for (const f of arr(l.srs)) { srs.push(f); if (narrowed) narrow[f] = nw }
        }
        if (pf.length) ch.match.prefixes_files = pf
        if (df.length) ch.match.domains_files = df
        if (srs.length) ch.match.srs_files = srs
        if (Object.keys(narrow).length) ch.narrow = narrow
        /* Правило, которое запись разнесла по видам клиентов (encodeSpec), — обратно в одно:
         * соседнее с тем же именем и всем остальным, но с клиентами другого вида. */
        const prev = channels[channels.length - 1]
        const pk = prev && kinds.get(prev)
        if (prev && pk && pk.size && ks.size && [...ks].every((k) => !pk.has(k)) && sameButClients(prev, ch)) {
            if (ch.from) prev.from = [...(prev.from || []), ...ch.from]
            if (ch.raw_clients) prev.raw_clients = { ...(prev.raw_clients || {}), ...ch.raw_clients }
            for (const k of ks) pk.add(k)
            return
        }
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
            if (ch.match.srs_files?.length)
                parent.match.srs_files = [...(parent.match.srs_files || []), ...ch.match.srs_files]
            if (ch.narrow) parent.narrow = { ...(parent.narrow || {}), ...ch.narrow }
            if (ch.file_extra) parent.file_extra = { ...(parent.file_extra || {}), ...ch.file_extra }
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
        /* Устройства частей пула: туннели по подписке (их устройство заводит ядро, адреса IPv6 у
         * него нет). Ключ `ipv6` их членам не пишется — ни панелью, ни самолечением (оно лечит
         * только устройства нашей зоны интерфейсов) — и при сборке пула в расчёт не идёт. Прежняя
         * панель писала `nat` всем членам пула, и таким членам он прощается: пул читается пулом,
         * а при следующей записи ключ у части уходит. */
        const partDevs = new Set(
            Object.values(outputs)
                .filter((o) => isTunnelKind(o.kind) && !o.part_of && !referenced.has(o.name))
                .map(deviceOf),
        )
        const ok = members.every((mn) => {
            const m = outputs[mn]
            return m && m.kind === 'interface' && mn.startsWith(`${gname}.`) && !!m.device &&
                (partDevs.has(m.device) ? !m.ipv6 || m.ipv6 === 'nat' : !m.ipv6 || m.ipv6 === 'nat' || m.ipv6 === 'off') &&
                !m.obfs && !m.over && !m.extra
        })
        if (!ok || g.default || g.weights) continue
        const devices = members.map((mn) => outputs[mn].device as string)
        const pool: Output = { name: gname, kind: 'interface', devices, device: devices[0] }
        /* `ipv6: nat` либо `off` у ВСЕХ членов-интерфейсов — ключ пула; ни у одного — пул без
         * ключа; разный или не у всех — по устройствам (`ipv6_by_device`), и пул остаётся пулом.
         * Разный он бывает, когда самолечение при apply записало каждому члену своё по его
         * устройству (у одного есть адрес IPv6, у другого нет), а у кого-то ключа нет вовсе —
         * решать самолечению было не ему (устройство в чужой зоне, ip6prefix): прежде такой пул
         * читался группой с членами-выходами, и после «Применить» человек видел, как его пул
         * меняет форму (из одной строки в «Выходах» — три). */
        const keyed = new Map<string, Output['ipv6']>()
        for (const mn of members) {
            const m = outputs[mn]
            if (!partDevs.has(m.device as string)) keyed.set(m.device as string, m.ipv6)
        }
        Object.assign(pool, poolIpv6([...keyed.keys()], (d) => keyed.get(d)))
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
            if (isTunnelKind(o.kind) && !o.part_of && !referenced.has(o.name) &&
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
    const lx = rest(lan, LAN_KEYS)
    if (lx) spec.lan_extra = lx
    const tx = rest(d, TOP_KEYS)
    if (tx) spec.extra = tx
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

/** `exclude` и `exclude_name` туннеля к записи: без пустых и повторов — их ядро отвергает
 *  целиком («указан дважды», пустая строка). Коды стран — заглавными, куски имени сравниваются
 *  без учёта регистра, как их сравнивает ядро. Пусто — ключа нет. */
function putExclude(out: J, o: Output) {
    const uniq = (list: string[] | undefined, norm: (s: string) => string, key: (s: string) => string) => {
        const seen = new Set<string>()
        const res: string[] = []
        for (const raw of list || []) {
            const v = norm(raw)
            if (!v || seen.has(key(v))) continue
            seen.add(key(v))
            res.push(v)
        }
        return res
    }
    const cc = uniq(o.exclude, (s) => s.trim().toUpperCase(), (s) => s)
    const nm = uniq(o.exclude_name, (s) => s.trim(), (s) => s.toLowerCase())
    if (cc.length) out.exclude = cc
    if (nm.length) out.exclude_name = nm
}

/** Пул узлов туннеля к записи: только отличное от умолчания, как печатает `steer spec convert`.
 *  `active` и `by` — не у hysteria2, `by` — только при `active` больше 1 (иначе ядро отвергает). */
function putPool(out: J, o: Output, proto: string) {
    if (proto !== 'hysteria2') {
        const many = typeof o.active === 'number' && o.active > 1
        if (many) out.active = o.active
        if (many && o.by && o.by !== 'connection') out.by = o.by
    }
    if (typeof o.interval === 'number' && o.interval !== POOL_INTERVAL) out.interval = o.interval
    if (typeof o.silence === 'number' && o.silence !== poolSilence(proto)) out.silence = o.silence
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
            put('obfs', o.obfs && encodeObfs(o.obfs))
            put('ipv6', o.ipv6)
            put('prefix', o.ipv6 === 'routed' ? o.prefix : undefined)
            break
        case 'vless':
        case 'hysteria2':
        case 'trojan':
        case 'shadowsocks':
        case 'socks':
        case 'http':
        case 'vmess': {
            out.kind = 'tunnel'
            out.protocol = o.kind
            put('subscription', o.sub_file)
            const nodes = o.nodes?.length ? o.nodes : typeof o.node === 'number' && o.node >= 0 ? [o.node] : []
            put('nodes', nodes)
            put('device', o.device)
            if (o.kind === 'vless' && o.transport?.length) put('transport', o.transport.length === 1 ? o.transport[0] : o.transport)
            if (o.insecure && insecureApplies(o.kind)) out.insecure = true
            putExclude(out, o)
            putPool(out, o, o.kind)
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
            putExclude(out, o)
            putPool(out, o, o.protocol || '')
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
            put('by', o.pick === 'balance' && o.by !== 'connection' ? o.by : undefined)
            put('ipv6', o.ipv6 === 'off' ? 'off' : undefined)
            break
    }
    put('on_fail', o.kind === 'direct' ? undefined : o.on_fail)
    put('over', o.over)
    if (o.kind === 'zapret' || o.kind === 'group') put('ipv6', o.ipv6 === 'off' ? 'off' : undefined)
    if (o.extra) for (const [k, v] of Object.entries(o.extra)) if (!(k in out)) out[k] = v
    return out
}

/** Незнакомые ключи — к записанному объекту, не перекрывая того, что модель записала сама. */
function withExtra(out: J, extra: J | undefined): J {
    if (extra) for (const [k, v] of Object.entries(extra)) if (!(k in out)) out[k] = v
    return out
}

function encodeObfs(o: NonNullable<Output['obfs']>): J {
    const { extra, ...known } = o
    return withExtra({ ...known }, extra)
}

function encodeUpstream(u: Upstream | UpstreamGroup): J {
    if (isUpstreamGroup(u)) {
        const g: J = { servers: u.servers }
        if (u.mode) g.mode = u.mode
        return withExtra(g, u.extra)
    }
    const out: J = { url: u.url }
    if (u.out) out.out = u.out
    if (u.ips?.length) out.ips = u.ips
    if (u.bootstrap?.length) out.bootstrap = u.bootstrap
    if (u.fragment && fragmentApplies(u.url)) out.fragment = true
    return withExtra(out, u.extra)
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
    if (d.other) out.other = d.other
    /* Серверы, затем группы — одной записью dns.upstreams (ядру порядок безразличен). */
    const ups: J = {}
    for (const [k, v] of Object.entries(d.upstreams || {})) ups[k] = encodeUpstream(v)
    for (const [k, v] of Object.entries(d.groups || {})) ups[k] = encodeUpstream(v)
    if (Object.keys(ups).length) out.upstreams = ups
    withExtra(out, d.extra)
    return Object.keys(out).length ? out : undefined
}

/** Модель интерфейса → спека v2 (объект; на диск уезжает JSON.stringify от него). */
export function encodeSpec(spec: Spec): J {
    const doc: J = { version: 2 }
    const devs = spec.lan_devices?.length ? spec.lan_devices : spec.lan_device ? [spec.lan_device] : []
    const lan: J = {}
    if (devs.length) lan.devices = devs
    if (spec.from_default?.length) lan.addr = spec.from_default
    withExtra(lan, spec.lan_extra)
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
            /* Ключ ipv6 берёт ядро у ЧЛЕНА (out_ipv6_mode_dev), а не у группы, где он допустим
             * только как off: пул с nat или off пишет его каждому члену-интерфейсу, а пул с
             * разным ipv6 (`ipv6_by_device`) — каждому своё, как записало самолечение; устройству
             * без записи ключа нет. Член — часть пула по подписке (устройство заводит ядро,
             * адреса IPv6 у него нет) — без ключа: `nat` на таком устройстве ядро встретило бы
             * отказом «нет адреса IPv6». */
            const v6 = ipv6Of(o, d)
            const own = (v6 === 'nat' || v6 === 'off') && !parts.some((p) => deviceOf(p) === d)
            tail.push([m, { kind: 'interface', device: d, ...(own ? { ipv6: v6 } : {}) }])
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
        /* Клиенты — наборами одного вида: адреса, MAC, клиенты как есть. Клиентов разных видов в
         * одном `for` ядро не сводит («ещё не поддерживается: разнесите их по правилам»), поэтому
         * правило с несколькими наборами уходит ядру несколькими правилами подряд — одинаковыми,
         * кроме `for`. По смыслу это то же правило: соседние правила с одним выходом, списками и
         * режимом забирают объединение своих клиентов. При чтении они склеиваются обратно. */
        const forSets: string[][] = []
        if (ch.from?.length) {
            const macs = ch.from.filter((x) => MAC_RE.test(x))
            const addrs = ch.from.filter((x) => !MAC_RE.test(x))
            if (addrs.length) { const cn = clientName(ch.name, n); clients[cn] = { addr: addrs }; forSets.push([cn]) }
            if (macs.length) { const cn = clientName(`${ch.name}_mac`, n); clients[cn] = { mac: macs }; forSets.push([cn]) }
        }
        const raw = Object.entries(ch.raw_clients || {}).map(([rn, c]) => {
            const cn = clientName(rn, n)
            clients[cn] = c
            return cn
        })
        if (raw.length) forSets.push(raw)
        /* Списки, которых модель не выражает файлами, — к первому правилу канала, под своими
         * именами (занятое получает хвост). */
        const rawNames = Object.entries(ch.raw_lists || {}).map(([ln, l]) => {
            const nm = listName(ln, n)
            lists[nm] = l
            return nm
        })
        const base = (over: Partial<J>, forRef?: string[]): J => {
            const r: J = { name: ch.name }
            if (forRef) r.for = forRef.length === 1 ? forRef[0] : forRef
            Object.assign(r, over)
            r.out = ch.out
            if (ch.match.mode) r.resolve = ch.match.mode
            if (ch.dns) r.dns = typeof ch.dns === 'string' ? ch.dns : encodeUpstream(ch.dns)
            if (ch.enabled === false) r.enabled = false
            if (ch.scope === 'device') r.scope = 'device'
            return withExtra(r, ch.extra)
        }
        /* Одно правило модели — по правилу ядра на каждый набор клиентов (см. выше). */
        const push = (over: Partial<J>, name?: string) => {
            for (const fs of forSets.length ? forSets : [undefined]) {
                const r = base(over, fs)
                if (name) r.name = name
                rules.push(r)
            }
        }
        if (ch.match.any) {
            const nw = { proto: ch.match.proto, ports: ch.match.ports }
            if (narrowKey(nw) || ch.all_extra) {
                const ln = listName(ch.name, n)
                lists[ln] = withExtra({ all: true, ...(nw.proto ? { proto: nw.proto } : {}), ...(nw.ports?.length ? { ports: nw.ports } : {}) }, ch.all_extra)
                push({ to: [ln, ...rawNames] })
            } else push({ to: rawNames.length ? ['all', ...rawNames] : 'all' })
            return
        }
        /* Файлы по свойствам списка: сужению и ключам, которых модель не знает. Без них — само
         * правило, с ними — спутники: ядро не сводит в одно правило списки с разными
         * proto/ports/override_port. */
        type G = { n?: Narrow; x?: J; pf: string[]; df: string[]; srs: string[] }
        const groups = new Map<string, G>()
        const grp = (f: string): G => {
            const x = ch.file_extra?.[f]
            const k = narrowKey(ch.narrow?.[f]) + (x ? `|${JSON.stringify(x)}` : '')
            if (!groups.has(k)) groups.set(k, { n: narrowKey(ch.narrow?.[f]) ? ch.narrow?.[f] : undefined, x, pf: [], df: [], srs: [] })
            return groups.get(k)!
        }
        for (const f of ch.match.prefixes_files || []) grp(f).pf.push(f)
        for (const f of ch.match.domains_files || []) grp(f).df.push(f)
        for (const f of ch.match.srs_files || []) grp(f).srs.push(f)
        const order = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0))
        if (!order.length && rawNames.length) push({ to: rawNames })
        order.forEach((k, gi) => {
            const g = groups.get(k)!
            const ln = listName(gi === 0 ? ch.name : `${ch.name}_${gi + 1}`, n)
            const l: J = {}
            if (g.pf.length) l.prefixes_file = g.pf
            if (g.df.length) l.domains_file = g.df
            if (g.srs.length) l.srs = g.srs
            if (g.n?.proto) l.proto = g.n.proto
            if (g.n?.ports?.length) l.ports = g.n.ports
            lists[ln] = withExtra(l, g.x)
            push({ to: gi === 0 ? [ln, ...rawNames] : [ln] },
                gi === 0 ? undefined : gi === 1 ? S.specv2.porty(ch.name) : S.specv2.porty2(ch.name, gi))
        })
    })
    if (Object.keys(clients).length) doc.clients = clients
    if (Object.keys(lists).length) doc.lists = lists
    const dns = encodeDns(spec)
    if (dns) doc.dns = dns
    if (rules.length) doc.rules = rules
    withExtra(doc, spec.extra)
    return doc
}

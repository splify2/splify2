import { S } from '@/copy'
import { devList, insecureApplies, isPart, isProxyKind, type Output, type OutputStatus, type Spec } from '@/lib/model'

/** Бейджи конфигурации узла и выхода: протокол, транспорт, защита и особенности.
 *
 *  Человек выбирает узел и смотрит на выход, не зная, что за ними стоит: «Германия №2» ничего не
 *  говорит о том, VLESS это или Hysteria2, gRPC или XHTTP, Reality или голый TLS. Ядро это знает и
 *  печатает в узле (`vless-nodes`, `hysteria2-nodes`, `proxy-nodes`: vlmain.c, hy2main.c, pxmain.c
 *  `node_json`) и в состоянии выхода (`steer status`: объекты `hysteria2`, `proxy`, ключ
 *  `insecure`). Здесь — ОДИН разбор этих полей в бейджи, чтобы строка узла в редакторе выхода,
 *  строка выхода в «Выходах» и локация на главной говорили одно и то же одними словами.
 *
 *  ПОДПИСИ — ИМЕНА, А НЕ ПОЯСНЕНИЯ. VLESS, gRPC, XHTTP, Reality, BBR — общепринятые названия, под
 *  которыми их знают продавец подписки и любой клиент; переводить их значило бы назвать вещь
 *  иначе, чем её зовут везде. Поэтому таблица имён живёт здесь, а не в словаре интерфейса. Слова
 *  по-русски (состояние: «сертификат не проверяется», «смена портов») — из словаря, S.badges.
 *
 *  ПОРЯДОК ПОСТОЯННЫЙ: протокол → транспорт → защита → особенности. Глаз находит «XHTTP» на
 *  одном и том же месте в каждой строке, и две строки сравниваются, не читая.
 *
 *  ЦВЕТ — только у протокола (категориальная шкала Andromeda --an-cat-*): это то, по чему строки
 *  различают с первого взгляда. Остальное нейтральное; «сертификат не проверяется» — цветом
 *  предупреждения, потому что это решение человека, которое стоит видеть. */

/** Протокол, у которого есть свой тон. */
export type ProtoId =
    | 'vless' | 'hysteria2' | 'trojan' | 'shadowsocks' | 'vmess' | 'socks' | 'http'
    | 'xsteer' | 'wireguard' | 'awg'

/** Место бейджа в строке — оно же порядок. */
export type BadgeGroup = 'proto' | 'transport' | 'security' | 'feature'

export interface ConfBadge {
    /** Устойчивый ключ: по нему бейджи сравниваются (общие у нескольких узлов) и рисуются. */
    id: string
    text: string
    group: BadgeGroup
    /** Только у протокола: какой тон. */
    proto?: ProtoId
    /** Предупреждение (сертификат не проверяется). */
    warn?: boolean
}

/** Имена протоколов — как их называют везде. */
export const PROTO_NAME: Record<ProtoId, string> = {
    vless: 'VLESS',
    hysteria2: 'Hysteria2',
    trojan: 'Trojan',
    shadowsocks: 'Shadowsocks',
    vmess: 'VMess',
    socks: 'SOCKS',
    http: 'HTTP',
    xsteer: 'xsteer',
    wireguard: 'WireGuard',
    awg: 'AmneziaWG',
}

/** Тон протокола: номер категориального цвета Andromeda (--an-cat-N). Своих туннелей
 *  (WireGuard, AmneziaWG) один тон — это одно семейство; SOCKS и HTTP — серый cat-7: прокси без
 *  своего шифрования, выделять их цветом незачем. */
export const PROTO_TONE: Record<ProtoId, number> = {
    vless: 1,
    hysteria2: 4,
    trojan: 6,
    shadowsocks: 2,
    vmess: 3,
    socks: 7,
    http: 7,
    xsteer: 3,
    wireguard: 5,
    awg: 5,
}

/** Транспорты: поле `type` узла VLESS (tcp | grpc | xhttp | ws | httpupgrade, vless.h) и
 *  `transport` узла прокси. Незнакомый (ядро новее интерфейса) показывается как пришёл. */
const TRANSPORT_NAME: Record<string, string> = {
    tcp: 'TCP',
    raw: 'TCP',
    grpc: 'gRPC',
    xhttp: 'XHTTP',
    splithttp: 'XHTTP',
    ws: 'WebSocket',
    httpupgrade: 'HTTPUpgrade',
    h2: 'HTTP/2',
    quic: 'QUIC',
    kcp: 'mKCP',
}

/** Режимы xhttp, которые стоит назвать: `auto` — умолчание, о нём молчим. */
const XHTTP_MODES = new Set(['packet-up', 'stream-up', 'stream-one'])

/** Обфускация hysteria2: поле `obfs` узла и состояния. */
const OBFS_NAME: Record<string, string> = { salamander: 'Salamander', gecko: 'Gecko' }

/** Шифры shadowsocks — поле `method` узла (если ядро его печатает). */
const CIPHER_NAME: Record<string, string> = {
    'aes-128-gcm': 'AES-128-GCM',
    'aes-192-gcm': 'AES-192-GCM',
    'aes-256-gcm': 'AES-256-GCM',
    'chacha20-poly1305': 'ChaCha20-Poly1305',
    'chacha20-ietf-poly1305': 'ChaCha20-Poly1305',
    'xchacha20-poly1305': 'XChaCha20-Poly1305',
    'xchacha20-ietf-poly1305': 'XChaCha20-Poly1305',
}

/** Узел подписки, как его печатает ядро. Все поля необязательны: у VLESS, hysteria2 и прокси они
 *  разные, а ядро постарше печатает не все. */
export interface NodeConf {
    type?: string
    /** Прокси: транспорт (у VLESS он в `type`). */
    transport?: string
    security?: string
    vision?: boolean
    /** grpc: multi/gun; xhttp: auto/packet-up/stream-up/stream-one. */
    mode?: string
    /** VLESS: режим шифрования (первые три токена, без ключей). */
    encryption?: string
    /** Reality: проверка подписи ML-DSA-65. */
    pqv?: boolean
    /** hysteria2: '' | salamander | gecko. */
    obfs?: string
    pinned?: boolean
    insecure?: boolean
    hop?: boolean
    up_bps?: number
    down_bps?: number
    /** shadowsocks: шифр. */
    method?: string
}

function protoOf(p: string | undefined | null): ProtoId | null {
    if (!p) return null
    const k = p.toLowerCase()
    if (k === 'ss') return 'shadowsocks'
    if (k === 'amneziawg') return 'awg'
    return k in PROTO_NAME ? (k as ProtoId) : null
}

function protoBadge(p: ProtoId): ConfBadge {
    return { id: `proto:${p}`, text: PROTO_NAME[p], group: 'proto', proto: p }
}

const tag = (group: BadgeGroup, id: string, text: string): ConfBadge => ({ id: `${group}:${id}`, text, group })
const insecureBadge = (): ConfBadge => ({
    id: 'feature:insecure', text: S.badges.sertifikatNeProveryaetsya, group: 'feature', warn: true,
})

/** Шифр shadowsocks: «2022» отдельной пометкой и сам шифр коротким именем. */
function cipherBadges(method: string | undefined): ConfBadge[] {
    const m = (method || '').trim().toLowerCase()
    if (!m) return []
    const out: ConfBadge[] = []
    let rest = m
    if (m.startsWith('2022-')) {
        out.push(tag('feature', 'ss2022', '2022'))
        rest = m.replace(/^2022-blake3-/, '').replace(/^2022-/, '')
    }
    if (rest === 'none' || rest === 'plain') out.push(tag('security', 'plain', S.badges.bezShifrovaniya))
    else out.push(tag('feature', `cipher:${rest}`, CIPHER_NAME[rest] || method!.trim()))
    return out
}

function transportBadge(t: string | undefined): ConfBadge | null {
    const k = (t || '').trim().toLowerCase()
    if (!k) return null
    return tag('transport', TRANSPORT_NAME[k] ? TRANSPORT_NAME[k].toLowerCase() : k, TRANSPORT_NAME[k] || t!.trim())
}

/** Бейджи узла подписки.
 *
 *  `proto` — протокол, если его знает вызывающий (редактор выхода знает, каким клиентом спросил
 *  узлы); нет — по полю `type` (у прокси и hysteria2 оно называет протокол), иначе VLESS.
 *  `insecure` — у выхода стоит «не проверять сертификат»: ядро печатает признак у узла hysteria2,
 *  а у VLESS он берётся из выхода и касается только узлов с TLS. */
export function nodeBadges(
    n: NodeConf | null | undefined,
    proto?: string | null,
    opts: { insecure?: boolean } = {},
): ConfBadge[] {
    if (!n) return []
    const p: ProtoId = protoOf(proto) || protoOf(n.type) || 'vless'
    const out: ConfBadge[] = [protoBadge(p)]
    const sec = (n.security || '').toLowerCase()

    if (p === 'hysteria2') {
        /* Hysteria2 — всегда QUIC с TLS, называть это у каждого узла незачем. Различают узлы
         * обфускация, смена портов и управление перегрузкой: полоса задана — Brutal, нет — BBR. */
        if (n.obfs && OBFS_NAME[n.obfs]) out.push(tag('feature', `obfs:${n.obfs}`, OBFS_NAME[n.obfs]))
        else if (n.obfs) out.push(tag('feature', `obfs:${n.obfs}`, n.obfs))
        if (n.hop) out.push(tag('feature', 'hop', S.badges.smenaPortov))
        if (n.up_bps !== undefined || n.down_bps !== undefined) {
            out.push((n.up_bps || 0) > 0 || (n.down_bps || 0) > 0 ? tag('feature', 'cc:brutal', 'Brutal') : tag('feature', 'cc:bbr', 'BBR'))
        }
        if (n.pinned) out.push(tag('feature', 'pinned', S.badges.sertifikatZakreplyon))
        if (n.insecure || opts.insecure) out.push(insecureBadge())
        return sortBadges(out)
    }

    /* Транспорт: у VLESS — `type`, у прокси — `transport`. У shadowsocks, SOCKS и HTTP транспорт
     * один (TCP), и «TCP» на каждом узле был бы шумом; у VLESS, Trojan и VMess это выбор продавца. */
    const tr = p === 'vless' ? n.type : n.transport
    const trLower = (tr || '').toLowerCase()
    if (p === 'vless' || p === 'trojan' || p === 'vmess' || (trLower && trLower !== 'tcp' && trLower !== 'raw')) {
        const b = transportBadge(tr)
        if (b) out.push(b)
    }
    if ((trLower === 'xhttp' || trLower === 'splithttp') && n.mode && XHTTP_MODES.has(n.mode)) {
        out.push(tag('transport', `mode:${n.mode}`, n.mode))
    }

    /* Защита. «Без шифрования» — только там, где шифрования действительно нет: у shadowsocks и
     * VMess оно своё и без TLS, у VLESS — при режиме encryption. */
    const pq = !!n.pqv || /^mlkem/i.test(n.encryption || '')
    if (sec === 'reality') out.push(tag('security', 'reality', 'Reality'))
    else if (sec === 'tls') out.push(tag('security', 'tls', 'TLS'))
    else if (
        (sec === 'none' || sec === '') &&
        n.security !== undefined &&
        p !== 'shadowsocks' && p !== 'vmess' && !(p === 'vless' && n.encryption)
    ) out.push(tag('security', 'plain', S.badges.bezShifrovaniya))

    if (n.vision) out.push(tag('feature', 'vision', 'Vision'))
    if (pq) out.push(tag('feature', 'pq', S.badges.postkvantovoe))
    if (p === 'shadowsocks') out.push(...cipherBadges(n.method))
    /* Сертификат не проверяется: признак узла (если ядро его печатает) или выхода — и только у
     * узла с TLS: у Reality и у узла без TLS проверять нечего. */
    if (n.insecure || (opts.insecure && sec === 'tls')) out.push(insecureBadge())
    return sortBadges(out)
}

/** Бейджи, общие у всех узлов набора: «любая рабочая» из подписки, где все узлы VLESS по
 *  XHTTP с Reality, — это VLESS · XHTTP · Reality, а у смешанной остаётся только то, что
 *  правда про любой узел, который возьмёт ядро. Порядок — по первому узлу. */
export function commonBadges(sets: ConfBadge[][]): ConfBadge[] {
    if (!sets.length) return []
    const [first, ...rest] = sets
    return first.filter((b) => rest.every((s) => s.some((x) => x.id === b.id)))
}

/** Вид устройства (DEVTYPE из метода `devices`) → протокол своего туннеля. */
export function devProto(kind: string | undefined | null): ProtoId | null {
    const k = (kind || '').toLowerCase()
    return k === 'wireguard' ? 'wireguard' : k === 'amneziawg' || k === 'awg' ? 'awg' : null
}

/** Виды устройств из ответа метода `devices`, только те, что дают бейдж (WireGuard, AmneziaWG).
 *  null — таких нет: вызывающий тогда не трогает состояние (лишняя перерисовка ради пустого). */
export function devKindsOf(devices: { name: string; kind?: string }[] | undefined): Record<string, string> | null {
    const m = Object.fromEntries((devices || []).filter((d) => devProto(d.kind)).map((d) => [d.name, d.kind as string]))
    return Object.keys(m).length ? m : null
}

/** Протокол выхода по спеке и состоянию: вид выхода, `protocol` туннеля спеки v2, протокол
 *  клиента прокси из `steer status`. Выход-интерфейс — по виду своего устройства, если известен. */
export function outputProto(
    o: Pick<Output, 'kind' | 'protocol'> | undefined | null,
    st?: Pick<OutputStatus, 'kind' | 'proxy'> | null,
    devKind?: string | null,
): ProtoId | null {
    const k = o?.kind || st?.kind
    if (k === 'vless' || k === 'hysteria2' || k === 'xsteer') return k
    if (k === 'awg') return 'awg'
    if (isProxyKind(k)) return k
    if (k === 'tunnel') return protoOf(o?.protocol) || protoOf(st?.proxy?.protocol)
    if (k === 'interface') return devProto(devKind)
    return protoOf(st?.proxy?.protocol)
}

/** Бейджи выхода.
 *
 *  `nodes` — узлы, которые выход может взять (выбранные, а без выбора — все пригодные), либо
 *  один узел, который он держит сейчас: из них берутся общие бейджи. Узлов не знаем — только
 *  то, что сказано в спеке и состоянии: протокол, фильтр транспорта, обфускация и управление
 *  перегрузкой hysteria2 из `steer status`, проверка сертификата. */
export function outputBadges({
    out, st, nodes, devKind,
}: {
    out?: Output | null
    st?: OutputStatus | null
    nodes?: NodeConf[] | null
    devKind?: string | null
}): ConfBadge[] {
    const p = outputProto(out, st, devKind)
    const kind = out?.kind || st?.kind
    const insecure = !!st?.insecure || !!(out?.insecure && insecureApplies(kind))
    if (!p) {
        const res: ConfBadge[] = []
        if (kind === 'interface' && out?.obfs) res.push(tag('feature', 'faketcp', S.badges.poddelnyyTcp))
        return res
    }
    let res: ConfBadge[]
    /* Предупреждение о сертификате при известных узлах — по узлам: ядро не проверяет сертификат
     * только у узлов с TLS, у Reality проверять нечего. Хоть у одного кандидата — значит может
     * случиться, и сказать надо (это объединение, а не пересечение). */
    let warnOf = insecure
    if (nodes && nodes.length) {
        const sets = nodes.map((n) => nodeBadges(n, p, { insecure }))
        res = commonBadges(sets).filter((b) => b.id !== 'feature:insecure')
        warnOf = sets.some((l) => l.some((b) => b.id === 'feature:insecure'))
    } else {
        res = [protoBadge(p)]
        /* Фильтр транспорта выхода VLESS: ядро возьмёт узел только с этими транспортами. */
        if (p === 'vless') {
            for (const t of out?.transport || []) {
                const b = transportBadge(t)
                if (b && !res.some((x) => x.id === b.id)) res.push(b)
            }
        }
    }
    /* Hysteria2 под клиентом: что он сам сообщает о соединении — это точнее подписки. */
    const hy = st?.hysteria2
    if (p === 'hysteria2' && hy) {
        const add = (b: ConfBadge) => { if (!res.some((x) => x.id === b.id)) res.push(b) }
        if (hy.obfs) add(tag('feature', `obfs:${hy.obfs}`, OBFS_NAME[hy.obfs] || hy.obfs))
        if (hy.hop) add(tag('feature', 'hop', S.badges.smenaPortov))
        if (hy.cc) {
            const cc = hy.cc.toLowerCase()
            res = res.filter((x) => !x.id.startsWith('feature:cc:'))
            res.push(tag('feature', `cc:${cc}`, cc === 'brutal' ? 'Brutal' : cc === 'bbr' ? 'BBR' : hy.cc))
        }
    }
    if (kind === 'interface' && out?.obfs) res.push(tag('feature', 'faketcp', S.badges.poddelnyyTcp))
    if (warnOf) res.push(insecureBadge())
    return sortBadges(res)
}

/** Бейджи пула: протоколы его строк (части-подписки и свои туннели) без повторов и общая
 *  отметка «сертификат не проверяется», если она есть хоть у одной части. */
export function poolBadges(
    spec: Spec | null | undefined,
    name: string,
    devKinds: Record<string, string> = {},
): ConfBadge[] {
    const o = spec?.outputs?.[name]
    if (!o) return []
    if (o.kind !== 'interface') return outputBadges({ out: o })
    const devs = devList(o)
    if (devs.length < 2 && !devs.some((d) => isPart(spec?.outputs?.[d]))) {
        return outputBadges({ out: o, devKind: devs[0] ? devKinds[devs[0]] : null })
    }
    const res: ConfBadge[] = []
    let insecure = false
    for (const d of devs) {
        /* Устройство части или выхода спеки называется его именем (устройство из имени выхода),
         * либо записано в нём явно. */
        const owner = Object.entries(spec?.outputs || {}).find(
            ([n, x]) => x.kind !== 'interface' && (n === d || devList(x).includes(d)),
        )?.[1]
        const p = owner ? outputProto(owner) : devProto(devKinds[d])
        if (owner?.insecure && insecureApplies(owner.kind)) insecure = true
        if (p && !res.some((x) => x.proto === p)) res.push(protoBadge(p))
    }
    if (o.obfs) res.push(tag('feature', 'faketcp', S.badges.poddelnyyTcp))
    if (insecure) res.push(insecureBadge())
    return res
}

const ORDER: Record<BadgeGroup, number> = { proto: 0, transport: 1, security: 2, feature: 3 }

/** Особенности — тоже в постоянном порядке, откуда бы ни пришли (узел подписки или состояние
 *  клиента): обфускация, смена портов, управление перегрузкой, Vision, постквантовое, 2022, шифр,
 *  сертификат закреплён. */
const FEATURE_ORDER = ['obfs:', 'hop', 'cc:', 'vision', 'pq', 'ss2022', 'cipher:', 'faketcp', 'pinned']
const featRank = (b: ConfBadge) => {
    if (b.group !== 'feature') return 0
    const id = b.id.slice('feature:'.length)
    const i = FEATURE_ORDER.findIndex((p) => id === p || (p.endsWith(':') && id.startsWith(p)))
    return i < 0 ? FEATURE_ORDER.length : i
}

/** Протокол → транспорт → защита → особенности. Предупреждение — последним: оно читается после
 *  того, что о выходе сказано. */
export function sortBadges(list: ConfBadge[]): ConfBadge[] {
    return list
        .map((b, i) => ({ b, i }))
        .sort((x, y) =>
            ORDER[x.b.group] - ORDER[y.b.group] || Number(!!x.b.warn) - Number(!!y.b.warn) ||
            featRank(x.b) - featRank(y.b) || x.i - y.i)
        .map((x) => x.b)
}

/** Ответ `*-nodes` по выходу — в том объёме, что нужен бейджам. */
export interface NodesReplyLike {
    nodes?: (NodeConf & { index: number; name?: string })[]
    chosen?: number[]
    node?: number
}

/** Какие узлы выход может взять: тот, что держит сейчас (клиенты hysteria2 и прокси называют его
 *  в `steer status`), иначе выбранные человеком, а без выбора — все пригодные. */
export function outNodes(r: NodesReplyLike | null | undefined, current?: string | null): NodeConf[] {
    const all = r?.nodes || []
    if (current) {
        const n = all.find((x) => x.name === current)
        if (n) return [n]
    }
    const want = r?.chosen?.length ? r.chosen : typeof r?.node === 'number' && r.node >= 0 ? [r.node] : []
    if (want.length) {
        const picked = all.filter((x) => want.includes(x.index))
        if (picked.length) return picked
    }
    return all
}

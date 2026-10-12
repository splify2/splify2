import { DIRECT, isPart, isTunnelKind, type Output, type ProxyKind, type Spec } from '@/lib/model'
import { outputUsers } from '@/lib/outrefs'
import { directDomains } from '@/lib/rulefiles'

/** Выход правила в приложении для компьютера: «на одно правило — один выход (набор)».
 *
 *  Отдельного списка выходов там нет: в правиле, в блоке «Куда», человек отмечает пилюлями
 *  конфигурации подписок, WARP и свои туннели и выбирает режим у подписок и своих туннелей. Здесь —
 *  как этот выбор ложится в спеку и обратно.
 *
 *  ОБЩИЙ ИЛИ СВОЙ. Два правила с одинаковым набором держат один выход: набор сравнивается по
 *  содержимому (`shape`), без имён служебных частей. Правка набора у правила, которое делит выход с
 *  другими, разводит его: правилу заводится свой выход, у остальных всё остаётся как было. Набор
 *  совпал с чужим — правило переходит на чужой, а его прежний выход, никому больше не нужный,
 *  убирается вместе с частями.
 *
 *  КАК РЕЖИМ ЛОЖИТСЯ В ЯДРО (spec-v2.md). Внутри туннеля по подписке ядро умеет «первый живой»
 *  (`nodes` по порядку) и раздачу (`active` + `by`, кроме hysteria2). «Самый быстрый» — пул из
 *  частей по узлу (`pick: latency`), раздача по разным подпискам и протоколам — группа `balance`
 *  над частями, «вручную» — один узел (`node`). Свои туннели: пул устройств (`order`/`latency`),
 *  одно устройство, раздача — группа над частями-интерфейсами. Несколько блоков сразу — группа
 *  `order` над ними в порядке блоков: подписки, WARP, свои туннели. */

export type Mode = 'latency' | 'order' | 'manual' | 'balance'
export type Proto = 'vless' | 'hysteria2' | ProxyKind

/** Взятая конфигурация подписки: узел протокола (`idx` — номер среди узлов этого протокола) или,
 *  без `idx`, «Авто» — любые узлы протокола, первый живой. */
export interface SubPick {
    sub: string
    proto: Proto
    idx?: number
}

export interface Target {
    direct: boolean
    /** Блок: трафик правила не пропускается (выход `kind: block`). */
    block?: boolean
    subs: { mode: Mode; picks: SubPick[] }
    /** Выходы WARP: пилюля — конфигурация целиком, свой выбор узла у неё внутри. */
    warp: string[]
    /** Свои туннели: устройство (`dev:wg0`) либо выход своего туннеля (`out:<имя>`, awg и xsteer). */
    own: { mode: Mode; picks: string[] }
}

export const EMPTY_TARGET: Target = { direct: false, block: false, subs: { mode: 'order', picks: [] }, warp: [], own: { mode: 'order', picks: [] } }

/** Виды, которые правило не переписывает и не убирает: у них регистрация, ключи или настройка
 *  человека вне правила. */
const KEEP = new Set(['direct', 'block', 'warp', 'zapret', 'tgws', 'xsteer', 'awg'])
const kept = (o: Output | undefined) => !o || KEEP.has(o.kind as string)

const NAME_MAX = 15

export const subPickKey = (p: SubPick) => `${p.sub}|${p.proto}|${p.idx ?? '*'}`

/* ------------------------------------------------------------------ сравнение */

const deviceOf = (o: Output) => o.device || o.name.slice(0, NAME_MAX)

/** Часть пула `pool` на устройстве `dev`. */
function partOn(outs: Record<string, Output>, pool: string, dev: string): string | undefined {
    return Object.values(outs).find((p) => p.part_of === pool && deviceOf(p) === dev)?.name
}

function stable(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
    if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>
        return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
    }
    return JSON.stringify(v)
}

/** Содержимое выхода без имён служебных частей — то, по чему два набора считаются одним. */
export function shape(outs: Record<string, Output>, name: string, depth = 0): string {
    const o = outs[name]
    if (!o || depth > 8) return `?${name}`
    /* Выход, который правило не собирает (WARP, свой туннель), — это он сам, а не его содержимое. */
    if (KEEP.has(o.kind as string)) return `=${name}`
    const { name: _n, part_of: _p, device, devices, members, default: def, on_fail, pick, ...rest } = o
    const r: Record<string, unknown> = { ...rest, on_fail: on_fail ?? 'drop' }
    if (o.kind === 'interface') {
        const ds = devices?.length ? devices : device ? [device] : []
        r.devices = ds.map((d) => {
            const p = partOn(outs, name, d)
            return p ? shape(outs, p, depth + 1) : `dev:${d}`
        })
        if (pick && pick !== 'order') r.pick = pick
    } else {
        if (device) r.device = device
        if (pick) r.pick = pick
    }
    if (members) r.members = members.map((m) => shape(outs, m, depth + 1))
    if (def) r.default = shape(outs, def, depth + 1)
    return stable(r)
}

/* ------------------------------------------------------------------ спека → выбор */

const nodesOf = (o: Output): number[] =>
    o.nodes?.length ? o.nodes : typeof o.node === 'number' && o.node >= 0 ? [o.node] : []

function subPicksOf(o: Output): SubPick[] {
    const proto = o.kind as Proto
    const ns = nodesOf(o)
    return ns.length ? ns.map((idx) => ({ sub: o.sub_file || '', proto, idx })) : [{ sub: o.sub_file || '', proto }]
}

/** Что внутри выхода — подписки или свои туннели. `null` — выход собран не правилом (руками или
 *  прежней панелью) и блоком «Куда» не читается. */
type Section = { kind: 'subs'; mode: Mode; picks: SubPick[] } | { kind: 'own'; mode: Mode; picks: string[] } | { kind: 'warp'; out: string }

function sectionOf(outs: Record<string, Output>, name: string): Section | null {
    const o = outs[name]
    if (!o) return null
    if (o.kind === ('warp' as Output['kind'])) return { kind: 'warp', out: name }
    if (o.kind === 'awg' || o.kind === 'xsteer') return { kind: 'own', mode: 'manual', picks: [`out:${name}`] }
    if (isTunnelKind(o.kind)) {
        /* Один узел — «вручную»: ядру это то же, что «первый живой» из одного. */
        const mode: Mode = o.pick === 'latency' ? 'latency' : (o.active ?? 1) > 1 ? 'balance' : nodesOf(o).length === 1 ? 'manual' : 'order'
        return { kind: 'subs', mode, picks: subPicksOf(o) }
    }
    if (o.kind === 'interface') {
        const ds = o.devices?.length ? o.devices : o.device ? [o.device] : []
        const parts = ds.map((d) => partOn(outs, name, d))
        const mode: Mode = o.pick === 'latency' ? 'latency' : 'order'
        if (parts.every(Boolean) && parts.length) {
            return { kind: 'subs', mode, picks: parts.flatMap((p) => subPicksOf(outs[p!])) }
        }
        if (parts.some(Boolean)) return null
        return { kind: 'own', mode: !o.devices?.length && !o.pick ? 'manual' : mode, picks: ds.map((d) => `dev:${d}`) }
    }
    if (o.kind === 'group' && (o.pick === 'balance' || o.pick === 'order' || o.pick === 'latency')) {
        const ms = (o.members || []).map((m) => outs[m])
        if (!ms.length || ms.some((m) => !m)) return null
        if (ms.every((m) => isTunnelKind(m.kind))) {
            return { kind: 'subs', mode: o.pick === 'balance' ? 'balance' : o.pick, picks: ms.flatMap(subPicksOf) }
        }
        if (ms.every((m) => (m.kind === 'interface' && !m.devices?.length && m.device) || m.kind === 'awg' || m.kind === 'xsteer')) {
            return {
                kind: 'own',
                mode: o.pick === 'balance' ? 'balance' : o.pick,
                picks: ms.map((m) => (m.kind === 'interface' ? `dev:${m.device}` : `out:${m.name}`)),
            }
        }
    }
    return null
}

/** Выбор блока «Куда» по выходу правила. `null` — выход собран не правилом: блок покажет его как
 *  есть, и первая отметка соберёт правилу новый. */
export function targetOf(spec: Spec, out: string): Target | null {
    const outs = spec.outputs
    const o = outs[out]
    if (!o) return null
    if (o.kind === 'direct') return { ...EMPTY_TARGET, direct: true }
    if (o.kind === ('block' as Output['kind'])) return { ...EMPTY_TARGET, block: true }
    const t: Target = structuredClone(EMPTY_TARGET)
    const put = (s: Section) => {
        if (s.kind === 'warp') t.warp.push(s.out)
        else if (s.kind === 'subs') t.subs = { mode: s.mode, picks: s.picks }
        else t.own = { mode: s.mode, picks: s.picks }
    }
    const one = sectionOf(outs, out)
    if (one) { put(one); return t }
    /* Несколько блоков: группа `order` над ними. */
    if (o.kind === 'group' && o.pick === 'order') {
        for (const m of o.members || []) {
            const s = sectionOf(outs, m)
            if (!s) return null
            if (s.kind !== 'warp' && (s.kind === 'subs' ? t.subs.picks.length : t.own.picks.length)) return null
            put(s)
        }
        return t
    }
    return null
}

/* ------------------------------------------------------------------ выбор → спека */

/** Собранный набор: верхний выход и его служебные части, с именами-заготовками. */
interface Built {
    top: Output
    owned: Output[]
}

/** Части одной подписки и протокола подряд — как у редактора пула (PoolEditor.groupsOf). */
function runsOf(picks: SubPick[]): { sub: string; proto: Proto; nodes: number[] }[] {
    const out: { sub: string; proto: Proto; nodes: number[] }[] = []
    for (const p of picks) {
        const last = out[out.length - 1]
        if (p.idx !== undefined && last && last.sub === p.sub && last.proto === p.proto && last.nodes.length) {
            last.nodes.push(p.idx)
            continue
        }
        out.push({ sub: p.sub, proto: p.proto, nodes: p.idx === undefined ? [] : [p.idx] })
    }
    return out
}

let seq = 0
const tmp = () => `\u0000${++seq}`

function tunnel(name: string, r: { sub: string; proto: Proto; nodes: number[] }, extra: Partial<Output> = {}): Output {
    const o: Output = { name, kind: r.proto, sub_file: r.sub, on_fail: 'drop', ...extra }
    if (r.nodes.length) o.nodes = r.nodes
    return o
}

/** Что умеет ядро — от этого зависит, как набор ложится в спеку. */
export interface Caps {
    /** `pick: latency` у туннеля (умение pool_latency): «Самый быстрый» — один туннель на подписку. */
    tunnelLatency?: boolean
}

function buildSubs(mode: Mode, picks: SubPick[], caps: Caps = {}): Built | null {
    if (!picks.length) return null
    if (mode === 'manual') {
        const p = picks[0]
        /* Ядро пишет один узел списком `nodes` — так же пишется и здесь, чтобы набор сравнивался. */
        return { top: tunnel(tmp(), { sub: p.sub, proto: p.proto, nodes: p.idx === undefined ? [] : [p.idx] }), owned: [] }
    }
    const runs = runsOf(picks)
    if (mode === 'order') {
        if (runs.length === 1) return { top: tunnel(tmp(), runs[0]), owned: [] }
        const top: Output = { name: tmp(), kind: 'interface', devices: [], on_fail: 'drop' }
        const owned = runs.map((r) => tunnel(tmp(), r, { part_of: top.name }))
        top.devices = owned.map((p) => p.name)
        top.device = top.devices[0]
        return { top, owned }
    }
    if (mode === 'latency' && caps.tunnelLatency) {
        /* Ядро меряет узлы подписки само, в одном туннеле (`pick: latency`); у hysteria2 так нельзя —
         * у него часть на узел. Несколько подписок или протоколов — пул latency из таких туннелей. */
        const parts = runs.flatMap((r) =>
            r.proto === 'hysteria2' && r.nodes.length > 1 ? r.nodes.map((n) => ({ ...r, nodes: [n] })) : [r])
        const lat = (r: { proto: Proto; nodes: number[] }): Partial<Output> =>
            r.proto !== 'hysteria2' && r.nodes.length !== 1 ? { pick: 'latency' } : {}
        if (parts.length === 1) return { top: tunnel(tmp(), parts[0], lat(parts[0])), owned: [] }
        const top: Output = { name: tmp(), kind: 'interface', devices: [], pick: 'latency', on_fail: 'drop' }
        const owned = parts.map((r) => tunnel(tmp(), r, { ...lat(r), part_of: top.name }))
        top.devices = owned.map((p) => p.name)
        top.device = top.devices[0]
        return { top, owned }
    }
    if (mode === 'latency') {
        /* Ядро без pool_latency сравнивает задержку только между частями: по части на узел. */
        const each = picks.map((p) => ({ sub: p.sub, proto: p.proto, nodes: p.idx === undefined ? [] : [p.idx] }))
        if (each.length === 1) return { top: tunnel(tmp(), each[0]), owned: [] }
        const top: Output = { name: tmp(), kind: 'interface', devices: [], pick: 'latency', on_fail: 'drop' }
        const owned = each.map((r) => tunnel(tmp(), r, { part_of: top.name }))
        top.devices = owned.map((p) => p.name)
        top.device = top.devices[0]
        return { top, owned }
    }
    /* Раздача: внутри туннеля — `active`; у hysteria2 его нет, там часть на узел. */
    const parts = runs.flatMap((r) =>
        r.proto === 'hysteria2' && r.nodes.length > 1 ? r.nodes.map((n) => ({ ...r, nodes: [n] })) : [r])
    const share = (r: { proto: Proto; nodes: number[] }): Partial<Output> =>
        r.proto !== 'hysteria2' && r.nodes.length > 1 ? { active: r.nodes.length } : {}
    if (parts.length === 1) return { top: tunnel(tmp(), parts[0], share(parts[0])), owned: [] }
    const top: Output = { name: tmp(), kind: 'group', pick: 'balance', members: [], on_fail: 'drop' }
    const owned = parts.map((r) => tunnel(tmp(), r, { ...share(r), part_of: top.name }))
    top.members = owned.map((p) => p.name)
    return { top, owned }
}

/** Свои туннели. `ref` — выбран один выход своего туннеля: правило ведёт прямо в него. */
function buildOwn(mode: Mode, picks: string[]): Built | { ref: string } | null {
    if (!picks.length) return null
    const devs = picks.filter((p) => p.startsWith('dev:')).map((p) => p.slice(4))
    if (mode === 'manual' || picks.length === 1) {
        const p = picks[0]
        if (p.startsWith('out:')) return { ref: p.slice(4) }
        return { top: { name: tmp(), kind: 'interface', device: p.slice(4), on_fail: 'drop' }, owned: [] }
    }
    if ((mode === 'order' || mode === 'latency') && devs.length === picks.length) {
        return {
            top: { name: tmp(), kind: 'interface', devices: devs, device: devs[0], on_fail: 'drop', ...(mode === 'latency' ? { pick: 'latency' } : {}) },
            owned: [],
        }
    }
    const top: Output = { name: tmp(), kind: 'group', pick: mode, members: [], on_fail: 'drop' }
    const owned: Output[] = []
    top.members = picks.map((p) => {
        if (p.startsWith('out:')) return p.slice(4)
        const m: Output = { name: tmp(), kind: 'interface', device: p.slice(4), on_fail: 'drop', part_of: top.name }
        owned.push(m)
        return m.name
    })
    return { top, owned }
}

/** Набор правила целиком. `ref` — правило ведёт прямо в готовый выход. */
export function buildTarget(t: Target, caps: Caps = {}): Built | { ref: string } | null {
    const secs: (Built | { ref: string })[] = []
    const s = buildSubs(t.subs.mode, t.subs.picks, caps)
    if (s) secs.push(s)
    for (const w of t.warp) secs.push({ ref: w })
    const o = buildOwn(t.own.mode, t.own.picks)
    if (o) secs.push(o)
    if (!secs.length) return null
    if (secs.length === 1) return secs[0]
    const top: Output = { name: tmp(), kind: 'group', pick: 'order', members: [], on_fail: 'drop' }
    const owned: Output[] = []
    top.members = secs.map((x) => {
        if ('ref' in x) return x.ref
        x.top.part_of = top.name
        owned.push(x.top, ...x.owned)
        return x.top.name
    })
    return { top, owned }
}

/* ------------------------------------------------------------------ запись */

/** Всё, что выход тянет за собой: части пула, члены группы, их части. */
function treeOf(outs: Record<string, Output>, name: string, acc = new Set<string>()): Set<string> {
    const o = outs[name]
    /* WARP и свои туннели внутри набора — его члены, но не его собственность. */
    if (!o || acc.has(name) || (acc.size > 0 && kept(o))) return acc
    acc.add(name)
    if (o.kind === 'interface') {
        for (const d of o.devices?.length ? o.devices : o.device ? [o.device] : []) {
            const p = partOn(outs, name, d)
            if (p) treeOf(outs, p, acc)
        }
    }
    for (const m of o.members || []) treeOf(outs, m, acc)
    return acc
}

/** Убрать из спеки выход `root` и всё под ним, что больше никому не нужно. Выходы, которые правило
 *  не собирает (WARP, свои туннели, direct), остаются. */
function prune(spec: Spec, root: string): Spec {
    const tree = [...treeOf(spec.outputs, root)]
    let outputs = { ...spec.outputs }
    for (;;) {
        const cur: Spec = { ...spec, outputs }
        /* «Блок» никому не нужный убирается: настройки у него нет, при следующем выборе заведётся заново. */
        const gone = tree.filter((n) => outputs[n] && (!kept(outputs[n]) || (outputs[n].kind as string) === 'block') &&
            Object.values(outputUsers(cur, [n])).every((l) => l.length === 0))
        if (!gone.length) return cur
        outputs = Object.fromEntries(Object.entries(outputs).filter(([k]) => !gone.includes(k)))
    }
}

/** Свободное имя на основе `base` (латиница, цифры, `_`, `-`; не длиннее имени устройства). */
export function freeName(taken: (n: string) => boolean, base: string): string {
    const tr: Record<string, string> = {
        а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
        о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
        э: 'e', ю: 'yu', я: 'ya',
    }
    let b = [...base.toLowerCase()].map((c) => tr[c] ?? c).join('').replace(/[^a-z0-9_-]+/g, '').slice(0, NAME_MAX)
    if (!b || !/^[a-z]/.test(b)) b = `r${b}`.slice(0, NAME_MAX)
    if (!taken(b)) return b
    for (let k = 2; ; k++) {
        const n = `${b.slice(0, NAME_MAX - String(k).length)}${k}`
        if (!taken(n)) return n
    }
}

/** Записать набор `built` под именем `top`: части получают имена `<top>-<n>`; часть с тем же
 *  содержимым, что у прежней, сохраняет прежнее имя — иначе перестановка перезапускала бы живые
 *  туннели. */
function place(spec: Spec, built: Built, top: string, old: Record<string, Output>): Spec {
    const outputs = { ...spec.outputs }
    const rename = new Map<string, string>([[built.top.name, top]])
    const taken = (n: string) => !!outputs[n] || [...rename.values()].includes(n)
    /* Старые части по содержимому — до переименования ссылок. */
    const oldByShape = new Map<string, string>()
    for (const n of Object.keys(old)) if (n !== top) oldByShape.set(shape(old, n), n)
    const draft: Record<string, Output> = { ...outputs, [built.top.name]: built.top }
    for (const p of built.owned) draft[p.name] = p
    for (const p of built.owned) {
        const same = oldByShape.get(shape(draft, p.name))
        if (same && !taken(same)) { rename.set(p.name, same); continue }
        let k = 1
        const at = (i: number) => `${top.slice(0, NAME_MAX - 1 - String(i).length)}-${i}`
        while (taken(at(k))) k++
        rename.set(p.name, at(k))
    }
    const r = (n: string) => rename.get(n) ?? n
    for (const o of [built.top, ...built.owned]) {
        const name = r(o.name)
        const next: Output = { ...o, name }
        if (o.part_of) next.part_of = r(o.part_of)
        if (o.devices) next.devices = o.devices.map(r)
        if (o.device) next.device = r(o.device)
        if (o.members) next.members = o.members.map(r)
        outputs[name] = next
    }
    return { ...spec, outputs }
}

/** Выход direct: есть — его имя, нет — заводится. */
function directOf(spec: Spec): { spec: Spec; name: string } {
    const have = Object.entries(spec.outputs).find(([, o]) => o.kind === 'direct')?.[0]
    if (have) return { spec, name: have }
    return { spec: { ...spec, outputs: { ...spec.outputs, [DIRECT]: { name: DIRECT, kind: 'direct' } } }, name: DIRECT }
}

/** Выход block: есть — его имя, нет — заводится. */
function blockOf(spec: Spec): { spec: Spec; name: string } {
    const have = Object.entries(spec.outputs).find(([, o]) => o.kind === ('block' as Output['kind']))?.[0]
    if (have) return { spec, name: have }
    let name = 'block'
    for (let k = 2; spec.outputs[name]; k++) name = `block${k}`
    return { spec: { ...spec, outputs: { ...spec.outputs, [name]: { name, kind: 'block' as Output['kind'] } } }, name }
}

/** Кто ещё держит выход, кроме правила `index`. */
function othersOf(spec: Spec, index: number, name: string): string[] {
    const tree = [...treeOf(spec.outputs, name)]
    const without: Spec = { ...spec, channels: spec.channels.filter((_, k) => k !== index) }
    const u = outputUsers(without, tree)
    return [...u.rules, ...u.dns, ...u.ruleDns, ...u.groups, ...u.over]
}

/** Правила, с которыми правило `index` делит выход. */
export function sharedWith(spec: Spec, index: number): string[] {
    const out = spec.channels[index]?.out
    if (!out || spec.outputs[out]?.kind === 'direct') return []
    return spec.channels.filter((c, k) => k !== index && c.out === out).map((c) => c.name)
}

/** Поставить правилу `index` выбор `t`. Пустой выбор (ни пилюли, не «напрямую») спеку не меняет —
 *  правилу нужен выход. */
export function applyTarget(spec: Spec, index: number, t: Target, caps: Caps = {}): Spec {
    const ch = spec.channels[index]
    if (!ch) return spec
    const prev = ch.out
    const setOut = (s: Spec, out: string): Spec => {
        if (out === prev) return s
        const next: Spec = { ...s, channels: s.channels.map((c, k) => (k === index ? { ...c, out } : c)) }
        return prev && prev !== out ? prune(next, prev) : next
    }
    /* Домены в «Блок» решает резолвер ядра — пустым адресом (0.0.0.0, ::), ни один адрес в наборы не
     * попадает: real-IP положил бы туда общий адрес CDN и заблокировал всё за ним. Режим доменов
     * правила здесь не трогается. */
    if (t.block) {
        const b = blockOf(spec)
        return setOut(b.spec, b.name)
    }
    if (t.direct) {
        const d = directOf(spec)
        const s2 = setOut(d.spec, d.name)
        /* Напрямую — домены настоящими адресами (rulefiles.directDomains). */
        return { ...s2, channels: s2.channels.map((c, k) => (k === index ? directDomains(c) : c)) }
    }
    const built = buildTarget(t, caps)
    if (!built) return spec
    if ('ref' in built) return setOut(spec, built.ref)

    /* Такой набор уже есть — правило переходит на него. */
    const draft: Record<string, Output> = { ...spec.outputs, [built.top.name]: built.top }
    for (const p of built.owned) draft[p.name] = p
    const want = shape(draft, built.top.name)
    const same = Object.keys(spec.outputs).find((n) => !isPart(spec.outputs[n]) && spec.outputs[n].kind !== 'direct' && shape(spec.outputs, n) === want)
    if (same) return setOut(spec, same)

    /* Прежний выход только этого правила и собран правилом — переписывается на месте, под тем же
     * именем. Иначе — свой новый выход. */
    const po = prev ? spec.outputs[prev] : undefined
    if (po && !kept(po) && !isPart(po) && othersOf(spec, index, prev).length === 0) {
        const tree = treeOf(spec.outputs, prev)
        const old: Record<string, Output> = {}
        const rest: Record<string, Output> = {}
        for (const [k, v] of Object.entries(spec.outputs)) {
            if (tree.has(k) && !kept(v)) old[k] = v
            else rest[k] = v
        }
        /* Части прежнего набора, нужные кому-то ещё (член чужой группы), остаются на месте. */
        for (const k of Object.keys(old)) {
            if (k === prev) continue
            const u = outputUsers({ ...spec, outputs: { ...rest, [k]: old[k] } }, [k])
            if (Object.values(u).some((l) => l.length)) rest[k] = old[k]
        }
        return place({ ...spec, outputs: rest }, built, prev, old)
    }
    const taken = (n: string) => !!spec.outputs[n]
    const name = freeName(taken, ch.name)
    return setOut(place(spec, built, name, {}), name)
}

/** Убрать правило `index` вместе с выходом, который после этого никому не нужен (его частями). */
export function dropRule(spec: Spec, index: number): Spec {
    const out = spec.channels[index]?.out
    const next: Spec = { ...spec, channels: spec.channels.filter((_, k) => k !== index) }
    return out ? prune(next, out) : next
}

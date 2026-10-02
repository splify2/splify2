import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Gauge, GripVertical, LoaderCircle, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Block, CardHead, DangerButton, FieldRow, Group, ScreenHeader } from '@/components/ui/layout'
import { Field, inputCls } from '@/components/formbits'
import { notify } from '@/lib/notify'
import { rpc, type VlessNodesReply } from '@/lib/rpc'
import { subsRemember, subsRemembered } from '@/lib/subs'
import Flag from '@/components/Flag'
import { country } from '@/lib/geo'
import { ccFromName, plainName } from '@/lib/nodename'
import { poolsSupported } from '@/lib/engine'
import { latencyTone, probeKey, useNodeProbe } from '@/lib/probe'
import {
    devList, isPart, isTunnelKind, ON_FAIL_TEXT, type OnFail, type Output, type Spec, type VlessNode,
} from '@/lib/model'
import OutputAdvanced, { advFrom, advApply, type Adv } from '@/components/OutputAdvanced'
import { type Live } from '@/lib/live'

/** Состав выхода: из чего он собран и в каком порядке.
 *
 *  ЧТО ТАКОЕ ВЫХОД. Это то, во что ведёт правило, — не устройство и не узел. Внутри у него
 *  список кандидатов по предпочтению: первый живой забирает трафик, и возврат наверх
 *  происходит сам, когда верхний оживает.
 *
 *  ЧТО МОЖНО ВЗЯТЬ — ВСЁ И РАЗОМ, В ЛЮБОМ ПОРЯДКЕ. Две локации из одной подписки, три из другой
 *  и свой WireGuard — один выход, и строки в нём стоят так, как расставил человек: локации
 *  разных подписок могут чередоваться. Раньше редактор предлагал выбор «либо одна подписка,
 *  либо свои туннели», потом — блоки по подпискам; владелец упёрся и в то, и в другое.
 *
 *  КАК ЭТО ЛОЖИТСЯ В ДВИЖОК. Движок собирает разнородный пул давно: выход `kind: interface`, в
 *  `devices` которого названы устройства выходов `kind: vless` (контракт steer, §выходы).
 *  Редактор эту форму собирает сам: СОСЕДНИЕ строки одной подписки становятся одним служебным
 *  выходом `kind: vless` со списком `nodes` (см. `Output.part_of`), своё устройство — само
 *  собой, а выход — пулом из их устройств в том же порядке. Так «Финляндия (Riot) → Польша
 *  (VPN) → Эстония (Riot)» даёт три части, две из них на одной подписке, — и порядок человека
 *  исполняется дословно. Соседние локации одной подписки нарочно сведены в одну часть: внутри
 *  неё узлы перебирает сам клиент, за секунды; между частями — сторож движка, раз в минуту.
 *  Человек видит одно: список того, что взял, по порядку.
 *
 *  ДВИЖОК ПОСТАРШЕ (без умения `pool`) собирать пул не умеет и промолчал бы: незнакомая форма
 *  для него законна, а живая локация в ней объявляется мёртвой. Поэтому на таком движке
 *  редактор ограничивает выбор одной подпиской с одним узлом либо своими туннелями и говорит
 *  об этом словами, а не молча режет выбор. */

interface Sub {
    name: string
    title?: string
    path: string
    present: boolean
}

/** Строка состава: одна локация подписки, «любая рабочая» локация подписки либо одно своё
 *  устройство. Порядок строк — порядок предпочтения, каким его расставил человек. */
type Proto = 'vless' | 'hysteria2'
type Row =
    | { kind: 'node'; sub: string; idx: number; proto: Proto }
    | { kind: 'any'; sub: string; proto: Proto }
    | { kind: 'dev'; dev: string }

const PROTO_LABEL: Record<Proto, string> = { vless: 'VLESS', hysteria2: 'hysteria2' }

/** Подписка в таблице замеров. Номера узлов у протоколов свои (у каждого клиента — среди своих
 *  пригодных), поэтому в смешанной подписке «узел 3» бывает двух видов; у hysteria2 ключ
 *  подписки свой, и замеры не смешиваются. */
const HY_PROBE = 'hy2|'
const probeSub = (sub: string, proto: Proto) => (proto === 'hysteria2' ? HY_PROBE + sub : sub)

const NAME_RE = /^[A-Za-z0-9_-]{1,24}$/
/** Имя выхода `kind: vless` становится именем устройства TUN, а у него предел IFNAMSIZ:
 *  движок молча берёт первые пятнадцать символов (spec.c). Два длинных имени с общим началом
 *  дали бы одно устройство на два выхода — поэтому предел проверяется здесь, до записи. */
const DEV_NAME_MAX = 15

/** Имя нового выхода по умолчанию: `vpn`, занято — `vpn2`, `vpn3`… Пустое поле заставляло
 *  придумывать имя до того, как человек вообще понял, что здесь собирает; имя можно поменять. */
function freeName(spec: Spec): string {
    if (!spec.outputs.vpn) return 'vpn'
    let n = 2
    while (spec.outputs[`vpn${n}`]) n++
    return `vpn${n}`
}

/** Сколько локаций подписки показывать свёрнуто: выбранные — всегда, остальных — до этого
 *  числа. Две подписки по тридцать локаций разворачивались в столб на три экрана, в котором
 *  порядок предпочтения справа терялся, а на телефоне уезжал в самый низ. */
const FOLD = 6

/** Служебные части пула по имени пула. */
function partsOf(spec: Spec, pool: string | undefined): [string, Output][] {
    if (!pool) return []
    return Object.entries(spec.outputs).filter(([, o]) => o.part_of === pool)
}

/** Строки из выхода kind=vless (обычного или служебной части). */
function rowsOfVless(o: Output): Row[] {
    const sub = o.sub_file || ''
    const proto: Proto = o.kind === 'hysteria2' ? 'hysteria2' : 'vless'
    const nodes = o.nodes?.length
        ? o.nodes
        : typeof o.node === 'number' && o.node >= 0
          ? [o.node]
          : []
    return nodes.length ? nodes.map((idx): Row => ({ kind: 'node', sub, idx, proto })) : [{ kind: 'any', sub, proto }]
}

/** Разложить существующий выход на строки состава. Обратная операция к сборке в save(). */
function rowsOf(spec: Spec, name: string | undefined): Row[] {
    const o = name ? spec.outputs[name] : undefined
    if (!o) return []
    if (isTunnelKind(o.kind)) return rowsOfVless(o)
    if (o.kind !== 'interface') return []
    const parts = partsOf(spec, name)
    return devList(o).flatMap((d): Row[] => {
        const part = parts.find(([n, p]) => n === d || devList(p).includes(d))
        return part ? rowsOfVless(part[1]) : [{ kind: 'dev', dev: d }]
    })
}

/** Ключ строки — чтобы React не терял состояние при перестановке. */
function rowKey(r: Row): string {
    const t = r.kind === 'dev' || r.proto === 'vless' ? '' : 'h'
    return r.kind === 'node' ? `${t}n:${r.sub}:${r.idx}` : r.kind === 'any' ? `${t}a:${r.sub}` : `d:${r.dev}`
}

function sameRow(a: Row, b: Row): boolean {
    return rowKey(a) === rowKey(b)
}

/** Группы соседних строк одной подписки — то, что станет частями пула. */
type Group = { kind: 'sub'; sub: string; proto: Proto; nodes: number[] } | { kind: 'dev'; dev: string }
function groupsOf(rows: Row[]): Group[] {
    const out: Group[] = []
    for (const r of rows) {
        if (r.kind === 'dev') { out.push({ kind: 'dev', dev: r.dev }); continue }
        const last = out[out.length - 1]
        /* «Любая рабочая» — всегда своя часть: пустой список узлов значит «все», и склеивать
         * его с выбранными номерами значило бы потерять либо то, либо другое. */
        if (r.kind === 'node' && last && last.kind === 'sub' && last.sub === r.sub && last.proto === r.proto && last.nodes.length) {
            last.nodes.push(r.idx)
            continue
        }
        out.push({ kind: 'sub', sub: r.sub, proto: r.proto, nodes: r.kind === 'node' ? [r.idx] : [] })
    }
    return out
}

export default function PoolEditor({
    spec, name, live, onSave, onCancel,
}: {
    spec: Spec
    /** Имя правимого выхода; пусто — заводим новый. */
    name?: string
    live?: Live
    onSave: (next: Spec) => void
    onCancel: () => void
}) {
    /** Умеет ли движок список локаций и смешанный пул. Спрашивается у состояния, а не у
     *  версии: см. lib/engine.ts. */
    const pools = poolsSupported(live?.status ?? null)
    const existing = name ? spec.outputs[name] : undefined
    const [title, setTitle] = useState(name || freeName(spec))
    /** Поиск по локациям: страна или слово из названия, по всем подпискам разом. */
    const [query, setQuery] = useState('')
    /** Подписки, развёрнутые целиком (по нажатию «показать все»). */
    const [openSubs, setOpenSubs] = useState<Record<string, boolean>>({})
    const [rows, setRows] = useState<Row[]>(() => rowsOf(spec, name))
    const [onFail, setOnFail] = useState<OnFail>(existing?.on_fail || 'drop')
    const [adv, setAdv] = useState<Adv>(() => advFrom(spec, name))
    const [tunnels, setTunnels] = useState<{ name: string; up: boolean; kind: string }[]>([])
    /* Перечень подписок начинается с запомненного: пока `sub_list` идёт, список говорил
     * «подписок нет» — утверждение, а не ожидание, и человек успевал ему поверить. */
    const [subs, setSubs] = useState<Sub[]>(() => subsRemembered() ?? [])
    /** Узлы каждой подписки глазами движка. `undefined` — ещё не спрашивали, `null` — спросить
     *  не удалось (подписка не скачана или бэкенд постарше без выхода на ней). */
    const [nodesBySub, setNodesBySub] = useState<Record<string, VlessNode[] | null>>({})
    /** Протокол подписки: по ссылкам, которые в ней нашёл движок. Подписка из ссылок
     *  `hysteria2://` — выход `protocol: hysteria2`, остальное — VLESS. `foreign` — сколько
     *  ссылок движок не узнал как свои: при нуле узлов и ненулевом числе это почти всегда
     *  ссылки протокола, модуля которого нет. */
    /** Узлы hysteria2 той же подписки: вторая половина смешанной подписки. Спрашивается, когда
     *  движок нашёл в подписке ссылки, которых не признал своими. */
    const [hyBySub, setHyBySub] = useState<Record<string, VlessNode[]>>({})
    const [foreignBySub, setForeignBySub] = useState<Record<string, number>>({})
    /** Проверка узлов — здесь, где их выбирают: см. lib/probe.ts. Спрашивается у подписки
     *  её файлом; движок или бэкенд постарше пути не знают — тогда через любой выход, уже
     *  стоящий на этой подписке (тот же запасной ход, что у списка узлов ниже). */
    const probe = useNodeProbe(async (sub, index) => {
        const asker = Object.entries(spec.outputs).find(
            ([, o]) => isTunnelKind(o.kind) && o.sub_file === sub,
        )?.[0]
        try {
            /* Узел hysteria2 проверяется клиентом hysteria2 (пакет steer-hysteria2), VLESS —
             * своим; формат ответа тот же. */
            if (sub.startsWith(HY_PROBE)) return await rpc.hysteria2ProbeOfSub(sub.slice(HY_PROBE.length), index)
            return await rpc.vlessProbeOfSub(sub, index)
        } catch (e) {
            if (!asker) throw e
            return rpc.vlessProbe(asker, index)
        }
    })
    /** Какая строка сейчас тащится мышью — индекс в `rows`. */
    const [drag, setDrag] = useState<number | null>(null)
    const [over, setOver] = useState<number | null>(null)

    useEffect(() => {
        rpc.devices().then((d) => setTunnels(d.devices || [])).catch(() => setTunnels([]))
        rpc.subList()
            .then((r) => { setSubs(r.subs || []); subsRemember(r.subs) })
            /* Старый бэкенд про несколько подписок не знает — тогда единственная известная
             * подписка та, что лежит на своём месте. */
            .catch(() => setSubs([{ name: 'main', path: '/etc/steer/sub.txt', present: true }]))
    }, [])

    /* Узлы спрашиваются у КАЖДОЙ подписки, а не только у выбранной: человек выбирает из того,
     * что видит, и подписка без списка локаций для него — подписка без локаций. Первый путь —
     * у самой подписки (её файлом); бэкенд постарше так не умеет, и тогда узлы просим у любого
     * выхода, который уже стоит на этой подписке: движок читает их из того же файла. */
    const subKeys = subs.map((s) => `${s.path}${s.present ? '' : '!'}`).join(',')
    useEffect(() => {
        let stop = false
        for (const s of subs) {
            if (!s.present) { setNodesBySub((m) => ({ ...m, [s.path]: null })); continue }
            const asker = Object.entries(spec.outputs).find(
                ([, o]) => isTunnelKind(o.kind) && o.sub_file === s.path,
            )?.[0]
            const take = (r: VlessNodesReply, hy: VlessNode[] = []) => {
                if (stop) return
                setNodesBySub((m) => ({ ...m, [s.path]: r.nodes || [] }))
                setHyBySub((m) => ({ ...m, [s.path]: hy }))
                setForeignBySub((m) => ({ ...m, [s.path]: r.foreign || 0 }))
            }
            rpc.vlessNodesOfSub(s.path)
                .then((r) => {
                    /* Ссылки, которых движок не признал своими, — возможно, hysteria2: смешанная
                     * подписка показывает узлы ОБОИХ протоколов, а не один из двух. Нет ссылок
                     * такого рода или нет модуля — остаётся ответ VLESS как есть, а число
                     * непризнанных ссылок говорит, что не хватает пакета. */
                    if (!r.foreign) { take(r); return }
                    return rpc.hysteria2NodesOfSub(s.path)
                        .then((h) => take(r, h.nodes || []))
                        .catch(() => take(r))
                })
                .catch(() => {
                    if (!asker) { if (!stop) setNodesBySub((m) => ({ ...m, [s.path]: null })); return }
                    rpc.vlessNodes(asker)
                        .then(take)
                        .catch(() => { if (!stop) setNodesBySub((m) => ({ ...m, [s.path]: null })) })
                })
        }
        return () => { stop = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subKeys])

    const subOf = (path: string) => subs.find((s) => s.path === path)
    const subTitle = (path: string) => {
        const s = subOf(path)
        return s?.title || s?.name || path.replace(/^.*\//, '').replace(/\.txt$/, '')
    }
    const nodeOf = (sub: string, idx: number, proto: Proto = 'vless') =>
        ((proto === 'hysteria2' ? hyBySub[sub] : nodesBySub[sub]) || []).find((x) => x.index === idx)

    /** Устройства, занятые ДРУГИМИ выходами: одно устройство в двух выходах kind=interface —
     *  это две таблицы маршрутизации на один туннель, и вторая молча не работает.
     *
     *  Устройство выхода vless/xsteer сюда НЕ идёт, когда движок понимает смешанный пул: оно
     *  и есть локация, которую в пул кладут. Проба здоровья и masquerade решаются по владельцу
     *  устройства, а не по виду выхода, который его назвал (контракт steer T-015). */
    const taken = useMemo(
        () =>
            new Set(
                Object.entries(spec.outputs)
                    .filter(([n, o]) => n !== name && o.part_of !== name && (o.kind === 'interface' || !pools))
                    .flatMap(([, o]) => devList(o)),
            ),
        [spec, name, pools],
    )

    /** Устройства служебных частей — любых пулов. Человеку они не предлагаются: это не его
     *  туннели, а способ, которым редактор записал чужие локации. */
    const partDevs = useMemo(
        () =>
            new Set(
                Object.entries(spec.outputs)
                    .filter(([, o]) => isPart(o))
                    .flatMap(([n, o]) => [n, ...devList(o)]),
            ),
        [spec],
    )
    const offered = tunnels.filter((t) => !partDevs.has(t.name))

    const has = (r: Row) => rows.some((x) => sameRow(x, r))

    /** Движок без пула: одна подписка с одним узлом ЛИБО свои туннели. Взять второе, когда
     *  есть первое, значит записать то, что он молча исполнит не так. */
    function refuseOnOldEngine(next: Row[]): boolean {
        if (pools) return false
        const g = groupsOf(next)
        const subsN = g.filter((x) => x.kind === 'sub').length
        const devsN = g.length - subsN
        if (subsN > 1 || (subsN && devsN)) {
            notify('Ядро этой версии не умеет смешанный пул: либо одна подписка, либо свои туннели. Обновите ядро в разделе «Настройки → О ПО».', 'warning')
            return true
        }
        return false
    }

    function commit(next: Row[]) {
        if (refuseOnOldEngine(next)) return
        setRows(next)
    }

    /** Отметить или снять локацию. Новая строка встаёт в конец: порядок — дело правой колонки. */
    function toggleNode(sub: string, idx: number, proto: Proto = 'vless') {
        const r: Row = { kind: 'node', sub, idx, proto }
        if (has(r)) { commit(rows.filter((x) => !sameRow(x, r))); return }
        /* «Любая рабочая» того же протокола этой подписки и выбранный номер вместе не значат
         * ничего: выбор номера заменяет «любую». */
        const base = rows.filter((x) => !(x.kind === 'any' && x.sub === sub && x.proto === proto))
        /* Без пула локация одна: вторая отметка переезжает, а не добавляется. */
        commit(pools ? [...base, r] : [...base.filter((x) => x.kind !== 'node'), r])
    }

    /** «Любая рабочая»: подписка взята целиком, выбор узла делает проверка при подъёме.
     *  Повторное нажатие ничего не меняет — убирается строка крестиком в порядке справа,
     *  как и всё остальное; два способа убрать одно и то же путали бы. */
    function anyOf(sub: string, proto: Proto = 'vless') {
        const r: Row = { kind: 'any', sub, proto }
        if (has(r)) return
        commit([...rows.filter((x) => !(x.kind === 'node' && x.sub === sub && x.proto === proto)), r])
    }

    function toggleDev(dev: string) {
        const r: Row = { kind: 'dev', dev }
        commit(has(r) ? rows.filter((x) => !sameRow(x, r)) : [...rows, r])
    }

    function move(i: number, j: number) {
        if (j < 0 || j >= rows.length || i === j) return
        const next = rows.slice()
        const [r] = next.splice(i, 1)
        next.splice(j, 0, r)
        setRows(next)
    }

    /** Форма выхода kind=vless из группы строк подписки. ОДНА форма из двух: спеку с `node` и
     *  `nodes` разом движок отвергает целиком. Список — только там, где движок его понимает. */
    function vlessOut(n: string, g: Extract<Group, { kind: 'sub' }>, fail: OnFail, partOf?: string): Output {
        return advApply({
            name: n,
            kind: g.proto,
            sub_file: g.sub,
            ...(pools && g.nodes.length > 1
                ? { nodes: g.nodes }
                : { node: g.nodes.length ? g.nodes[0] : -1 }),
            on_fail: fail,
            ...(partOf ? { part_of: partOf } : {}),
        }, adv, 'tunnel')
    }

    /** Что в прежнем выходе редактор не трогает и обязан донести до записи: обфускатор и
     *  ключи, которых модель не знает. Без этого сохранение состава стирало бы их молча. */
    function carry(next: Output): Output {
        const keep: Partial<Output> = {}
        if (existing?.obfs && next.kind === 'interface') keep.obfs = existing.obfs
        if (existing?.extra) keep.extra = existing.extra
        return { ...next, ...keep }
    }

    function save() {
        const n = title.trim()
        if (!NAME_RE.test(n)) {
            notify('Имя: латиница, цифры, дефис или подчёркивание', 'warning')
            return
        }
        const mine = new Set([name, ...partsOf(spec, name).map(([k]) => k)].filter(Boolean))
        if (!mine.has(n) && spec.outputs[n]) {
            notify(`Выход «${n}» уже есть`, 'warning')
            return
        }
        if (rows.length === 0) {
            notify('Выберите, через что выходить', 'warning')
            return
        }
        if (refuseOnOldEngine(rows)) return

        const groups = groupsOf(rows)
        const subGroups = groups.filter((g): g is Extract<Group, { kind: 'sub' }> => g.kind === 'sub')
        const outputs: Record<string, Output> = {}
        for (const [k, v] of Object.entries(spec.outputs)) if (!mine.has(k)) outputs[k] = v

        if (groups.length === 1 && subGroups.length === 1) {
            /* Одна подписка — обычный выход kind=vless, как и раньше: служебные части здесь
             * ни к чему, а имя выхода станет именем устройства. */
            if (n.length > DEV_NAME_MAX) {
                notify(`Имя выхода подписки — не длиннее ${DEV_NAME_MAX} символов: оно становится именем устройства`, 'warning')
                return
            }
            outputs[n] = carry(vlessOut(n, subGroups[0], onFail))
        } else if (subGroups.length === 0) {
            const devices = groups.map((g) => (g as Extract<Group, { kind: 'dev' }>).dev)
            outputs[n] = carry(advApply(
                { name: n, kind: 'interface', devices, device: devices[0], on_fail: onFail }, adv, 'top'))
        } else {
            /* Пул. Каждая группа соседних локаций одной подписки — своим служебным выходом; имя
             * части ≤ 15 символов (предел имени устройства) и по возможности прежнее: части с
             * той же подпиской и теми же узлами оставляется её имя, иначе перестановка строк
             * переименовывала бы устройства и перезапускала живые туннели. */
            const oldParts = partsOf(spec, name)
            const used = new Set(Object.keys(outputs))
            const devices: string[] = []
            const keyOf = (o: Output) => `${o.kind}|${o.sub_file}|${(o.nodes?.length ? o.nodes : typeof o.node === 'number' && o.node >= 0 ? [o.node] : []).join(',')}`
            for (const g of groups) {
                if (g.kind === 'dev') { devices.push(g.dev); continue }
                const want = `${g.proto}|${g.sub}|${g.nodes.join(',')}`
                let pn = oldParts.find(([k, p]) => !used.has(k) && keyOf(p) === want)?.[0]
                    ?? oldParts.find(([k, p]) => !used.has(k) && p.sub_file === g.sub && p.kind === g.proto)?.[0]
                if (!pn || used.has(pn)) {
                    const stem = n.slice(0, DEV_NAME_MAX - 2)
                    let k = 1
                    while (used.has(`${stem}-${k}`) && k < 9) k++
                    pn = `${stem}-${k}`
                }
                used.add(pn)
                /* Отказ части — всегда «остановить»: за судьбу трафика при отказе ВСЕГО пула
                 * отвечает сам пул, а часть, пустившая трафик напрямую, пробила бы его обещание
                 * раньше, чем сторож перешёл к следующей строке. */
                outputs[pn] = vlessOut(pn, g, 'drop', n)
                devices.push(pn)
            }
            if (devices.length > 16) {
                notify('В пуле не больше шестнадцати частей — таков предел ядра; соседние локации одной подписки считаются одной частью', 'warning')
                return
            }
            outputs[n] = carry(advApply(
                { name: n, kind: 'interface', devices, device: devices[0], on_fail: onFail }, adv, 'top'))
        }
        /* Переименование уводит за собой правила: канал ведёт в ИМЯ выхода, и оставить их
         * указывать на прежнее значит осиротить каждое. */
        const channels =
            name && n !== name
                ? spec.channels.map((c) => (c.out === name ? { ...c, out: n } : c))
                : spec.channels
        onSave({ ...spec, outputs, channels })
    }

    function remove() {
        if (!name) return
        const mine = new Set([name, ...partsOf(spec, name).map(([k]) => k)])
        const used = spec.channels.filter((c) => mine.has(c.out)).map((c) => c.name)
        if (used.length) {
            notify(`Выход «${name}» занят правилами: ${used.join(', ')}`, 'warning')
            return
        }
        const outputs: Record<string, Output> = {}
        for (const [k, v] of Object.entries(spec.outputs)) if (!mine.has(k)) outputs[k] = v
        onSave({ ...spec, outputs })
    }

    /* Выход kind=zapret (его могли завести прежние версии или руками) правится НЕ ЗДЕСЬ, и
     * открывать для него общий редактор нельзя: тот знает подписки и устройства и на
     * «Сохранить» переписал бы его как выход без единого устройства. То есть один клик по
     * строке в списке молча превращал бы работающий обход в выход, который никуда не ведёт.
     *
     * Показываем то немногое, что здесь и правится (режим отказа и удаление). Создавать такие
     * выходы и выбирать стратегию splify2 больше не умеет — обход DPI из него убран. */
    if (existing?.kind === 'zapret') {
        return (
            <div className="space-y-4">
                {/* Bode: шапка экрана — стрелка назад (прежняя «Закрыть»), имя, основное действие
                    справа; удаление — обведённой красной кнопкой внизу, как в приложении. */}
                <ScreenHeader
                    title={name}
                    back={onCancel}
                    backLabel="Закрыть"
                    right={
                        <Button
                            onClick={() => {
                                const outputs = { ...spec.outputs, [name!]: { ...existing, on_fail: onFail } }
                                onSave({ ...spec, outputs })
                            }}
                        >
                            <Check className="h-4 w-4" aria-hidden="true" /> Сохранить выход
                        </Button>
                    }
                />
                <Block>
                    <CardHead title="Обход DPI" />
                    <p className="text-sm text-subtle">
                        Устройства у этого выхода нет: трафик идёт обычным маршрутом через обход DPI.
                        Стратегия настраивается вне splify2.
                    </p>
                    <div className="border-t border-border pt-1">
                        <FieldRow label="Если обход не работает">
                            <select
                                value={onFail}
                                onChange={(e) => setOnFail(e.currentTarget.value as OnFail)}
                                className={`${inputCls} w-full`}
                            >
                                {(['drop', 'direct'] as OnFail[]).map((v) => (
                                    <option key={v} value={v}>{ON_FAIL_TEXT[v]}</option>
                                ))}
                            </select>
                        </FieldRow>
                    </div>
                </Block>
                <DangerButton full onClick={remove}>
                    <Trash2 aria-hidden="true" /> Удалить
                </DangerButton>
            </div>
        )
    }

    const subsInRows = new Set(rows.filter((r) => r.kind !== 'dev').map((r) => (r as { sub: string }).sub))

    /* Bode 26.10, раскладка по образцу приложения Splify2.
     *
     * Шапка экрана: стрелка назад (она и есть прежняя «Отмена» — подпись для чтения с экрана
     * та же), заголовок, «Сохранить выход» справа. Сохранение стоит В ШАПКЕ, а не внизу, как
     * «Готово» в приложении: здесь под формой — перечень локаций на несколько экранов, и
     * основное действие, уехавшее под него, пришлось бы искать прокруткой. Удаление — внизу
     * колонки обведённой красной кнопкой: оно редкое и не должно стоять рядом с сохранением.
     *
     * Каждый вопрос — своей карточкой с заголовком: имя, порядок, «если всё упало»,
     * дополнительно; и каждая подписка — своей карточкой, а её локации — строками этой
     * карточки через волосяную линию. Прежде все подписки и свои туннели стояли подписями
     * внутри одной карточки «Что можно взять», и где кончается одна подписка и начинается
     * другая, было видно только по мелкой подписи прописными. */
    return (
        <div className="space-y-4">
            <ScreenHeader
                title={name || 'Добавить выход'}
                back={onCancel}
                backLabel="Отмена"
                right={
                    <Button onClick={save}>
                        <Check className="h-4 w-4" aria-hidden="true" /> Сохранить выход
                    </Button>
                }
            />

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
                {/* ---- слева: что можно взять ------------------------------------------ */}
                <div className="min-w-0 space-y-4">
                    <Block>
                        <CardHead title="Что можно взять" />
                        <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3">
                            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <input
                                value={query}
                                onChange={(e) => setQuery(e.currentTarget.value)}
                                placeholder="найти локацию: страна или слово из названия"
                                aria-label="найти локацию"
                                className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
                            />
                            {query && (
                                <button type="button" onClick={() => setQuery('')} aria-label="очистить поиск" className="sp-row bg-transparent p-0 text-muted-foreground hover:text-foreground">
                                    <X className="h-4 w-4" />
                                </button>
                            )}
                        </label>
                    </Block>
                        {subs.length === 0 && (
                            <Group head={<CardHead title="Подписки" />}>
                                <p className="py-3 text-xs text-muted-foreground">
                                    подписок нет — добавьте в подпункте VLESS
                                </p>
                            </Group>
                        )}
                        {subs.map((s) => {
                            const nodes = nodesBySub[s.path]
                            const hy = hyBySub[s.path] || []
                            /* «Любая рабочая» — у каждого протокола своя: клиенты разные, и
                             * одна строка не может быть обоими сразу. У подписки только из
                             * hysteria2 единственная «любая» — её. */
                            const anyProto: Proto = nodes && nodes.length === 0 && hy.length > 0 ? 'hysteria2' : 'vless'
                            const any = has({ kind: 'any', sub: s.path, proto: 'vless' }) || has({ kind: 'any', sub: s.path, proto: 'hysteria2' })
                            const mixed = hy.length > 0
                            type N = { nd: VlessNode; proto: Proto }
                            const tagged: N[] | undefined = nodes
                                ? [...nodes.map((nd): N => ({ nd, proto: 'vless' })), ...hy.map((nd): N => ({ nd, proto: 'hysteria2' }))]
                                : undefined
                            /* Что показывать из локаций: при поиске — совпавшие; иначе выбранные
                               и первые FOLD, пока подписку не развернули целиком.

                               В ПОРЯДКЕ ПОДПИСКИ, а не «выбранные наверх». Прежде отмеченная
                               строка переезжала в начало блока, и все строки над ней сдвигались
                               на одну вниз — второй щелчок по тому же месту попадал в другую
                               локацию, а щелчок по верху блока снимал только что поставленную
                               отметку. Владелец описал это как «нельзя набрать несколько
                               локаций одной подписки». Строки не двигаются: выбранные остаются
                               где были, свёртка лишь прячет невыбранные после лимита. */
                            const q = query.trim().toLowerCase()
                            const all = tagged || []
                            const hit = ({ nd }: N) => {
                                const cc = ccFromName(nd.name)
                                return `${plainName(nd.name)} ${country(cc)} ${cc || ''}`.toLowerCase().includes(q)
                            }
                            const pickKey = (proto: Proto, idx: number) => `${proto}:${idx}`
                            const picked = new Set(
                                rows
                                    .filter((r): r is Extract<Row, { kind: 'node' }> => r.kind === 'node' && r.sub === s.path)
                                    .map((r) => pickKey(r.proto, r.idx)),
                            )
                            let spare = Math.max(0, FOLD - picked.size)
                            const shown = q
                                ? all.filter(hit)
                                : openSubs[s.path]
                                  ? all
                                  : all.filter((x) => picked.has(pickKey(x.proto, x.nd.index)) || spare-- > 0)
                            const folded = !q && !openSubs[s.path] && shown.length < all.length
                            if (q && !shown.length && !all.length) return null
                            /* Подписка — своя карточка: название слева, число локаций справа,
                               проверка всех узлов строкой ниже (в строку заголовка она на узком
                               экране не помещалась вместе с названием). Строки — через
                               волосяную линию; список — <ul> внутри Group, а не строки самой
                               Group: кнопка замера стоит в одной строке <li> с выбором узла. */
                            return (
                                <Group
                                    key={s.path}
                                    head={
                                        <div className="space-y-1">
                                            <CardHead
                                                title={subTitle(s.path)}
                                                meta={
                                                    !s.present
                                                        ? <span className="text-warning-fg">не скачана</span>
                                                        : nodes
                                                          ? `локаций: ${all.length}${picked.size ? ` · взято: ${picked.size}` : any ? ' · взята любая' : ''}`
                                                          : undefined
                                                }
                                            />
                                            {s.present && nodes && (hy.length > 0 || nodes.length > 0) && (
                                                <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs">
                                                    {/* Проверка всех узлов подписки — рядом с их числом:
                                                        вопрос «какие из них живые» задают до выбора, а
                                                        не после. Повторное нажатие останавливает. */}
                                                    {([
                                                        { proto: 'vless' as Proto, list: nodes },
                                                        { proto: 'hysteria2' as Proto, list: hy },
                                                    ]).filter((t) => t.list.length > 0).map((t) => {
                                                        const id = probeSub(s.path, t.proto)
                                                        /* В смешанной подписке кнопок две — по протоколу: номера
                                                           и клиенты у них свои. */
                                                        const what = mixed && nodes.length > 0 ? ` ${PROTO_LABEL[t.proto]}` : ''
                                                        return (
                                                            <button
                                                                key={t.proto}
                                                                type="button"
                                                                onClick={() => void probe.probeAll(id, t.list.map((n) => n.index))}
                                                                disabled={!!probe.batchSub && probe.batchSub !== id}
                                                                className="flex items-center gap-1 bg-transparent p-0 text-primary disabled:opacity-50"
                                                            >
                                                                {probe.batchSub === id
                                                                    ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                                                    : <Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
                                                                {probe.batchSub === id ? `остановить (осталось ${probe.left})` : `проверить все${what}`}
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    }
                                >
                                    <ul className="divide-y divide-border">
                                        <li className="py-1">
                                            <Choice
                                                on={any}
                                                round
                                                onClick={() => anyOf(s.path, anyProto)}
                                                disabled={!s.present}
                                                title="любая рабочая"
                                                /* Узел не закреплён: движок проверяет их при
                                                 * подъёме и берёт первый ответивший. Для человека
                                                 * важно следствие — такой выход переживает смену
                                                 * состава подписки, а закреплённый нет. */
                                                hint="не сломается при обновлении подписки"
                                            />
                                        </li>
                                        {s.present && nodes && hy.length === 0 && (foreignBySub[s.path] || 0) > 0 && (
                                            /* Чужие ссылки есть, а узлов hysteria2 из них не вышло — почти
                                               всегда модуля нет. Назван пакет и число узлов, а не
                                               «ошибка»: это и есть следующий шаг. В смешанной подписке
                                               узлы VLESS остаются выбираемыми, а сказано о недостающей
                                               половине. */
                                            <li className="px-2.5 py-2.5 text-xs text-muted-foreground">
                                                {live?.build?.modules && !live.build.modules.includes('hysteria2')
                                                    ? (nodes.length === 0
                                                        ? 'Узлов нет: для ссылок hysteria2 не установлен пакет steer-hysteria2.'
                                                        : `В подписке ещё ${foreignBySub[s.path]} узлов hysteria2: нужен пакет steer-hysteria2.`)
                                                    : (nodes.length === 0
                                                        ? 'Узлов нет: ядро не приняло ссылки этой подписки.'
                                                        : `Ядро не приняло ещё ${foreignBySub[s.path]} ссылок этой подписки.`)}
                                            </li>
                                        )}
                                        {s.present && mixed && nodes && nodes.length > 0 && (
                                            /* Вторая «любая рабочая» — для hysteria2: клиенты разные, и
                                               одна строка не может быть обоими. */
                                            <li>
                                                <Choice
                                                    on={has({ kind: 'any', sub: s.path, proto: 'hysteria2' })}
                                                    round
                                                    onClick={() => anyOf(s.path, 'hysteria2')}
                                                    title="любая рабочая (hysteria2)"
                                                />
                                            </li>
                                        )}
                                        {nodes === undefined && s.present && (
                                            <li className="px-2.5 py-2.5 text-xs text-muted-foreground">узлы читаются…</li>
                                        )}
                                        {nodes === null && s.present && (
                                            <li className="px-2.5 py-2.5 text-xs text-muted-foreground">
                                                локации появятся после «Применить»
                                            </li>
                                        )}
                                        {q && nodes && !shown.length && (
                                            <li className="px-2.5 py-2.5 text-xs text-muted-foreground">ничего не нашлось</li>
                                        )}
                                        {shown.map(({ nd, proto }) => {
                                            const cc = ccFromName(nd.name);
                                            const on = picked.has(pickKey(proto, nd.index))
                                            /* Страна справа — только когда её нет в самом названии:
                                               «Германия №2 … Германия» повторяло слово дважды. */
                                            const cName = country(cc)
                                            const cHint = cName && !plainName(nd.name).toLowerCase().includes(cName.toLowerCase()) ? cName : undefined
                                            /* Протокол подписан у узла, когда в подписке есть hysteria2:
                                               в смешанной без подписи не отличить, какой клиент их
                                               понесёт. В подписке целиком из VLESS подписи нет. */
                                            const hint = mixed ? [PROTO_LABEL[proto], cHint].filter(Boolean).join(' · ') : cHint
                                            const key = probeKey(probeSub(s.path, proto), nd.index)
                                            const ph = probe.phase[key]
                                            const err = probe.fails[key]
                                            const pr = probe.probes[key]
                                            const label = plainName(nd.name) || `узел ${nd.index + 1}`
                                            return (
                                                <li key={`${proto}:${nd.index}`} className="flex items-center gap-1 py-1">
                                                    <Choice
                                                        on={on}
                                                        /* Квадрат — набор, круг — одно из. Движок
                                                           без пула берёт одну локацию, и вторая
                                                           отметка на нём переезжает, а не
                                                           добавляется; форма отметки говорит об
                                                           этом сама (см. pool-one-location). */
                                                        round={!pools}
                                                        onClick={() => toggleNode(s.path, nd.index, proto)}
                                                        flag={cc}
                                                        title={label}
                                                        hint={hint}
                                                        /* Замер — в строке узла, напротив имени: вопрос
                                                           человека «какую взять», и ответ обязан стоять
                                                           там же, где отметка. Пока строка в работе,
                                                           показывается состояние, а не прошлый замер:
                                                           старое «90 мс» рядом с идущей проверкой
                                                           читается как её результат. */
                                                        trail={
                                                            ph === 'queued' ? <span className="text-muted-foreground">в очереди</span>
                                                            : ph === 'running' ? <span className="flex items-center gap-1 text-muted-foreground"><LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />проверяю…</span>
                                                            : err ? <span className="text-destructive" title={err}>не проверился</span>
                                                            : pr ? (pr.ok
                                                                ? <span className={latencyTone(pr.ttfb_ms) === 'good' ? 'text-success' : latencyTone(pr.ttfb_ms) === 'ok' ? 'text-muted-foreground' : 'text-warning-fg'}>
                                                                    {pr.ttfb_ms} мс
                                                                  </span>
                                                                /* Причину показываем целиком: «не работает» без
                                                                   причины заставляет угадывать между ключом,
                                                                   транспортом и мёртвым сервером — а движок это
                                                                   различает. */
                                                                : <span className="text-destructive" title={pr.why}>{pr.why || 'не отвечает'}</span>)
                                                            : undefined
                                                        }
                                                    />
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 w-7 shrink-0 p-0"
                                                        disabled={!!ph}
                                                        /* Имя узла в подписи не повторяется: строка рядом уже
                                                           названа им, а второй элемент с тем же именем путал
                                                           бы и читалку, и стенды. */
                                                        aria-label="проверить отклик"
                                                        title={`проверить отклик: ${label}`}
                                                        onClick={() => void probe.probeOne(probeSub(s.path, proto), nd.index)}
                                                    >
                                                        <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
                                                    </Button>
                                                </li>
                                            )
                                        })}
                                        {(folded || (!q && openSubs[s.path] && all.length > FOLD)) && (
                                            <li className="py-1">
                                                <button
                                                    type="button"
                                                    onClick={() => setOpenSubs((m) => ({ ...m, [s.path]: !m[s.path] }))}
                                                    className="w-full rounded-lg bg-transparent px-2.5 py-1.5 text-left text-xs text-primary hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                                >
                                                    {folded ? `показать все ${all.length} локаций` : 'свернуть'}
                                                </button>
                                            </li>
                                        )}
                                    </ul>
                                </Group>
                            )
                        })}

                        <Group head={<CardHead title="Свои туннели" />}>
                            <ul className="divide-y divide-border">
                                {offered.length === 0 && (
                                    <li className="py-3 text-xs text-muted-foreground">
                                        туннельных устройств нет
                                    </li>
                                )}
                                {offered.map((t) => {
                                    const on = has({ kind: 'dev', dev: t.name })
                                    const busy = taken.has(t.name)
                                    /* Чьё это устройство: у локации подписки его создаёт сам
                                     * движок, и человеку оно известно именем выхода. */
                                    const owner = Object.entries(spec.outputs).find(
                                        ([n, o]) =>
                                            n !== name &&
                                            o.kind !== 'interface' &&
                                            (o.device === t.name || o.devices?.includes(t.name)),
                                    )?.[0]
                                    return (
                                        <li key={t.name} className="py-1">
                                            <Choice
                                                on={on}
                                                disabled={busy && !on}
                                                onClick={() => toggleDev(t.name)}
                                                dot={t.up}
                                                title={t.name}
                                                hint={busy && !on ? 'занято другим выходом' : owner ? `выход ${owner}` : t.kind}
                                            />
                                        </li>
                                    )
                                })}
                            </ul>
                        </Group>
                </div>

                {/* ---- справа: имя, порядок и отказ --------------------------------------
                    На широком экране колонка липнет к верху и остаётся на виду, пока человек
                    листает локации; на узком идёт ПЕРВОЙ — выбранное важнее перечня, из которого
                    выбирают, а перечень на телефоне длиной в несколько экранов. */}
                {/* На узком экране колонка — `contents`: её карточки становятся пунктами сетки
                    сами и встают ПЕРВЫМИ (order-first), а удаление — последним (order-last), в
                    самом низу под перечнем, как «Удалить правило» в приложении. Иначе кнопка
                    удаления оказывалась посреди экрана, между настройками и перечнем локаций. */}
                <div className="contents xl:sticky xl:top-4 xl:block xl:min-w-0 xl:space-y-4 xl:self-start">
                    {/* Имя и «если всё упало» — одной карточкой, как верх карточки выхода в
                        приложении: «если всё упало [список]» строкой «подпись — поле». Сегментами
                        эти два варианта не встали: на 390 пикселях «остановить трафик»
                        обрезалось до «остановить тра…». */}
                    <Block className="order-first xl:order-none">
                        <Field label="имя выхода">
                            <input
                                value={title}
                                onChange={(e) => setTitle(e.currentTarget.value)}
                                placeholder="имя выхода"
                                aria-label="имя выхода"
                                className={`${inputCls} w-full`}
                            />
                        </Field>
                        <div className="border-t border-border pt-1">
                            <FieldRow label="Если всё упало">
                                <select
                                    value={onFail}
                                    onChange={(e) => setOnFail(e.currentTarget.value as OnFail)}
                                    className={`${inputCls} w-full`}
                                >
                                    {(['drop', 'direct'] as OnFail[]).map((v) => (
                                        <option key={v} value={v}>{ON_FAIL_TEXT[v]}</option>
                                    ))}
                                </select>
                            </FieldRow>
                        </div>
                    </Block>

                    <Block className="order-first xl:order-none">
                        <CardHead title="Порядок предпочтения" meta={rows.length || undefined} />
                            {rows.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                    ничего не выбрано — отметьте локации или туннели в списке «Что можно взять»
                                </p>
                            ) : (
                                <ol aria-label="порядок предпочтения">
                                    {rows.map((r, i) => {
                                        const nd = r.kind === 'node' ? nodeOf(r.sub, r.idx, r.proto) : undefined
                                        const cc = r.kind === 'node' ? ccFromName(nd?.name) : undefined
                                        const label =
                                            r.kind === 'dev'
                                                ? r.dev
                                                : r.kind === 'any'
                                                  ? 'любая рабочая'
                                                  : plainName(nd?.name) || `узел ${r.idx + 1}`
                                        /* Протокол назван у строки hysteria2 и у любой строки смешанной
                                           подписки: иначе «узел 3» двух клиентов не отличить. */
                                        const hint = r.kind === 'dev'
                                            ? undefined
                                            : r.proto === 'hysteria2' || (hyBySub[r.sub]?.length ?? 0) > 0
                                              ? `${subTitle(r.sub)} · ${PROTO_LABEL[r.proto]}`
                                              : subTitle(r.sub)
                                        /* Соседние локации одной подписки — одна часть пула, и это
                                           видно: между ними нет волосяной линии, а слева их
                                           объединяет общая полоса цвета акцента. Граница блока
                                           показывает, где кончается переключение внутри клиента
                                           и начинается сторож движка. Строки своих туннелей
                                           полосы не несут — они части сами по себе. */
                                        const prev = rows[i - 1]
                                        const joined = !!prev && prev.kind === 'node' && r.kind === 'node' && prev.sub === r.sub && prev.proto === r.proto
                                        return (
                                            <li
                                                key={rowKey(r)}
                                                draggable={pools}
                                                onDragStart={(e) => {
                                                    setDrag(i)
                                                    e.dataTransfer?.setData('text/plain', String(i))
                                                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                                                }}
                                                onDragOver={(e) => { e.preventDefault(); if (over !== i) setOver(i) }}
                                                onDragLeave={() => { if (over === i) setOver(null) }}
                                                onDrop={(e) => {
                                                    e.preventDefault()
                                                    if (drag !== null) move(drag, i)
                                                    setDrag(null)
                                                    setOver(null)
                                                }}
                                                onDragEnd={() => { setDrag(null); setOver(null) }}
                                                className={[
                                                    /* min-w-0: строка обязана ужиматься вместе с карточкой, иначе
                                                       кнопки справа уезжают за её край и режутся (владелец: «сами
                                                       пилюли обрезаются»). Ужимаются название и подпись подписки;
                                                       кнопки — нет. */
                                                    'flex min-h-[44px] min-w-0 items-center gap-2 border-l-2 py-1.5 pl-2 transition-colors',
                                                    i > 0 && !joined ? 'border-t border-t-border' : '',
                                                    r.kind === 'dev' ? 'border-l-transparent' : 'border-l-primary/50',
                                                    over === i && drag !== null && drag !== i ? 'bg-primary/10' : '',
                                                    drag === i ? 'opacity-50' : '',
                                                ].join(' ')}
                                            >
                                                {pools ? (
                                                    <GripVertical
                                                        className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground"
                                                        aria-hidden="true"
                                                    />
                                                ) : (
                                                    <span className="h-4 w-4 shrink-0" aria-hidden="true" />
                                                )}
                                                <span className="w-4 text-[11px] tabular-nums text-muted-foreground">
                                                    {i + 1}
                                                </span>
                                                {r.kind === 'node' && <Flag cc={cc} />}
                                                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{label}</span>
                                                {/* Подпись подписки — ТОЛЬКО НА ПЕРВОЙ строке блока.
                                                    Соседние строки одной подписки и так слиты в один
                                                    блок без зазора, и повторять на каждой «Riot VPN
                                                    (Основной)» — значит трижды сказать то, что уже
                                                    видно, и трижды отнять место у названия локации.

                                                    Ширина в долях, а не в rem: девять фиксированных
                                                    съедали почти всю строку в узкой колонке справа, и
                                                    название резалось до «Эстония №2 — …», хотя резать
                                                    надо было подпись. Название важнее: подписка на
                                                    строке одна, а локаций несколько, и различаются они
                                                    именно названием. */}
                                                {hint && !joined && (
                                                    <span className="hidden min-w-0 max-w-[40%] shrink truncate text-[11px] text-muted-foreground sm:inline">
                                                        {hint}
                                                    </span>
                                                )}
                                                {pools && (
                                                    <>
                                                        <IconBtn label={`строка ${i + 1} выше`} onClick={() => move(i, i - 1)} disabled={i === 0}>
                                                            <ArrowUp className="h-4 w-4" />
                                                        </IconBtn>
                                                        <IconBtn label={`строка ${i + 1} ниже`} onClick={() => move(i, i + 1)} disabled={i === rows.length - 1}>
                                                            <ArrowDown className="h-4 w-4" />
                                                        </IconBtn>
                                                    </>
                                                )}
                                                <IconBtn label={`убрать строку ${i + 1}`} onClick={() => setRows(rows.filter((_, k) => k !== i))} danger>
                                                    <X className="h-4 w-4" />
                                                </IconBtn>
                                            </li>
                                        )
                                    })}
                                </ol>
                            )}
                            <p className="text-xs text-muted-foreground">
                                Первая живая строка забирает трафик; когда верхняя оживает, трафик
                                возвращается к ней сам.
                                {pools && (
                                    <>
                                        {' '}Строки можно тащить мышью или переставлять стрелками, локации
                                        разных подписок — в любом порядке.
                                    </>
                                )}
                                {subsInRows.size > 0 && rows.length > 1 && pools && (
                                    <>
                                        {/* Разница во времени берётся отсюда: соседние локации одной
                                          * подписки обслуживает ОДИН клиент движка и переключается
                                          * между ними сам, а между остальными строками переключает
                                          * сторож движка — он ходит раз в минуту. Человеку нужно
                                          * только само время: от него зависит, как он расставит
                                          * строки. */}
                                        {' '}Между соседними локациями одной подписки трафик
                                        переходит за секунды, между остальными строками — до минуты.
                                    </>
                                )}
                            </p>
                    </Block>

                    <OutputAdvanced
                        className="order-first xl:order-none"
                        adv={adv}
                        onChange={setAdv}
                        spec={spec}
                        self={new Set([name, ...partsOf(spec, name).map(([k]) => k), title.trim()].filter(Boolean) as string[])}
                        show={{
                            tunnel: subsInRows.size > 0,
                            vless: rows.some((r) => r.kind !== 'dev' && r.proto === 'vless'),
                            iface: rows.length === 1 && rows[0].kind === 'dev',
                            pool: rows.length > 1,
                        }}
                    />

                    {name && (
                        <div className="order-last xl:order-none">
                            <DangerButton full onClick={remove}>
                                <Trash2 aria-hidden="true" /> Удалить
                            </DangerButton>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
/** Строка выбора: квадратная отметка — набор, круглая (`round`) — одно из нескольких. */
function Choice({
    on, onClick, disabled, title, hint, flag, dot, round, trail,
}: {
    on: boolean
    onClick: () => void
    disabled?: boolean
    title: string
    hint?: string
    flag?: string
    /** Точка состояния устройства: поднято или нет. */
    dot?: boolean
    round?: boolean
    /** Хвост строки — замер узла или его состояние. Виден и на узком экране: ради этого
     *  числа строку и проверяли. */
    trail?: React.ReactNode
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={`flex w-full items-center gap-2.5 select-none rounded-lg bg-transparent min-h-[40px] px-2.5 py-1.5 text-left text-[13px] focus:outline-none focus:shadow-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 ${
                on ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
            }`}
        >
            {round ? (
                <span
                    className={`h-4 w-4 shrink-0 rounded-full border ${
                        on ? 'border-[5px] border-primary' : 'border-input'
                    }`}
                    aria-hidden="true"
                />
            ) : (
                <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        on ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                    }`}
                    aria-hidden="true"
                >
                    {on && <Check className="h-3 w-3" />}
                </span>
            )}
            {flag !== undefined && <Flag cc={flag} />}
            {dot !== undefined && (
                <span
                    className={`h-2 w-2 shrink-0 rounded-full ${dot ? 'bg-success' : 'bg-muted-foreground'}`}
                    aria-hidden="true"
                />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
            {/* Подсказка справа на узком экране прячется: она отъедала место у названия, и
                «любая рабочая» обрезалось до «любая р…». */}
            {hint && <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{hint}</span>}
            {trail && <span className="shrink-0 text-[11px] tabular-nums">{trail}</span>}
        </button>
    )
}

function IconBtn({
    label, onClick, disabled, danger, children,
}: {
    label: string
    onClick: () => void
    disabled?: boolean
    danger?: boolean
    children: React.ReactNode
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            className={`sp-row shrink-0 bg-transparent p-0 text-muted-foreground disabled:opacity-30 ${
                danger ? 'hover:text-destructive' : 'hover:text-foreground'
            }`}
        >
            {children}
        </button>
    )
}

import { S } from '@/copy'
import { isPart, isUpstreamGroup, type Channel, type Output, type Spec, type Upstream } from '@/lib/model'

/** Кто держит выход: всё в спеке, что называет выход по имени.
 *
 *  ЗАЧЕМ. Выход называют не только правила. По имени на него ссылаются ещё сервер DNS («через
 *  выход», `dns.upstreams.<имя>.out`), свой сервер DNS прямо в правиле, группа (член), туннель
 *  (`over` — трафик самого туннеля идёт через другой выход). Ядро проверяет каждую такую ссылку
 *  («выхода «wg1» нет в outputs») и отвергает спеку ЦЕЛИКОМ. Панель же при удалении и переименовании
 *  выхода смотрела только на правила: человек убирал выход, через который ходит DNS, экран это
 *  принимал, а сохранение (`spec_set`) каждый раз отказывало — и это были не только эта правка, а
 *  все следующие: в памяти страницы лежала спека с висячей ссылкой, и она уезжала на роутер целиком
 *  после каждого нажатия. «Применить» применяло прежнюю спеку с диска, а текст отказа был словами
 *  ядра с путём временного файла. Лечилось руками: найти сервер DNS и выбрать ему другой выход.
 *
 *  Поэтому место, которое знает всех держателей выхода, одно, и им пользуются все, кто выход убирает
 *  (`outputUsers`, `outputBusy`), переименовывает (`renameRefs`) и объясняет отказ ядра
 *  (`missingText`). Ссылки названы ровно теми ключами спеки v2, где ядро их проверяет
 *  (steer/docs/spec-v2.md, «Ссылки по именам»; src/model/v2.c). */

/** Вид ссылки на выход. */
type RefKind = 'rule' | 'ruleDns' | 'dns' | 'over' | 'group'

interface Ref {
    kind: RefKind
    /** Как держатель называется для человека: правило, сервер DNS, группа; у части пула — пул. */
    holder: string
    /** Имя самого держателя в `outputs` — у `over` и `group`: выход, убираемый вместе с выходом, его
     *  держателем не считается (части пула уходят вместе с пулом). */
    self?: string
    /** Выход, на который ссылаются. */
    out: string
}

/** Свой сервер прямо в правиле (`dns: { url, out, … }`) — не имя и не группа серверов. */
function ownUpstream(c: Channel): Upstream | undefined {
    const d = c.dns
    return d && typeof d !== 'string' && !isUpstreamGroup(d) ? d : undefined
}

/** Все ссылки спеки на выходы по имени — одним обходом, в порядке спеки. */
function refsOf(spec: Spec): Ref[] {
    const out: Ref[] = []
    for (const c of spec.channels || []) {
        if (c.out) out.push({ kind: 'rule', holder: c.name, out: c.out })
        const own = ownUpstream(c)
        if (own?.out) out.push({ kind: 'ruleDns', holder: c.name, out: own.out })
    }
    for (const [n, u] of Object.entries(spec.dns?.upstreams || {})) {
        if (u.out) out.push({ kind: 'dns', holder: n, out: u.out })
    }
    for (const [n, o] of Object.entries(spec.outputs || {})) {
        const holder = isPart(o) ? (o.part_of as string) : n
        if (o.over) out.push({ kind: 'over', holder, self: n, out: o.over })
        if (o.kind === 'group') for (const m of o.members || []) out.push({ kind: 'group', holder, self: n, out: m })
    }
    return out
}

/** Держатели выхода по видам. Имена без повторов, в порядке спеки. */
export interface OutputUsers {
    /** Правила, которые ведут трафик в выход. */
    rules: string[]
    /** Серверы DNS раздела «DNS», запросы которых идут через выход. */
    dns: string[]
    /** Правила со своим сервером DNS, запросы которого идут через выход. */
    ruleDns: string[]
    /** Группы, в которых выход — член. */
    groups: string[]
    /** Туннели, трафик которых идёт через выход; часть пула называется своим пулом. */
    over: string[]
}

const KIND_FIELD: Record<RefKind, keyof OutputUsers> = {
    rule: 'rules', ruleDns: 'ruleDns', dns: 'dns', over: 'over', group: 'groups',
}

function usersOf(refs: Ref[]): OutputUsers {
    const u: OutputUsers = { rules: [], dns: [], ruleDns: [], groups: [], over: [] }
    for (const r of refs) {
        const list = u[KIND_FIELD[r.kind]]
        if (!list.includes(r.holder)) list.push(r.holder)
    }
    return u
}

const nobody = (u: OutputUsers) => Object.values(u).every((l) => l.length === 0)

/** Кто держит выходы `names` (убираемые вместе: пул и его части). Держатели из самого `names` не
 *  считаются — они уходят вместе с ними. */
export function outputUsers(spec: Spec, names: Iterable<string>): OutputUsers {
    const gone = new Set(names)
    return usersOf(refsOf(spec).filter((r) => gone.has(r.out) && !(r.self !== undefined && gone.has(r.self))))
}

/** Перечень держателей словами: «правила — YouTube; серверы DNS — cloudflare». */
function usersText(u: OutputUsers): string {
    const t = S.outputRefs
    return [
        u.rules.length && t.pravila(u.rules.join(', ')),
        u.dns.length && t.serveryDns(u.dns.join(', ')),
        u.ruleDns.length && t.dnsPravil(u.ruleDns.join(', ')),
        u.groups.length && t.gruppy(u.groups.join(', ')),
        u.over.length && t.tunneli(u.over.join(', ')),
    ].filter(Boolean).join('; ')
}

/** Почему выход `name` (с частями `names`) убрать нельзя — текстом для человека; `null` — можно.
 *  Отказ называет каждого держателя, а не только правила: выход, через который ходит DNS, убирается
 *  так же осознанно, как выход под правилами. Молча переводить такой DNS «напрямую» нельзя: сервер,
 *  доступный только через туннель, после этого не отвечал бы, и имена под правилами оставались без
 *  ответа. */
export function outputBusy(spec: Spec, name: string, names: Iterable<string> = [name]): string | null {
    const u = outputUsers(spec, names)
    return nobody(u) ? null : S.outputRefs.ispolzuetsya(name, usersText(u))
}

/** Выходы, которых нет в спеке, но на которые она ссылается. Слово `direct` у сервера DNS — «напрямую»
 *  и без выхода с таким именем (spec-v2.md, `dns.upstreams.<имя>.out`). */
function missingRefs(spec: Spec): Ref[] {
    const have = new Set(Object.keys(spec.outputs || {}))
    const dnsKind = (k: RefKind) => k === 'dns' || k === 'ruleDns'
    return refsOf(spec).filter((r) => !have.has(r.out) && !(dnsKind(r.kind) && r.out === 'direct'))
}

/** Висячие ссылки на выходы словами — когда ядро отвергло спеку, а такая ссылка в ней есть; `null` —
 *  висячих ссылок нет, и причина в другом (тогда говорит само ядро).
 *
 *  Слова ядра («dns.upstreams.cf.out: выхода «wg1» нет в outputs», с путём временного файла и
 *  строкой) человеку ничего не говорят, а разбирать их текст здесь незачем: судья — ядро, а сказать,
 *  КТО ссылается на выход, которого нет, спека умеет сама. */
export function missingText(spec: Spec): string | null {
    const refs = missingRefs(spec)
    if (!refs.length) return null
    const names = [...new Set(refs.map((r) => r.out))]
    return names.map((n) => S.outputRefs.netVyhoda(n, usersText(usersOf(refs.filter((r) => r.out === n))))).join('\n')
}

/** Выход переименован: всё, что называло его прежним именем, называет новым — правила, свой сервер DNS
 *  в правиле, серверы DNS раздела «DNS», `over` туннелей, члены групп и `default` группы «вручную».
 *  Сам ключ в `outputs` правит тот, кто переименовал: редакторы пересобирают список выходов. */
export function renameRefs(spec: Spec, from: string, to: string): Spec {
    if (from === to) return spec
    const sw = (n: string) => (n === from ? to : n)
    const channels = spec.channels.map((c) => {
        const own = ownUpstream(c)
        if (c.out !== from && own?.out !== from) return c
        return { ...c, out: sw(c.out), ...(own?.out === from ? { dns: { ...own, out: to } } : {}) }
    })
    const outputs: Record<string, Output> = {}
    for (const [k, o] of Object.entries(spec.outputs)) {
        let next = o
        if (o.over === from) next = { ...next, over: to }
        if (o.kind === 'group' && o.members?.includes(from)) {
            next = { ...next, members: o.members.map(sw), ...(o.default === from ? { default: to } : {}) }
        }
        outputs[k] = next
    }
    const ups = spec.dns?.upstreams
    const upstreams = ups && Object.values(ups).some((u) => u.out === from)
        ? Object.fromEntries(Object.entries(ups).map(([k, u]) => [k, u.out === from ? { ...u, out: to } : u]))
        : ups
    return { ...spec, channels, outputs, ...(spec.dns && upstreams !== ups ? { dns: { ...spec.dns, upstreams } } : {}) }
}

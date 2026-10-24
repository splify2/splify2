import { isPart, type Channel, type Output, type Spec } from '@/lib/model'
import { S } from '@/copy'

/** Сравнение спек по смыслу и список изменений между двумя спеками (D-P2.4).
 *
 *  Список — не счётчик позиций: каждая строка называет, что изменилось (правило, выход, общие
 *  настройки), и умеет себя отменить поверх ТЕКУЩЕЙ спеки. Отмена одной строки не откатывает соседние
 *  правки, поэтому «отменить по пункту» и «отменить всё» — один и тот же механизм, только по одной
 *  строке или по всем. Правила и выходы сопоставляются по имени, а не по месту: вставка правила в
 *  начало не должна читаться как «изменились все правила ниже». */

/** Поля, отсутствие которых значит РОВНО ТО ЖЕ, что записанное значение.
 *
 *  Взято из контракта движка (steer/docs/contract-v1.md): поля нет — действует умолчание.
 *  Имена не пересекаются между каналом и выходом в этой схеме (`enabled` и `mode` бывают
 *  только у канала, `on_fail` и `node` — только у выхода), поэтому таблица одна на оба.
 *
 *  ЗАЧЕМ. Интерфейс пишет умолчания ЯВНО, а движок и архивы — как получилось. Пока сравнение
 *  шло по JSON.stringify, выключить правило и включить обратно означало вечное «Применить · 1»
 *  на правке, которая ничего не меняет: в спеке появлялось `"enabled": true`, которого в
 *  снимке применённого не было. Поймано живым проходом по интерфейсу — пилюля висела над
 *  списком и перехватывала клики по строкам под собой. */
const DEFAULTS: Record<string, unknown> = {
    enabled: true,
    on_fail: 'drop',
    mode: 'fakeip',
    /** −1 и пустой список означают одно: «первый рабочий среди всех пригодных». */
    node: -1,
}

/** Канонический вид для СРАВНЕНИЯ (не для записи): ключи по алфавиту, поля с умолчанием и
 *  пустые списки выброшены.
 *
 *  Порядок ключей тоже выброшен нарочно: он ничего не значит ни для движка, ни для человека,
 *  а JSON.stringify считал его различием — то есть спека, пересобранная другим порядком
 *  полей, показывала бы «не применено» на всех правилах сразу. */
export function canon(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canon)
    if (!v || typeof v !== 'object') return v
    const src = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(src).sort()) {
        const val = src[k]
        if (val === undefined) continue
        if (k in DEFAULTS && val === DEFAULTS[k]) continue
        if (Array.isArray(val) && val.length === 0) continue
        out[k] = canon(val)
    }
    return out
}

/** Спека без выходов и правил — то, что счётчик сравнивает целиком, одной правкой. `schema`
 *  и `lan_device` сюда не входят: первое — номер формы записи, а не настройка (движку уезжает
 *  свой, см. expandNarrow), второе normalizeSpec уже привёл к `lan_devices`. */
export function rest(spec: Spec): Record<string, unknown> {
    const { outputs: _o, channels: _c, schema: _s, lan_device, lan_devices, ...r } =
        spec as Spec & { lan_device?: string }
    /* Устройства клиентов — к одной форме: одиночная запись `lan_device` (спека времён 1.2.5)
     * и отсутствие поля значат «br-lan», и снимок применённого в такой форме против списка
     * из одного элемента в сохранённом давал бы вечное «Применить · 1» — ровно та беда, ради
     * которой этот стенд заведён. Умолчание то же, что у движка и у карточки. */
    const devs = lan_devices?.length ? lan_devices : lan_device ? [lan_device] : ['br-lan']
    return { ...r, lan_devices: devs }
}

/** Одно и то же ли это по смыслу. Отдельной функцией, чтобы сравнение стояло в одном месте:
 *  каналы и выходы сравниваются по одному правилу, и разойтись они не должны. */
export function same(a: unknown, b: unknown): boolean {
    return JSON.stringify(canon(a)) === JSON.stringify(canon(b))
}


export type ChangeKind = 'added' | 'removed' | 'changed' | 'moved'
export type ChangeSubject = 'rule' | 'output' | 'settings' | 'order'

export interface Change {
    /** Стабильный в пределах одного списка ключ строки. */
    id: string
    kind: ChangeKind
    subject: ChangeSubject
    /** Имя правила или выхода; у общих настроек и порядка пусто. */
    name: string
    /** Спека, где эту строку отменили: ложится поверх `cur`. */
    revert: (cur: Spec) => Spec
}

/** Выход вместе со своими частями — одна единица: пул из подписок человек заводит и убирает как один
 *  выход, и «Добавлен выход vpn.1, vpn.2, vpn» читалось бы как три правки. */
function outputUnits(outputs: Record<string, Output> | undefined): Map<string, [string, Output][]> {
    const units = new Map<string, [string, Output][]>()
    for (const [k, o] of Object.entries(outputs || {})) {
        const owner = isPart(o) ? o.part_of! : k
        const list = units.get(owner) || []
        list.push([k, o])
        units.set(owner, list)
    }
    return units
}

const unitSame = (a: [string, Output][], b: [string, Output][]) =>
    same(Object.fromEntries(a), Object.fromEntries(b))

/** Выходы спеки без единицы `owner` и с единицей `put` (или без неё). Порядок ключей сохраняется:
 *  вернувшийся выход встаёт на прежнее место среди оставшихся, если оно известно. */
function withUnit(outputs: Record<string, Output>, owner: string, put: [string, Output][] | undefined, order: string[]): Record<string, Output> {
    const keep = Object.entries(outputs).filter(([k, o]) => k !== owner && o.part_of !== owner)
    const all = new Map<string, Output>(keep)
    for (const [k, o] of put || []) all.set(k, o)
    const rank = (k: string) => { const i = order.indexOf(k); return i < 0 ? Infinity : i }
    return Object.fromEntries([...all].sort((a, b) => rank(a[0]) - rank(b[0])))
}

/** Что изменилось между `from` (было) и `to` (стало): строки с отменой.
 *  Спеки без `outputs`/`channels` (чужие файлы, стенды) читаются пустыми. */
export function describeChanges(from: Spec, to: Spec): Change[] {
    const out: Change[] = []

    // -- правила: по именам; повторяющиеся имена сопоставить нечем — тогда по месту
    const fc = from.channels || []
    const tc = to.channels || []
    const names = (l: Channel[]) => l.map((c) => c.name)
    const unique = new Set(names(fc)).size === fc.length && new Set(names(tc)).size === tc.length
    const key = (c: Channel, i: number) => (unique ? `n:${c.name}` : `i:${i}`)
    const fm = new Map(fc.map((c, i) => [key(c, i), c]))
    const tm = new Map(tc.map((c, i) => [key(c, i), c]))
    const fOrder = fc.map(key)

    for (const [k, c] of tm) {
        const old = fm.get(k)
        if (!old) {
            out.push({
                id: `rule+${k}`, kind: 'added', subject: 'rule', name: c.name,
                revert: (cur) => ({ ...cur, channels: (cur.channels || []).filter((x, i) => key(x, i) !== k || !same(x, c)) }),
            })
        } else if (!same(old, c)) {
            out.push({
                id: `rule~${k}`, kind: 'changed', subject: 'rule', name: c.name,
                revert: (cur) => {
                    const ch = cur.channels || []
                    const at = ch.findIndex((x, i) => key(x, i) === k)
                    return at < 0 ? { ...cur, channels: [...ch, old] } : { ...cur, channels: ch.map((x, i) => (i === at ? old : x)) }
                },
            })
        }
    }
    for (const [k, c] of fm) {
        if (tm.has(k)) continue
        out.push({
            id: `rule-${k}`, kind: 'removed', subject: 'rule', name: c.name,
            revert: (cur) => {
                const ch = (cur.channels || []).slice()
                if (ch.some((x, i) => key(x, i) === k)) return cur
                /* На прежнее место: после ближайшей выше правилы, которая ещё есть. */
                let at = 0
                for (let j = fOrder.indexOf(k) - 1; j >= 0; j--) {
                    const p = ch.findIndex((x, i) => key(x, i) === fOrder[j])
                    if (p >= 0) { at = p + 1; break }
                }
                ch.splice(at, 0, c)
                return { ...cur, channels: ch }
            },
        })
    }
    // -- порядок общих правил: приоритет, и перестановка — тоже изменение
    if (unique) {
        const common = names(fc).filter((n) => tm.has(`n:${n}`))
        const now = names(tc).filter((n) => fm.has(`n:${n}`))
        if (common.length > 1 && common.some((n, i) => n !== now[i])) {
            out.push({
                id: 'order', kind: 'moved', subject: 'order', name: '',
                revert: (cur) => {
                    const ch = (cur.channels || []).slice()
                    const slots = ch.map((c, i) => (common.includes(c.name) ? i : -1)).filter((i) => i >= 0)
                    const byName = new Map(ch.map((c) => [c.name, c]))
                    const want = common.filter((n) => byName.has(n))
                    slots.forEach((slot, i) => { if (want[i]) ch[slot] = byName.get(want[i])! })
                    return { ...cur, channels: ch }
                },
            })
        }
    }

    // -- выходы: единицами
    const fu = outputUnits(from.outputs)
    const tu = outputUnits(to.outputs)
    const fOutOrder = Object.keys(from.outputs || {})
    for (const [owner, u] of tu) {
        const old = fu.get(owner)
        if (!old) {
            out.push({
                id: `out+${owner}`, kind: 'added', subject: 'output', name: owner,
                revert: (cur) => ({ ...cur, outputs: withUnit(cur.outputs || {}, owner, undefined, fOutOrder) }),
            })
        } else if (!unitSame(old, u)) {
            out.push({
                id: `out~${owner}`, kind: 'changed', subject: 'output', name: owner,
                revert: (cur) => ({ ...cur, outputs: withUnit(cur.outputs || {}, owner, old, fOutOrder) }),
            })
        }
    }
    for (const [owner, old] of fu) {
        if (tu.has(owner)) continue
        out.push({
            id: `out-${owner}`, kind: 'removed', subject: 'output', name: owner,
            revert: (cur) => ({ ...cur, outputs: withUnit(cur.outputs || {}, owner, old, fOutOrder) }),
        })
    }

    // -- всё остальное (dns, устройства клиентов, подсети): одна строка
    if (!same(rest(from), rest(to))) {
        const { outputs: _o, channels: _c, ...restOld } = from
        out.push({
            id: 'settings', kind: 'changed', subject: 'settings', name: '',
            revert: (cur) => {
                const { outputs, channels, ...restCur } = cur
                const dropped = Object.fromEntries(Object.keys(restCur).map((k) => [k, undefined]))
                return { ...cur, ...dropped, ...restOld, outputs, channels } as Spec
            },
        })
    }
    return out
}

/** Все выбранные строки отменены поверх `cur`. */
export function revertChanges(cur: Spec, changes: Change[]): Spec {
    return changes.reduce((acc, c) => c.revert(acc), cur)
}

/** Строка для человека: что произошло, одной фразой. */
export function changeText(c: Change): string {
    const t = S.changes
    switch (c.subject) {
        case 'rule': return c.kind === 'added' ? t.praviloDobavleno(c.name) : c.kind === 'removed' ? t.praviloUdaleno(c.name) : t.praviloIzmeneno(c.name)
        case 'output': return c.kind === 'added' ? t.vyhodDobavlen(c.name) : c.kind === 'removed' ? t.vyhodUdalen(c.name) : t.vyhodIzmenen(c.name)
        case 'order': return t.poryadok
        default: return t.nastroyki
    }
}

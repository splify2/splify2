import { cacheGet, cacheSet } from '@/lib/cache'

/** История скорости: что было с трафиком, а не только что сейчас.
 *
 *  Строка «↓ 1,2 Мбит/с» отвечает на вопрос «идёт ли трафик», но не на «шёл ли он минуту назад» и
 *  «что качало ночью». Здесь копятся замеры, которые опрос (lib/live.ts) и так делает, — своих
 *  вызовов и таймеров у истории нет.
 *
 *  ДВЕ РАЗРЕШЕНИЯ, обе ограничены ВРЕМЕНЕМ, а не числом точек: мелкая (каждый замер, как есть) —
 *  последние десять минут, для спарклайна у выхода и правила; крупная (среднее за минуту) — сутки,
 *  для графика на экране «Запросы». Число точек отсюда следует и от частоты опроса не зависит.
 *
 *  ЧЕСТНОСТЬ. История копится, пока страница открыта (сводка на роутере не ведётся), и дыра в ней —
 *  это дыра: закрытая вкладка не дорисовывается нулями. Нуль значил бы «трафика не было», а мы
 *  этого не измеряли. Крупная история переживает перезагрузку страницы (память браузера или
 *  приложения), поэтому дыра между двумя открытиями видна как дыра. */

/** Одна точка: момент (мс Unix) и скорость в бит/с в обе стороны. `up` — отданное роутером в
 *  сторону выхода, `down` — полученное. */
export interface Point { t: number; up: number; down: number }

/** Мелкая история — десять минут. */
export const FINE_MS = 10 * 60 * 1000
/** Крупная — сутки, шаг — минута. */
export const DAY_MS = 24 * 60 * 60 * 1000
export const BIN_MS = 60 * 1000

/** Крупная точка с весом: среднее считается по числу замеров, вошедших в минуту. */
interface Bin extends Point { n: number }

type Dump = Record<string, Bin[]>

export class History {
    private fine = new Map<string, Point[]>()
    private day = new Map<string, Bin[]>()
    /** Растёт с каждой записью: по нему компоненты понимают, что рисовать заново. */
    version = 0
    private savedAt = 0

    constructor(restore?: Dump | null) {
        if (!restore) return
        const edge = Date.now() - DAY_MS
        for (const [k, bins] of Object.entries(restore)) {
            const keep = bins.filter((b) => b.t > edge)
            if (keep.length) this.day.set(k, keep)
        }
    }

    /** Записать замер. Ключ — `ch:<правило>` или `dev:<устройство>`. */
    push(t: number, key: string, up: number, down: number): void {
        let f = this.fine.get(key)
        if (!f) this.fine.set(key, (f = []))
        f.push({ t, up, down })
        const fe = t - FINE_MS
        let drop = 0
        while (drop < f.length && f[drop].t < fe) drop++
        if (drop) f.splice(0, drop)

        let d = this.day.get(key)
        if (!d) this.day.set(key, (d = []))
        const slot = Math.floor(t / BIN_MS) * BIN_MS
        const last = d[d.length - 1]
        if (last && last.t === slot) {
            const n = last.n + 1
            last.up += (up - last.up) / n
            last.down += (down - last.down) / n
            last.n = n
        } else {
            d.push({ t: slot, up, down, n: 1 })
            const de = t - DAY_MS
            let k = 0
            while (k < d.length && d[k].t < de) k++
            if (k) d.splice(0, k)
        }
        this.version++
    }

    series(...keys: string[]): readonly Point[] { return merge(keys.map((k) => this.fine.get(k) ?? EMPTY)) }
    daySeries(...keys: string[]): readonly Point[] { return merge(keys.map((k) => this.day.get(k) ?? EMPTY)) }
    keys(): string[] { return [...this.day.keys()] }

    /** В память — не чаще раза в минуту: запись большого JSON на каждый замер дороже самого опроса. */
    save(now = Date.now()): void {
        if (now - this.savedAt < BIN_MS) return
        this.savedAt = now
        /* Ряд, в котором за сутки не было ни одного замера (правило удалили, выход убрали), уходит. */
        for (const [k, v] of [...this.day]) if (!v.length || v[v.length - 1].t < now - DAY_MS) { this.day.delete(k); this.fine.delete(k) }
        const out: Dump = {}
        for (const [k, v] of this.day) out[k] = v
        cacheSet('history', out)
    }
}

const EMPTY: readonly Point[] = []

/** Сумма рядов по моменту: у пула из нескольких туннелей скорость выхода — сумма его устройств.
 *  Замеры устройств одного круга несут одно и то же время, поэтому сводятся по точному совпадению. */
function merge(rows: readonly (readonly Point[])[]): readonly Point[] {
    const live = rows.filter((r) => r.length)
    if (live.length <= 1) return live[0] ?? EMPTY
    const by = new Map<number, Point>()
    for (const r of live)
        for (const p of r) {
            const c = by.get(p.t)
            if (c) by.set(p.t, { t: p.t, up: c.up + p.up, down: c.down + p.down })
            else by.set(p.t, p)
        }
    return [...by.values()].sort((a, b) => a.t - b.t)
}

/** Куски ряда без дыр: замеров нет дольше `gapMs` — это не «трафика не было», а «страница была
 *  закрыта», и линию там не тянут. */
export function segments(points: readonly Point[], gapMs: number): Point[][] {
    const out: Point[][] = []
    let cur: Point[] = []
    for (const p of points) {
        if (cur.length && p.t - cur[cur.length - 1].t > gapMs) { out.push(cur); cur = [] }
        cur.push(p)
    }
    if (cur.length) out.push(cur)
    return out
}

export function loadHistory(): History {
    return new History(cacheGet<Dump>('history'))
}

/** Пик ряда — масштаб спарклайна: у каждого ряда свой, форма важнее абсолютных чисел (числа рядом). */
export function peak(points: readonly Point[]): number {
    let m = 0
    for (const p of points) m = Math.max(m, p.up, p.down)
    return m
}

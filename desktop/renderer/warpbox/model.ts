// Чистая логика раздела WarpBox: разбор ключей спеки и правки выхода. Без интерфейса — проверяется
// стендом desktop/tests (node --test).
import type { Output, Spec } from '@/lib/model'

type WarpOut = Output & { extra?: Record<string, unknown> }

/** Число из спеки: рукописный файл бывает со строкой («count: "3"») — ядро её читает, экран обязан тоже. */
export const num = (v: unknown, d: number) => {
    const n = typeof v === 'string' && v.trim() ? Number(v) : v
    return typeof n === 'number' && Number.isFinite(n) ? n : d
}
/** Сколько туннелей в группе по спеке: целое от 1 (steer 2.1.0, docs/warp.md: 1..255). */
export const tunnelCount = (v: unknown) => Math.max(1, Math.trunc(num(v, 1)))
/** Правка ключей выхода. Берёт САМУЮ СВЕЖУЮ спеку хранилища, а не ту, с которой нарисован экран:
 *  два щелчка подряд (число туннелей и страна) до перерисовки иначе писали бы каждый поверх спеки
 *  без предыдущего. Ключ без значения (`undefined`) убирается — умолчание ядра. */
export function patchExtra(spec: Spec, name: string, patch: Record<string, unknown>): Spec | null {
    const o = spec.outputs[name] as WarpOut | undefined
    if (!o) return null
    const extra = { ...(o.extra || {}) }
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete extra[k]
        else extra[k] = v
    }
    return { ...spec, outputs: { ...spec.outputs, [name]: { ...o, extra } } }
}

/** Первое свободное имя выхода: warp, warp2, warp3… */
export function freeName(outputs: Record<string, unknown>): string {
    if (!outputs.warp) return 'warp'
    for (let i = 2; ; i++) if (!outputs[`warp${i}`]) return `warp${i}`
}

/** Почему не прочиталось состояние шлюза — словами. Шлюз постарше приложения путь /v1/warp не знает. */
export function infoErrorText(e: { code?: string; message: string }): string {
    return e.code === 'no_route' || /\b404\b/.test(e.message) ? 'Роутер не знает WarpBox — обновите splify2 на роутере' : e.message
}

/** Кнопки числа туннелей: 1–5, а если в спеке больше (до 255) — и это число, чтобы выбор был виден. */
export function countItems(count: number): { value: string; label: string }[] {
    const vals = [1, 2, 3, 4, 5]
    if (!vals.includes(count)) vals.push(count)
    return vals.map((v) => ({ value: String(v), label: String(v) }))
}


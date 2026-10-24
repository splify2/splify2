import { pending } from '@/lib/pending'

/** Автоприменение: сохранённое уходит на роутер само, кнопки «Применить» нет.
 *
 *  Правка записывается автосохранением (lib/pending.ts), а применяется через 0,8 с тишины после
 *  записи — подряд идущие правки уходят ОДНИМ применением. Сохранённое и не применённое ДО
 *  открытия (правили в другом окне, прошлое применение не удалось) применяется сразу после
 *  загрузки. Применять нечего (`count() === 0` — сохранённое равно применённому) — роутер не
 *  трогается.
 *
 *  ПАЧКИ. Операция из нескольких шагов (восстановление из копии, подписка с автосозданием выхода)
 *  берёт `pending.hold()`/`pending.batch()`: пока пачка держится, ни таймер, ни загрузка не
 *  применяют, а после отпускания накопленное применяется одним применением, с той же паузой.
 *
 *  Неудачное применение не повторяется по кругу: следующая попытка — со следующей правкой (или
 *  при следующем открытии страницы, где «сохранённое не применённое» применяется сразу). Об отказе
 *  говорит само хранилище (pending.apply → notify), а страховка на уход со страницы
 *  (pending.unfinished) не даёт закрыть вкладку, пока применение идёт или не удалось.
 *
 *  Возвращает функцию отмены подписки и таймера. */
export const AUTO_APPLY_MS = 800

export function startAutoApply(): () => void {
    /* Правки, которые автоприменение уже учло (применило или признало нечем применять). */
    let seen = -1
    let t: ReturnType<typeof setTimeout> | null = null
    const idle = () => !pending.held && !pending.hasUnsaved() && !pending.applying
    const run = () => {
        t = null
        if (!idle()) return
        seen = pending.editSeq
        if (pending.count() > 0) void pending.apply()
    }
    const check = () => {
        if (!pending.saved || pending.held) return
        if (seen === -1) {
            /* Первый показ: записанное и не применённое до открытия применяется сразу. */
            if (!idle()) return
            seen = pending.editSeq
            if (pending.count() > 0) void pending.apply()
            return
        }
        if (pending.editSeq === seen || !idle()) return
        if (pending.count() === 0) { seen = pending.editSeq; return }
        if (t) clearTimeout(t)
        t = setTimeout(run, AUTO_APPLY_MS)
    }
    const off = pending.subscribe(check)
    check()
    return () => { off(); if (t) clearTimeout(t) }
}

import type { Live } from '@/lib/live'

/** Установка ещё пуста: движок ответил, а выходов (кроме «напрямую») и правил в нём нет. Находки
 *  диагностики здесь — следствие того, что ничего не настроено, а не поломка: экран говорит об этом
 *  и не красится в красное. Пока состояние не пришло или движок молчит — это «не знаем», не «пусто». */
export function blankInstall(live: Pick<Live, 'status' | 'error' | 'phase'>): boolean {
    const st = live.status
    if (!st || live.error || live.phase) return false
    return Object.values(st.outputs || {}).every((o) => o.kind === 'direct') && (st.channels || []).length === 0
}

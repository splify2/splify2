import { useEffect, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { pending, usePending } from '@/lib/pending'
import { changeText, type Change } from '@/lib/specdiff'

import { S } from '@/copy'
/** «Что изменится» и «Что изменилось» вместо счётчика «Применить · N» (D-P2.4).
 *
 *  Применение автоматическое, поэтому у списка две жизни. Пока записанное НЕ применено надолго —
 *  пачку держат (восстановление, подписка с выходом), применение отказало или запись не удалась, —
 *  это «Что изменится»: строки раскрыты, у каждой «Отменить», внизу «Отменить всё». После удавшегося
 *  применения — «Применено: N изменений» со сворачиваемым списком «Что изменилось»: человек видит,
 *  что именно ушло на роутер, и может отменить любую строку, не помня, что менял.
 *
 *  Отмена — обычная правка поверх текущей спеки (pending.revert): записывается и применяется сама, и
 *  отмена одной строки не откатывает соседние. Нет изменений — нет и полосы. */

/** Сколько после применения висит строка «Применено», мс. Раскрытый список остаётся, пока его не скроют. */
const SHOW_MS = 20000

export default function ChangesBar() {
    usePending()
    const [open, setOpen] = useState(false)
    const [, tick] = useState(0)
    const la = pending.lastApplied

    /* Строка применённого уходит сама: таймер на остаток времени. */
    useEffect(() => {
        if (!la || open) return
        const left = la.at + SHOW_MS - Date.now()
        if (left <= 0) return
        const t = setTimeout(() => tick((n) => n + 1), left + 20)
        return () => clearTimeout(t)
    }, [la, open])

    const waiting = pending.changes()
    const stuck = pending.held || pending.applyFailed || pending.saveError !== null
    const mode: 'waiting' | 'applied' | null = waiting.length > 0 && stuck && !pending.applying
        ? 'waiting'
        : la && la.changes.length > 0 && (open || Date.now() - la.at < SHOW_MS) ? 'applied' : null
    if (!mode) return null

    const list: Change[] = mode === 'waiting' ? waiting : la!.changes
    const expanded = mode === 'waiting' || open

    const undo = (items: Change[]) => {
        pending.revert(items)
        if (mode === 'applied') pending.dismissApplied(items.map((c) => c.id))
    }

    return (
        <section aria-label={mode === 'waiting' ? S.changes.chtoIzmenitsya : S.changes.chtoIzmenilos}
                 className="mb-3 rounded-xl border border-border bg-card px-3 py-2 text-sm shadow-card">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">
                    {mode === 'waiting' ? S.changes.zhdetPrimeneniya(list.length) : S.changes.primeneno(list.length)}
                </span>
                <span className="flex-1" />
                {mode === 'applied' && (
                    <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
                            className="bg-transparent text-xs text-primary underline decoration-dotted">
                        {open ? S.changes.skryt : S.changes.pokazat}
                    </button>
                )}
                {expanded && list.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => undo(list)}>
                        <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {S.changes.otmenitVse}
                    </Button>
                )}
            </div>
            {expanded && (
                <ul className="mt-1 divide-y divide-border">
                    {list.map((c) => (
                        <li key={c.id} className="flex items-center gap-2 py-1">
                            <span className="min-w-0 flex-1 truncate">{changeText(c)}</span>
                            <Button variant="ghost" size="sm" onClick={() => undo([c])}>{S.changes.otmenit}</Button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    )
}

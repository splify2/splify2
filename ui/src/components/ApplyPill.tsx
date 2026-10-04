import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { usePending } from '@/lib/pending'

import { S } from '@/copy'
/** Плавающая пилюля «Применить · N» — единственная кнопка применения на весь экран.
 *
 *  Появляется только когда сохранённое отличается от применённого, и исчезает сама,
 *  если человек вернул всё как было: N — это разница со снимком apply, а не число
 *  кликов. Сохранение к этому моменту уже произошло (lib/pending.ts), поэтому пилюля
 *  ничем не рискует: не нажал — настройка просто ждёт на диске.
 *
 *  ЕДИНСТВЕННОЕ ИСКЛЮЧЕНИЕ — ОТКАЗАННАЯ ЗАПИСЬ. Ядро отвергло спеку, на роутере прежняя, и «Применить ·
 *  N» обещало бы то, чего там нет, а подсказка «Изменения уже сохранены» говорила бы неправду. Пока
 *  последняя запись отказана (`saveError`), вместо числа — «Не записано» красным, а в подсказке состояние,
 *  действие и причина. Пилюля при этом остаётся нажимаемой: нажатие снова пробует записать и применяет,
 *  только если удалось. Стоит она и при нулевом числе: правку сделали и вернули, а запись отвергнута —
 *  на роутере всё равно не то, что на экране. */
export default function ApplyPill() {
    const { count, saveError, applying, justApplied, apply } = usePending()
    /* Состояния пилюли — по одному за раз: удавшееся применение и идущее перекрывают отказ записи, а
       после них пилюля говорит об отказе, если он остался. */
    const refused = saveError !== null && !applying && !justApplied
    if (count === 0 && !applying && !justApplied && !refused) return null
    /* На телефоне снизу рельс: пилюля встаёт над ним, а не на него. По горизонтали — по середине
       НАШЕЙ подложки, а не окна (sp-float-center): рядом с колонкой меню темы середина окна
       смещена относительно содержимого, и пилюля уезжала к меню. */
    return (
        <div className="sp-float-center fixed bottom-20 z-50 -translate-x-1/2 lg:bottom-6">
            <button
                type="button"
                onClick={apply}
                disabled={applying}
                title={refused ? S.pending.nastroykiNeZapisany(saveError) : S.applyPill.izmeneniyaUzheSohranenyKnopka}
                className={[
                    'flex h-11 items-center gap-2.5 rounded-full px-6 text-sm font-medium text-white',
                    'shadow-[0_6px_20px_rgba(0,0,0,0.18)] transition-all duration-300',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    justApplied ? 'bg-success' : applying ? 'bg-muted-foreground' : refused ? 'bg-destructive' : 'bg-primary hover:-translate-y-px',
                ].join(' ')}
            >
                {justApplied ? (
                    <>
                        <Check className="h-4 w-4" aria-hidden="true" /> {S.applyPill.primeneno}</>
                ) : applying ? (
                    <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {S.applyPill.primenyaem}</>
                ) : refused ? (
                    <>
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {S.applyPill.neZapisano}</>
                ) : (
                    <>
                        <Check className="h-4 w-4" aria-hidden="true" /> {S.applyPill.primenit}<span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-white/25 px-1.5 text-xs font-semibold">
                            {count}
                        </span>
                    </>
                )}
            </button>
        </div>
    )
}

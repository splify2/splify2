import { forwardRef, useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { S } from '@/copy'

// Мелкие элементы форм, общие для редакторов выхода, группы и раздела DNS. Вынесены, чтобы
// один и тот же выбор «одно из нескольких» выглядел в них одинаково: круглая отметка для
// взаимоисключающего, плашка для набора.

/** Плашка-переключатель: входит в набор или нет. */
export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            aria-pressed={on}
            onClick={onClick}
            className={`rounded-full border px-3 py-1 text-xs ${
                on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'
            }`}
        >
            {children}
        </button>
    )
}

export const inputCls =
    'h-[38px] min-w-0 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'

/** Выбор файла со своей кнопкой. Родной `<input type=file>` пишет «Choose File / No file chosen»
 *  на языке браузера, а не интерфейса; поле остаётся скрытым (по нему находят тесты и экранные
 *  читалки), нажимается кнопка. Имя выбранного файла не показывается: файл уходит сразу. */
export const FileButton = forwardRef<HTMLInputElement, {
    accept: string
    label: string
    disabled?: boolean
    onFile: (f: File) => void
}>(function FileButton({ accept, label, disabled, onFile }, ref) {
    const inner = useRef<HTMLInputElement | null>(null)
    return (
        <>
            <Button type="button" variant="outline" disabled={disabled} onClick={() => inner.current?.click()}>
                {S.listDialogs.vybratFayl}
            </Button>
            <input
                ref={(el) => {
                    inner.current = el
                    if (typeof ref === 'function') ref(el)
                    else if (ref) ref.current = el
                }}
                type="file"
                accept={accept}
                aria-label={label}
                disabled={disabled}
                tabIndex={-1}
                className="hidden"
                onChange={(e) => {
                    const f = e.currentTarget.files?.[0]
                    if (f) onFile(f)
                }}
            />
        </>
    )
})

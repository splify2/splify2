import type { ReactNode } from 'react'

// Мелкие элементы форм, общие для редакторов выхода, группы и раздела DNS. Вынесены, чтобы
// один и тот же выбор «одно из нескольких» выглядел в них одинаково: круглая отметка для
// взаимоисключающего, плашка для набора.

/** Строка с круглой отметкой: одно из нескольких. */
export function Radio({ on, onClick, children, disabled }: {
    on: boolean
    onClick: () => void
    children: ReactNode
    disabled?: boolean
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`flex w-full items-center gap-2.5 select-none rounded-lg bg-transparent px-2.5 py-2 text-left text-[13px] focus:outline-none focus:shadow-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 ${
                on ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
            }`}
        >
            <span
                className={`h-4 w-4 shrink-0 rounded-full border ${on ? 'border-[5px] border-primary' : 'border-input'}`}
                aria-hidden="true"
            />
            <span className="min-w-0 flex-1">{children}</span>
        </button>
    )
}

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

/** Подписанное поле. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block space-y-1">
            <span className="sp-label uppercase tracking-wide text-muted-foreground">{label}</span>
            {children}
        </label>
    )
}

/** Число или пусто: пустая строка — «не задано», а не ноль. */
export function NumField({ label, value, onChange, placeholder, min, max }: {
    label: string
    value: number | undefined
    onChange: (v: number | undefined) => void
    placeholder?: string
    min?: number
    max?: number
}) {
    return (
        <Field label={label}>
            <input
                type="number"
                inputMode="numeric"
                value={value ?? ''}
                min={min}
                max={max}
                placeholder={placeholder}
                onChange={(e) => {
                    const s = e.currentTarget.value.trim()
                    const n = Number(s)
                    onChange(s === '' || !Number.isFinite(n) ? undefined : n)
                }}
                className={`${inputCls} w-full`}
            />
        </Field>
    )
}

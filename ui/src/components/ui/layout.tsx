import type { ReactNode } from 'react'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

/** Bode 26.10: компоновка настроек по образцу приложения Splify2 для телефона.
 *
 *  Разделы и рельс остаются где были; меняется то, КАК расположены настройки внутри раздела.
 *  Приложение держит один язык на всех экранах, и он переносится сюда целиком:
 *
 *  - экран начинается шапкой: заголовок слева, действие справа, стрелка назад на вложенном;
 *  - карточка открывается строкой «заголовок — счётчик или действие справа» (CardHead);
 *  - однородные пункты стоят СТРОКАМИ ОДНОЙ карточки через волосяную линию (Group + TapRow),
 *    а не отдельной карточкой на пункт: шесть карточек подряд читались как шесть разных
 *    вещей, одна карточка со строками — как один перечень;
 *  - факт — полосой «подпись слева, значение справа» (KV);
 *  - выключатель стоит у правого края строки, подпись — слева, пояснение — под ней (ToggleRow);
 *  - выбор из двух-четырёх вариантов — сегментами (Segmented).
 *
 *  Всё на токенах splify2 (bg-card, border-border, text-subtle, primary), без своих цветов:
 *  акцент по-прежнему берётся у темы. Заголовки — классами sp-*, а не утилитами размера:
 *  build.sh такие отвергает (утилита размера на h* не действует под темой LuCI). */

/** Шапка экрана. `back` — стрелка назад (вложенный экран), `right` — действие у края. */
export function ScreenHeader({
    title, back, backLabel = 'Назад', right,
}: {
    title: ReactNode
    back?: () => void
    backLabel?: string
    right?: ReactNode
}) {
    return (
        <div className="-mx-1 flex min-h-[44px] items-center gap-2 border-b border-border px-1 pb-3">
            {back && (
                <button
                    type="button"
                    onClick={back}
                    aria-label={backLabel}
                    className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg p-0 text-foreground hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                    <ArrowLeft className="h-5 w-5" aria-hidden="true" />
                </button>
            )}
            <h2 className="sp-title min-w-0 flex-1 truncate">{title}</h2>
            {right}
        </div>
    )
}

/** Заголовок карточки: название слева, счётчик (`meta`) или действие (`action`) справа. */
export function CardHead({ title, meta, action }: { title: ReactNode; meta?: ReactNode; action?: ReactNode }) {
    return (
        <div className="flex min-h-[24px] items-center justify-between gap-3">
            <h3 className="sp-sub min-w-0 truncate">{title}</h3>
            {meta != null && meta !== false && (
                <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
            )}
            {action}
        </div>
    )
}

/** Карточка-блок приложения: отступ 16, содержимое колонкой. */
export function Block({ children, className = '' }: { children: ReactNode; className?: string }) {
    return <Card className={`space-y-3 p-4 lg:p-5 ${className}`}>{children}</Card>
}

/** Строки одной карточкой через волосяную линию. `head` — заголовок над строками. */
export function Group({ head, children }: { head?: ReactNode; children: ReactNode }) {
    return (
        <Card className="px-4 py-1.5 lg:px-5">
            {head && <div className="pb-1 pt-2.5">{head}</div>}
            <div className="divide-y divide-border">{children}</div>
        </Card>
    )
}

/** Строка-переход: значок, название, состояние под ним, правый край, шеврон. */
export function TapRow({
    icon: Icon, title, subtitle, right, onClick, alarm, dot,
}: {
    icon?: typeof ChevronRight
    title: ReactNode
    subtitle?: ReactNode
    right?: ReactNode
    onClick?: () => void
    /** Внутри есть находка: значок и подпись — цветом предупреждения. */
    alarm?: boolean
    /** Точка состояния вместо значка: ok / warn / bad / idle. */
    dot?: 'ok' | 'warn' | 'bad' | 'idle'
}) {
    const DOT = { ok: 'bg-success', warn: 'bg-warning', bad: 'bg-destructive', idle: 'bg-muted-foreground' }
    const body = (
        <>
            {Icon && (
                <Icon
                    className={`h-[18px] w-[18px] shrink-0 ${alarm ? 'text-warning-fg' : 'text-subtle'}`}
                    aria-hidden="true"
                />
            )}
            {dot && <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[dot]}`} aria-hidden="true" />}
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{title}</span>
                {subtitle && (
                    <span className={`mt-0.5 block truncate text-xs ${alarm ? 'text-warning-fg' : 'text-subtle'}`}>
                        {subtitle}
                    </span>
                )}
            </span>
            {right != null && right !== false && (
                <span className="shrink-0 text-right text-xs text-muted-foreground">{right}</span>
            )}
            {onClick && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        </>
    )
    const cls = 'flex min-h-[52px] w-full items-center gap-3 py-2 text-left'
    if (!onClick) return <div className={cls}>{body}</div>
    return (
        <button
            type="button"
            onClick={onClick}
            className={`${cls} -mx-2 box-content rounded-lg bg-transparent px-2 transition-colors duration-200 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
        >
            {body}
        </button>
    )
}

/** Полоса «подпись — значение». */
export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
    return (
        <div className="flex min-h-[24px] items-baseline justify-between gap-3 text-sm">
            <span className="shrink-0 text-subtle">{k}</span>
            <span className="min-w-0 truncate text-right">{v}</span>
        </div>
    )
}

/** Строка с выключателем у правого края; пояснение — под подписью. */
export function ToggleRow({
    label, caption, on, onToggle, disabled, switchLabel,
}: {
    label: ReactNode
    caption?: ReactNode
    on: boolean
    onToggle: () => void
    disabled?: boolean
    /** Имя выключателя для чтения с экрана, когда подпись — не строка. */
    switchLabel?: string
}) {
    return (
        <div className="flex min-h-[44px] items-center justify-between gap-3 py-1">
            <div className="min-w-0">
                <div className="text-sm">{label}</div>
                {caption && <div className="mt-0.5 text-xs text-subtle">{caption}</div>}
            </div>
            <Switch
                on={on}
                onClick={onToggle}
                disabled={disabled}
                label={switchLabel ?? (typeof label === 'string' ? label : '')}
            />
        </div>
    )
}

/** Два-четыре варианта в строку. */
export function Segmented<T extends string>({
    items, value, onChange, label,
}: {
    items: { value: T; label: ReactNode }[]
    value: T
    onChange: (v: T) => void
    label?: string
}) {
    return (
        <div role="group" aria-label={label} className="flex gap-0.5 rounded-xl bg-muted p-0.5">
            {items.map((it) => {
                const on = it.value === value
                return (
                    <button
                        key={it.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChange(it.value)}
                        className={`h-9 min-w-0 flex-1 truncate rounded-lg px-2 text-sm transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                            on ? 'bg-primary font-medium text-primary-foreground' : 'bg-transparent text-subtle hover:text-foreground'
                        }`}
                    >
                        {it.label}
                    </button>
                )
            })}
        </div>
    )
}

/** Пустое состояние: значок и одна строка. */
export function Empty({ icon: Icon, text, action }: { icon: typeof ChevronRight; text: ReactNode; action?: ReactNode }) {
    return (
        <div className="flex flex-col items-center gap-2.5 px-2 py-7 text-center text-muted-foreground">
            <Icon className="h-5 w-5" aria-hidden="true" />
            <div className="text-sm text-subtle">{text}</div>
            {action}
        </div>
    )
}

import type { ReactNode } from 'react'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

import { S } from '@/copy'
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
    title, back, backLabel = S.layout.nazad, right,
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
            {/* Число и действие — одной группой у правого края. Тремя детьми justify-between
                ставил число посередине шапки («Соединения через выходы ··· 0 ··· Обновить» на
                1280 пикселях, снято с QEMU-стенда). */}
            <div className="flex shrink-0 items-center gap-3">
                {meta != null && meta !== false && (
                    <span className="text-xs text-muted-foreground">{meta}</span>
                )}
                {action}
            </div>
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
    icon: Icon, title, subtitle, note, right, onClick, alarm, dot, badges,
}: {
    icon?: typeof ChevronRight
    title: ReactNode
    subtitle?: ReactNode
    /** Действие под подписью — с переносом: подпись держится одной усечённой строкой, а совет, что
     *  делать, многоточием резать нельзя. */
    note?: ReactNode
    right?: ReactNode
    onClick?: () => void
    /** Внутри есть находка: значок и подпись — цветом предупреждения. */
    alarm?: boolean
    /** Точка состояния вместо значка: ok / warn / bad / idle. */
    dot?: 'ok' | 'warn' | 'bad' | 'idle'
    /** Бейджи конфигурации (components/ConfBadges) — строкой под подписью, с переносом. */
    badges?: ReactNode
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
                {note && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{note}</span>}
                {badges}
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

/** Строка «подпись слева — поле справа», как «если всё упало [список]» в приложении. Поле
 *  занимает до половины строки; на узком экране подпись и поле встают друг под другом, когда
 *  не помещаются. Подпись — <label>: поле находится по ней и глазом, и чтением с экрана. */
export function FieldRow({ label, caption, children }: { label: ReactNode; caption?: ReactNode; children: ReactNode }) {
    return (
        <label className="flex min-h-[44px] flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-1">
            <span className="min-w-0 flex-1 basis-40">
                <span className="block text-sm text-subtle">{label}</span>
                {caption && <span className="mt-0.5 block text-xs text-muted-foreground">{caption}</span>}
            </span>
            <span className="min-w-0 flex-1 basis-56 sm:max-w-[60%]">{children}</span>
        </label>
    )
}

/** Удаление: обведённая красная кнопка внизу экрана или карточки, как «Удалить правило» в
 *  приложении. Не залитая: заливка — у основного действия, а удаление не должно спорить с ним
 *  за взгляд. `full` — во всю ширину (низ экрана); без него — по содержимому (ряд кнопок). */
export function DangerButton({
    children, onClick, disabled, full, label,
}: {
    children: ReactNode
    onClick: () => void
    disabled?: boolean
    full?: boolean
    /** Имя для чтения с экрана, когда подпись кнопки не называет, ЧТО удаляется. */
    label?: string
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-destructive/50 bg-transparent px-4 text-sm font-medium text-destructive transition-colors duration-200 hover:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0 ${full ? 'w-full' : ''}`}
        >
            {children}
        </button>
    )
}

/** Полоска доли: трафик правила относительно самого нагруженного, как в «Трафике по
 *  правилам» приложения. `value` — от 0 до 1; `muted` — серым (правило «напрямую»: оно
 *  никуда не уводит, и акцентный цвет на нём читался бы как ещё один туннель). */
export function Meter({ value, muted }: { value: number; muted?: boolean }) {
    const w = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
    return (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
                className={`h-full rounded-full transition-[width] duration-500 ${muted ? 'bg-muted-foreground' : 'bg-primary'}`}
                /* Ненулевой трафик не рисуется пустой полоской: доля в полпроцента от
                   самого большого правила — это всё-таки не ноль. */
                style={{ width: w > 0 ? `max(${Math.round(w * 100)}%, 6px)` : '0' }}
            />
        </div>
    )
}

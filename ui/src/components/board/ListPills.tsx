import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import ConfBadges from '@/components/ConfBadges'
import { BADGE_ROW, PILL } from '@/components/board/NodePills'
import { type ConfBadge } from '@/lib/badges'
import { type ServiceEntry } from '@/lib/model'
import { S } from '@/copy'

/** Сколько пилюль каталога видно до «Показать все» (выбранные видны всегда). */
const FOLD = 12

const KIND: Record<string, ConfBadge> = {
    domains: { id: 'kind:domains', text: S.ruleEditor.domeny, group: 'feature' },
    prefixes: { id: 'kind:prefixes', text: S.ruleEditor.adresa, group: 'feature' },
}

/** «Что перенаправляем» в приложении для компьютера — пилюлями, как «Куда»: имя сервиса, число
 *  записей, бейджи «домены» и «адреса». Щелчок ставит сервис в правило или снимает. */
export default function ListPills({ shown, chosen, probing, searching, onPick }: {
    shown: ServiceEntry[]
    chosen: string[]
    probing: ReadonlySet<string>
    /** Идёт поиск — показываются все найденные, без сворачивания. */
    searching: boolean
    onPick: (sv: ServiceEntry) => void
}) {
    const [open, setOpen] = useState(false)
    const all = open || searching
    const list = all ? shown : shown.filter((sv, i) => i < FOLD || chosen.includes(sv.id))
    return (
        <div className="space-y-2">
            {shown.length === 0 && <p className="text-xs text-muted-foreground">{S.ruleEditor.nichegoNeNashlos}</p>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                {list.map((sv) => {
                    const on = chosen.includes(sv.id)
                    const busy = probing.has(sv.id)
                    const kinds = [...new Set(sv.parts.map((p) => p.kind))].map((k) => KIND[k]).filter(Boolean)
                    return (
                        <button
                            key={sv.id}
                            type="button"
                            onClick={() => onPick(sv)}
                            disabled={busy}
                            aria-pressed={on}
                            title={sv.name}
                            className={[
                                `${PILL} transition-[border-color,box-shadow,opacity] duration-200 hover:border-primary/50 disabled:opacity-60`,
                                on ? 'border-primary/80 bg-primary/10 shadow-[inset_0_1px_0_var(--an-glass-edge),0_0_0_2px_color-mix(in_srgb,var(--sp-primary)_25%,transparent)]' : '',
                            ].join(' ')}
                        >
                            <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
                                <span className="min-w-0 truncate">{sv.name}</span>
                                <span className="ml-auto shrink-0 text-[11.5px] font-semibold tabular-nums text-muted-foreground">
                                    {busy ? S.ruleEditor.skachivaetsya : sv.count ? sv.count.toLocaleString('ru-RU') : ''}
                                </span>
                            </span>
                            <ConfBadges list={kinds} className={BADGE_ROW} />
                        </button>
                    )
                })}
            </div>
            {!searching && shown.length > FOLD && (
                <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 bg-transparent px-1 text-xs text-primary">
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                    {open ? S.subsBoard.svernut : S.subsBoard.pokazatVse(shown.length)}
                </button>
            )}
        </div>
    )
}

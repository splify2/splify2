import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import ConfBadges from '@/components/ConfBadges'
import { BADGE_ROW, PILL } from '@/components/board/NodePills'
import { type ConfBadge } from '@/lib/badges'
import { type ServiceEntry } from '@/lib/model'
import { S } from '@/copy'

/** Сколько пилюль каталога видно до «Показать все» (выбранные видны всегда). */
const FOLD = 8

const KIND: Record<string, ConfBadge> = {
    domains: { id: 'kind:domains', text: S.ruleEditor.domeny, group: 'feature' },
    prefixes: { id: 'kind:prefixes', text: S.ruleEditor.adresa, group: 'feature' },
}

/** Блок провайдера: источник списков, названный издателем (`provider`); не назван — списки ведёт
 *  сам издатель, и блок называется им (первый издатель, без поля `publisher`, — «Каталог splify2»: свои списки splify2-lists);
 *  свои списки роутера — отдельным блоком. Порядок — в каком провайдеры впервые встречаются в каталоге. */
function groupsOf(list: ServiceEntry[]): { id: string; name: string; items: ServiceEntry[] }[] {
    const out = new Map<string, { id: string; name: string; items: ServiceEntry[] }>()
    for (const sv of list) {
        const pub = sv.publisher?.id || 'splify2'
        const id = sv.id.startsWith('custom:') ? 'custom' : `${pub}|${sv.provider || ''}`
        const name = id === 'custom' ? S.ruleEditor.svoiSpiski : sv.provider || sv.publisher?.name || S.ruleEditor.katalogSplify2
        if (!out.has(id)) out.set(id, { id, name, items: [] })
        out.get(id)!.items.push(sv)
    }
    return [...out.values()]
}

/** «Что перенаправляем» в приложении для компьютера — пилюлями, как «Куда», блоком на провайдера
 *  (владелец: «разбей на провайдеров блоки списков»): имя сервиса, число записей, бейджи «домены»
 *  и «адреса». Щелчок ставит сервис в правило или снимает. */
export default function ListPills({ shown, chosen, probing, searching, onPick }: {
    shown: ServiceEntry[]
    chosen: string[]
    probing: ReadonlySet<string>
    /** Идёт поиск — показываются все найденные, без сворачивания. */
    searching: boolean
    onPick: (sv: ServiceEntry) => void
}) {
    if (shown.length === 0) return <p className="text-xs text-muted-foreground">{S.ruleEditor.nichegoNeNashlos}</p>
    return (
        <div className="space-y-3">
            {groupsOf(shown).map((g) => (
                <Publisher key={g.id} name={g.name} items={g.items} chosen={chosen} probing={probing} searching={searching} onPick={onPick} />
            ))}
        </div>
    )
}

function Publisher({ name, items, chosen, probing, searching, onPick }: {
    name: string
    items: ServiceEntry[]
    chosen: string[]
    probing: ReadonlySet<string>
    searching: boolean
    onPick: (sv: ServiceEntry) => void
}) {
    const [open, setOpen] = useState(false)
    const all = open || searching
    const list = all ? items : items.filter((sv, i) => i < FOLD || chosen.includes(sv.id))
    const on = items.filter((sv) => chosen.includes(sv.id)).length
    return (
        <div className="sp-board-tile an-glass space-y-3 rounded-2xl border p-3.5">
            <div className="flex items-center gap-2 text-[13px] font-semibold">
                <span className="min-w-0 truncate">{name}</span>
                <span className="text-xs font-normal text-muted-foreground">{on ? S.ruleEditor.izVybrano(on, items.length) : items.length}</span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                {list.map((sv) => {
                    const picked = chosen.includes(sv.id)
                    const busy = probing.has(sv.id)
                    const kinds = [...new Set(sv.parts.map((p) => p.kind))].map((k) => KIND[k]).filter(Boolean)
                    return (
                        <button
                            key={sv.id}
                            type="button"
                            onClick={() => onPick(sv)}
                            disabled={busy}
                            aria-pressed={picked}
                            title={sv.name}
                            className={[
                                `${PILL} transition-[border-color,box-shadow,opacity] duration-200 hover:border-primary/50 disabled:opacity-60`,
                                picked ? 'border-primary/80 bg-primary/10 shadow-[inset_0_1px_0_var(--an-glass-edge),0_0_0_2px_color-mix(in_srgb,var(--sp-primary)_25%,transparent)]' : '',
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
            {!searching && items.length > FOLD && (
                <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 bg-transparent px-1 text-xs text-primary">
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                    {open ? S.subsBoard.svernut : S.subsBoard.pokazatVse(items.length)}
                </button>
            )}
        </div>
    )
}

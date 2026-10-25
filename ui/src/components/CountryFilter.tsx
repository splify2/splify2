import { Chip } from '@/components/formbits'
import Flag from '@/components/Flag'
import { country } from '@/lib/geo'

import { S } from '@/copy'
/** Выбор стран для отбора членов группы (`only` и `exclude` группы, спека v2): «только эти» и
 *  «кроме этих». Страна в обоих списках — отказ ядра, поэтому отметка в одном снимает её в другом. */
export default function CountryFilter({ options, only, exclude, onChange }: {
    options: string[]
    only: string[]
    exclude: string[]
    onChange: (only: string[], exclude: string[]) => void
}) {
    const all = [...new Set([...options, ...only, ...exclude])]
    const flip = (list: string[], cc: string) => (list.includes(cc) ? list.filter((x) => x !== cc) : [...list, cc])
    const group = (title: string, mine: string[], toggle: (cc: string) => void) => (
        <div className="space-y-2">
            <div className="text-sm text-subtle">{title}</div>
            <div className="flex flex-wrap gap-2" role="group" aria-label={title}>
                {all.map((cc) => (
                    <Chip key={cc} on={mine.includes(cc)} onClick={() => toggle(cc)}>
                        <span className="flex items-center gap-1.5">
                            <Flag cc={cc} />
                            {country(cc) || cc}
                        </span>
                    </Chip>
                ))}
            </div>
        </div>
    )
    return (
        <div className="space-y-3 border-t border-border pt-3">
            {group(S.groupEditor.tolkoStranyChlenov, only, (cc) => onChange(flip(only, cc), exclude.filter((x) => x !== cc)))}
            {group(S.groupEditor.neBratStranyChlenov, exclude, (cc) => onChange(only.filter((x) => x !== cc), flip(exclude, cc)))}
        </div>
    )
}

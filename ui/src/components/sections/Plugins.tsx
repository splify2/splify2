import { useEffect, useState } from 'react'
import { Puzzle } from 'lucide-react'
import { Empty } from '@/components/ui/layout'
import PluginCard from '@/components/PluginCard'
import PluginCatalog from '@/components/PluginCatalog'
import PluginOpen from '@/components/PluginOpen'
import { pluginsState, usePlugins } from '@/plugins/runtime'
import { refreshPlugins } from '@/plugins/store'
import type { Live } from '@/lib/live'
import { S } from '@/copy'

/** Вкладка «Плагины» (решение владельца 2026-10-25): заменила карточку модулей. Сверху каталог и
 *  репозитории, ниже установленные плагины карточками. Карточка раскрывается на месте списка, как
 *  правило в RulesTab, — по одной за раз; `host.nav.openPlugin` раскрывает нужную снаружи. */
export default function Plugins({ live, deferred = false }: { live: Live; deferred?: boolean }) {
    const { entries, loaded, runtime, openRequest } = usePlugins()
    const [open, setOpen] = useState<string | null>(null)

    useEffect(() => { void refreshPlugins() }, [])
    useEffect(() => {
        if (!openRequest) return
        setOpen(openRequest)
        pluginsState.requestOpen(null)
    }, [openRequest])

    const cur = open ? entries.find((e) => e.id === open) : undefined
    if (cur) return <PluginOpen entry={cur} live={live} onClose={() => setOpen(null)} deferred={deferred} />

    const shown = entries
    return (
        <div className="space-y-4">
            <PluginCatalog onChanged={() => void refreshPlugins()} />
            {loaded && shown.length === 0 && <Empty icon={Puzzle} text={S.plugins.netPlaginov} />}
            {shown.length > 0 && (
                <div className="sp-board-grid grid gap-3 sm:grid-cols-2">
                    {shown.map((e) => (
                        <PluginCard key={e.id} entry={e} runtime={runtime[e.id]} live={live} onOpen={() => setOpen(e.id)} />
                    ))}
                </div>
            )}
        </div>
    )
}

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { rpc } from '@/lib/rpc'

import { S } from '@/copy'
/** Предложение поставить модуль ядра, которого не хватает выходу.
 *
 *  Решение владельца: добавили выход вида, модуля которого нет, — интерфейс предлагает его
 *  поставить, а не оставляет строку «нужен пакет steer-…» человеку на поиски. Одна строка на
 *  модуль, сколько бы выходов его ни ждали; после установки список модулей перечитывается
 *  (`onDone`), и строка уходит сама. */
export default function ModuleOffer({ modules, onDone }: { modules: string[]; onDone: () => void }) {
    const [working, setWorking] = useState('')
    if (!modules.length) return null

    async function add(m: string) {
        setWorking(m)
        const label = S.modules.label[m] || m
        try {
            const r = await rpc.steerModuleAdd(m)
            if (!r.ok) throw new Error(r.error || S.modules.neVyshlo)
            notify(S.modules.postavlen(label))
            onDone()
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setWorking('')
        }
    }

    return (
        <div className="space-y-2">
            {modules.map((m) => (
                <div key={m} className="flex items-center gap-3 rounded-xl border border-destructive px-3 py-2">
                    <span className="min-w-0 flex-1 text-sm">{S.modules.nuzhenModul(S.modules.label[m] || m)}</span>
                    <Button size="sm" disabled={!!working} onClick={() => add(m)}>
                        {working === m ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        {S.modules.postavit}
                    </Button>
                </div>
            ))}
        </div>
    )
}

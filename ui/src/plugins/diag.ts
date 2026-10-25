import { useEffect, useState } from 'react'
import { registry, useRegistry } from './registry'
import type { DiagResult } from './api'
import type { DiagCheck } from '@/lib/live'

type DiagSlot = { id: string; label: string; run(): Promise<DiagResult[]> }

/** Проверки плагинов для «Диагностики» (слот `diag`): запускаются при открытии раздела и при смене
 *  набора плагинов; упавшая проверка не мешает остальным — её не видно, ошибка уходит в консоль. */
export function usePluginDiag(): DiagCheck[] {
    const ver = useRegistry()
    const [out, setOut] = useState<DiagCheck[]>([])
    useEffect(() => {
        let stop = false
        const regs = registry.list<DiagSlot>('diag')
        void Promise.all(regs.map(async (r) => {
            try {
                return (await r.value.run()).map((x) => ({
                    id: `${r.owner}:${r.id}:${x.id}`, verdict: x.verdict, what: x.what, why: x.why ?? '',
                }))
            } catch (err) {
                console.error(`[plugin ${r.owner}] diag ${r.id}`, err)
                return []
            }
        })).then((all) => { if (!stop) setOut(all.flat()) })
        return () => { stop = true }
    }, [ver])
    return out
}

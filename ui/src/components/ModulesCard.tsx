import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Block, CardHead } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { rpc, type SteerModule } from '@/lib/rpc'

import { S } from '@/copy'
/** Модули ядра steer 2.0 — в «Настройки → Интерфейс», рядом с карточкой ядра.
 *
 *  Решение владельца: модули ставит splify2 сам. Строка — модуль, его состояние и одно действие:
 *  «Поставить» у того, что не стоит, «Снять» у того, что стоит. Модуль, который нужен выходам
 *  спеки, снять нельзя — ядро её не примет, и вместо кнопки строка называет эти выходы.
 *
 *  Состав и состояние — от бэкенда (steer_modules), а не из `engine.modules`: здесь нужны ещё
 *  версия пакета и то, кому модуль нужен, а это спрашивается только на этом экране. */
export default function ModulesCard({ onChanged }: { onChanged: () => void }) {
    const [data, setData] = useState<{ core: string; busy?: string; modules: SteerModule[] } | null>(null)
    const [working, setWorking] = useState('')

    const load = useCallback(() => {
        rpc.steerModules().then(setData).catch(() => setData(null))
    }, [])
    useEffect(load, [load])

    async function act(m: SteerModule) {
        setWorking(m.name)
        const label = S.modules.label[m.name] || m.name
        try {
            const r = m.installed ? await rpc.steerModuleDel(m.name) : await rpc.steerModuleAdd(m.name)
            if (!r.ok) throw new Error(r.error || S.modules.neVyshlo)
            notify(m.installed ? S.modules.snyat2(label) : S.modules.postavlen(label))
            onChanged()
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setWorking('')
            load()
        }
    }

    /* Ответа нет (бэкенд старее или вызов не прошёл) — показывать нечего. */
    if (!data) return null

    return (
        <Block>
            <CardHead title={S.modules.title} />
            {data.busy ? (
                <p className="text-sm">{S.engineCard.zanyato(data.busy)}</p>
            ) : !data.core ? (
                <p className="text-sm text-muted-foreground">{S.modules.bezYadra}</p>
            ) : (
                <ul className="divide-y divide-border">
                    {data.modules.map((m) => (
                        <li key={m.name} className="flex items-center gap-3 py-2">
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium">{S.modules.label[m.name] || m.name}</div>
                                <div className="text-xs text-muted-foreground">
                                    {m.installed ? S.modules.stoit(m.version) : S.modules.neStoit}
                                </div>
                            </div>
                            {m.installed && m.needed ? (
                                <span className="max-w-[50%] truncate text-xs text-muted-foreground">
                                    {S.modules.nuzhen(m.outputs || '')}
                                </span>
                            ) : (
                                <Button
                                    variant={m.installed ? 'secondary' : 'default'}
                                    size="sm"
                                    disabled={!!working}
                                    onClick={() => act(m)}
                                >
                                    {working === m.name && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {m.installed ? S.modules.snyat : S.modules.postavit}
                                </Button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </Block>
    )
}

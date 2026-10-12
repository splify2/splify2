import { useState } from 'react'
import Flag from '@/components/Flag'
import { latencyTone, probeMs } from '@/lib/probe'
import { probeSubNode, type SubNode } from '@/lib/subnodes'
import { S } from '@/copy'

/** Замер узла подписки: идёт, ответил за `ms` или не ответил (`why`). */
export type Lat = { ms?: number; ok: boolean; busy?: boolean; why?: string }

/** Задержки узлов подписки по ключу узла: замер по три узла разом. */
export function useSubProbe(path: string) {
    const [lat, setLat] = useState<Record<string, Lat>>({})
    async function probe(list: SubNode[]) {
        setLat((m) => ({ ...m, ...Object.fromEntries(list.map((n) => [n.key, { ok: false, busy: true }])) }))
        const queue = list.slice()
        const worker = async () => {
            for (let n = queue.shift(); n; n = queue.shift()) {
                const node = n
                try {
                    const r = await probeSubNode(path, node)
                    const res = r.results?.[0]
                    setLat((m) => ({
                        ...m,
                        [node.key]: res?.ok ? { ok: true, ms: probeMs(res) } : { ok: false, why: res?.why || r.error },
                    }))
                } catch (e) {
                    setLat((m) => ({ ...m, [node.key]: { ok: false, why: String(e instanceof Error ? e.message : e) } }))
                }
            }
        }
        await Promise.all([worker(), worker(), worker()])
    }
    const probing = Object.values(lat).some((l) => l.busy)
    return { lat, probe, probing }
}

/** Пилюля конфигурации по образцу вкладки Steer апстримного Zapret Manager: флаг и имя,
 *  «протокол · транспорт · защита», задержка цветом. `chosen` — узел взят правилом,
 *  `on` — ядро держит его сейчас. */
export function NodePill({ node, lat, chosen, on, onClick, disabled }: {
    node: SubNode
    lat?: Lat
    chosen?: boolean
    on?: boolean
    onClick?: () => void
    disabled?: boolean
}) {
    const dead = lat && !lat.busy && !lat.ok
    const tone = lat?.ok && lat.ms !== undefined ? latencyTone(lat.ms) : null
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-pressed={chosen}
            title={lat?.why || undefined}
            className={[
                'an-glass flex min-w-0 flex-col gap-1 rounded-xl border px-3 py-2 text-left transition-[border-color,opacity,box-shadow] duration-200',
                'hover:border-primary/50 disabled:cursor-default',
                chosen ? 'border-primary/80 bg-primary/10 shadow-[0_0_0_2px_color-mix(in_srgb,var(--sp-primary)_25%,transparent)]' : '',
                on && !chosen ? 'border-success/70' : '',
                dead ? 'opacity-55' : '',
            ].join(' ')}
        >
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
                <Flag cc={node.cc} />
                <span className="truncate">{node.name}</span>
                {on && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-label={S.subsBoard.rabotaet} />}
            </span>
            <span className="flex min-w-0 items-center justify-between gap-2 text-[11.5px]">
                <span className="min-w-0 truncate text-muted-foreground">{node.foot}</span>
                <span className={[
                    'shrink-0 font-semibold tabular-nums',
                    lat?.busy ? 'text-muted-foreground' : dead ? 'text-destructive' : tone === 'good' ? 'text-success' : tone === 'ok' ? 'text-warning-fg' : tone ? 'text-destructive' : '',
                ].join(' ')}>
                    {lat?.busy ? '…' : dead ? S.subsBoard.netOtveta : lat?.ok && lat.ms !== undefined ? S.subsBoard.ms(lat.ms) : ''}
                </span>
            </span>
        </button>
    )
}

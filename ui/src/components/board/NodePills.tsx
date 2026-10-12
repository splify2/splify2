import { useState } from 'react'
import Flag from '@/components/Flag'
import ConfBadges from '@/components/ConfBadges'
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

/** Пилюля любого блока «Куда»: все одного размера — во всю ячейку сетки и одной высоты. */
export const PILL = 'an-glass sp-pill flex h-[64px] w-full min-w-0 flex-col justify-center gap-1.5 rounded-xl border px-3 text-left'

/** Строка бейджей в пилюле — одна линия, лишние бейджи переносятся за её край и не видны. */
export const BADGE_ROW = 'h-5 content-start overflow-hidden'

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
            title={lat?.why || `${node.name} — ${node.foot}`}
            className={[
                `${PILL} transition-[border-color,opacity,box-shadow] duration-200`,
                'hover:border-primary/50 disabled:cursor-default',
                chosen ? 'border-primary/80 bg-primary/10 shadow-[inset_0_1px_0_var(--an-glass-edge),0_0_0_2px_color-mix(in_srgb,var(--sp-primary)_25%,transparent)]' : '',
                on && !chosen ? 'border-success/70' : '',
                dead ? 'opacity-55' : '',
            ].join(' ')}
        >
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
                <Flag cc={node.cc} />
                <span className="min-w-0 truncate">{node.name}</span>
                <span className={[
                    'ml-auto shrink-0 text-[11.5px] font-semibold tabular-nums',
                    lat?.busy ? 'text-muted-foreground' : dead ? 'text-destructive' : tone === 'good' ? 'text-success' : tone === 'ok' ? 'text-warning-fg' : tone ? 'text-destructive' : '',
                ].join(' ')}>
                    {lat?.busy ? '…' : dead ? S.subsBoard.netOtveta : lat?.ok && lat.ms !== undefined ? S.subsBoard.ms(lat.ms) : ''}
                </span>
                {on && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-label={S.subsBoard.rabotaet} />}
            </span>
            {/* Бейджи одной строкой: не влезший уходит целиком, а не обрезается посередине. */}
            <ConfBadges list={node.badges} className={BADGE_ROW} />
        </button>
    )
}

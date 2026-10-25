import type { ReactNode } from 'react'
import { PluginGuard, SlotView } from '@/plugins/boundary'
import { toHostLive } from '@/plugins/hostlive'
import { registry, useRegistry, type Reg } from '@/plugins/registry'
import { usePlugins } from '@/plugins/runtime'
import type { Slots } from '@/plugins/api'
import type { Live } from '@/lib/live'

export type BoardTileSlot = Parameters<Slots['boardTile']>[0]

/** Плитки «Доски» от плагинов (слот `boardTile`), по `order`. */
export function usePluginTiles(): Reg<BoardTileSlot>[] {
    useRegistry()
    return registry.list<BoardTileSlot>('boardTile')
}

/** Плитка плагина: `when` и `render` вызываются внутри предохранителя, и упавшая плитка просто
 *  исчезает с доски — остальное живёт. */
export function PluginTiles({ tiles, live }: { tiles: Reg<BoardTileSlot>[]; live: Live }) {
    const { entries } = usePlugins()
    const hl = toHostLive(live)
    return (
        <>
            {tiles.map((r) => (
                <PluginGuard key={`${r.owner}:${r.id}`} quiet name={entries.find((e) => e.id === r.owner)?.name ?? r.owner}>
                    <SlotView render={() => (r.value.when(hl) ? (r.value.render(hl) as unknown as ReactNode) : null)} />
                </PluginGuard>
            ))}
        </>
    )
}

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { rpc, type VlessNodesReply } from '@/lib/rpc'
import { cn } from '@/lib/utils'
import { isProxyKind, type Output, type OutputStatus } from '@/lib/model'
import { outNodes, outputBadges, PROTO_TONE, type ConfBadge } from '@/lib/badges'

/** Бейджи конфигурации строкой: протокол → транспорт → защита → особенности (lib/badges.ts).
 *  На узком экране переносятся целыми бейджами и строку не распирают.
 *
 *  Без роли списка и своей подписи: бейджи стоят и внутри кнопки (строка узла, строка выхода), а
 *  подпись вложенного элемента заменила бы в имени кнопки сами бейджи словом «Конфигурация».
 *  Текстом они читаются по порядку, как написаны. */
export default function ConfBadges({ list, className }: { list: ConfBadge[]; className?: string }) {
    if (!list.length) return null
    return (
        <span className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}>
            {list.map((b) => (
                <Badge
                    key={b.id}
                    variant={b.warn ? 'warn' : b.proto ? 'proto' : 'tag'}
                    data-tone={b.proto ? PROTO_TONE[b.proto] : undefined}
                    title={b.title}
                >
                    {b.text}
                </Badge>
            ))}
        </span>
    )
}

/** Узлы выхода-туннеля глазами ядра (`vless_nodes`, `hysteria2_nodes`, `proxy_nodes` по имени
 *  выхода). null — не туннель, ещё не ответило или ответило отказом: тогда бейджи только из
 *  спеки и состояния. `key` — когда спросить заново (устройство выхода поменялось). */
export function useOutNodes(name: string, kind: string | undefined, key?: unknown): VlessNodesReply | null {
    const [r, setR] = useState<VlessNodesReply | null>(null)
    useEffect(() => {
        const ask =
            kind === 'vless' ? rpc.vlessNodes
            : kind === 'hysteria2' ? rpc.hysteria2Nodes
            : isProxyKind(kind) ? rpc.proxyNodes
            : null
        if (!ask) { setR(null); return }
        let stop = false
        ask(name)
            .then((x) => { if (!stop) setR(x && Array.isArray(x.nodes) ? x : null) })
            .catch(() => { if (!stop) setR(null) })
        return () => { stop = true }
    }, [name, kind, key])
    return r
}

/** Бейджи выхода: спека, состояние и узлы, которые он берёт. */
export function OutBadges({
    name, out, st, devKind, reply, className,
}: {
    name: string
    out?: Output | null
    st?: OutputStatus | null
    devKind?: string | null
    /** Узлы уже спрошены снаружи (строка локации спрашивает их ради имени узла) — второй раз не
     *  спрашиваем. undefined — спросить здесь. */
    reply?: VlessNodesReply | null
    className?: string
}) {
    const kind = out?.kind || st?.kind
    const own = useOutNodes(name, reply === undefined ? kind : undefined, st?.device)
    const r = reply === undefined ? own : reply
    const nodes = outNodes(r, st?.proxy?.node || st?.hysteria2?.node || null)
    return <ConfBadges list={outputBadges({ out, st, nodes, devKind })} className={className} />
}

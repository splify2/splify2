import { useEffect, useState } from 'react'
import { rpc, type VlessNodesReply } from '@/lib/rpc'
import { isProxyKind, type ProxyKind, type VlessNode } from '@/lib/model'
import { ccFromName, plainName } from '@/lib/nodename'
import { nodeBadges, type ConfBadge } from '@/lib/badges'
import { PROBE_LIMIT, probeMs } from '@/lib/probe'

/** Конфигурация (узел) подписки — одним списком на все протоколы: VLESS, Hysteria2 и прокси
 *  steer-proxy. Номер узла у ядра — внутри своего протокола (`index`); у прокси в перечне файла
 *  целиком номер свой (`at`), по нему спрашивается проверка. */
export interface SubNode {
    /** Ключ строки и замера: `<протокол>:<номер>`. */
    key: string
    proto: 'vless' | 'hysteria2' | ProxyKind
    index: number
    at?: number
    name: string
    cc?: string
    /** «протокол · транспорт · защита» — подпись пилюли словами. */
    foot: string
    /** То же цветными бейджами (lib/badges.ts). */
    badges: ConfBadge[]
}

export const PROTO_NAME: Record<string, string> = {
    vless: 'VLESS', hysteria2: 'Hysteria2', trojan: 'Trojan', shadowsocks: 'Shadowsocks',
    socks: 'SOCKS', http: 'HTTP', vmess: 'VMess',
}

/** Узлы прокси — номерами внутри своего протокола, как их считает ядро (у файла — сквозные). */
export function pxSplit(nodes: VlessNode[] | undefined): { nd: VlessNode; proto: ProxyKind; at: number }[] {
    const seen: Partial<Record<ProxyKind, number>> = {}
    const out: { nd: VlessNode; proto: ProxyKind; at: number }[] = []
    for (const n of nodes || []) {
        if (!isProxyKind(n.type)) continue
        const i = seen[n.type] ?? 0
        seen[n.type] = i + 1
        out.push({ nd: { ...n, index: i }, proto: n.type, at: n.index })
    }
    return out
}

function footOf(proto: string, n: VlessNode): string {
    return [PROTO_NAME[proto] || proto, n.mode && n.mode !== 'quic' ? n.mode : '', n.security && n.security !== 'none' ? n.security : '', n.vision ? 'vision' : '']
        .filter(Boolean)
        .join(' · ')
}

function node(proto: SubNode['proto'], n: VlessNode, at?: number): SubNode {
    return {
        key: `${proto}:${n.index}`,
        proto,
        index: n.index,
        at,
        name: plainName(n.name) || n.host,
        cc: n.cc || ccFromName(n.name),
        foot: footOf(proto, n),
        badges: nodeBadges(n, proto),
    }
}

/** Все конфигурации подписки по пути к её файлу. null — ещё не спросили или файла нет;
 *  пустой список — подписка есть, пригодных узлов нет. */
/** Узлы подписок по пути файла — память окна: пилюли показываются сразу, свежие — по ответу. */
const nodesMem = new Map<string, SubNode[]>()

/** Спросить узлы подписки у всех трёх клиентов: VLESS, hysteria2 и прокси. Отказ клиента — «узлов
 *  этого протокола нет» (модуля может не быть), а не отказ подписки. */
export async function loadSubNodes(path: string): Promise<SubNode[]> {
    type R = VlessNodesReply | null
    const [v, h, p] = await Promise.all([
        rpc.vlessNodesOfSub(path).catch((): R => null),
        rpc.hysteria2NodesOfSub(path).catch((): R => null),
        rpc.proxyNodesOfSub(path).catch((): R => null),
    ])
    return [
        ...(v?.nodes || []).filter((n) => !n.excluded).map((n) => node('vless', n)),
        ...(h?.nodes || []).filter((n) => !n.excluded).map((n) => node('hysteria2', n)),
        ...pxSplit(p?.nodes).map((x) => node(x.proto, x.nd, x.at)),
    ]
}

export function useSubNodes(path: string, present: boolean, key: unknown = null): SubNode[] | null {
    const [nodes, setNodesRaw] = useState<SubNode[] | null>(() => (present ? nodesMem.get(path) ?? null : null))
    const setNodes = (v: SubNode[] | null) => { if (v) nodesMem.set(path, v); setNodesRaw(v) }
    useEffect(() => {
        if (!present) { setNodes(null); return }
        if (nodesMem.has(path)) setNodesRaw(nodesMem.get(path)!)
        let stop = false
        loadSubNodes(path).then((all) => { if (!stop) setNodes(all) })
        return () => { stop = true }
    }, [path, present, key])
    return nodes
}

/** Проверка одного узла подписки — тем методом, что у его протокола. */
export function probeSubNode(path: string, n: SubNode) {
    if (n.proto === 'vless') return rpc.vlessProbeOfSub(path, n.index)
    if (n.proto === 'hysteria2') return rpc.hysteria2ProbeOfSub(path, n.index)
    return rpc.proxyProbeOfSub(path, n.at ?? n.index)
}

/** Какие протоколы есть в подписке (у каждого — свои узлы): для «Авто» по всей подписке. */
export async function subProtos(path: string): Promise<SubNode['proto'][]> {
    type R = VlessNodesReply | null
    const [v, h, p] = await Promise.all([
        rpc.vlessNodesOfSub(path).catch((): R => null),
        rpc.hysteria2NodesOfSub(path).catch((): R => null),
        rpc.proxyNodesOfSub(path).catch((): R => null),
    ])
    const out: SubNode['proto'][] = []
    if ((v?.nodes || []).some((n) => !n.excluded)) out.push('vless')
    if ((h?.nodes || []).some((n) => !n.excluded)) out.push('hysteria2')
    for (const x of pxSplit(p?.nodes)) if (!out.includes(x.proto)) out.push(x.proto)
    return out
}

/** Итог проверки всех серверов подписки. */
export interface SubCheck {
    total: number
    /** Сколько уже проверено (ответом или отказом). */
    done: number
    ok: number
    /** Самый быстрый из ответивших. */
    best?: { name: string; ms: number }
    /** Первая причина отказа: «не отвечает» без причины заставляет гадать. */
    why?: string
}

/** Проверить ВСЕ серверы подписки одной кнопкой, каждый — методом своего протокола (STEER-CORE-762).
 *
 *  Прежде проверка была только в редакторе выхода и по протоколам: у смешанной подписки (VLESS,
 *  hysteria2, прокси) приходилось нажимать по разу на каждый. Предел одновременных проверок тот же,
 *  что у остальных (PROBE_LIMIT, lib/probe.ts): замер не должен мерить собственную очередь.
 *  `stopped()` — отмена: после неё ни один ответ не учитывается. */
export async function checkSubAll(
    path: string,
    nodes: SubNode[],
    stopped: () => boolean,
    onStep: (c: SubCheck) => void,
): Promise<SubCheck> {
    const c: SubCheck = { total: nodes.length, done: 0, ok: 0 }
    const queue = nodes.slice()
    const worker = async () => {
        for (;;) {
            const n = queue.shift()
            if (!n || stopped()) return
            let why = ''
            try {
                const r = await probeSubNode(path, n)
                const p = r.results?.[0]
                if (stopped()) return
                if (r.error) why = r.error
                else if (!p) why = ''
                else if (p.ok) {
                    c.ok++
                    const ms = probeMs(p)
                    if (!c.best || ms < c.best.ms) c.best = { name: n.name, ms }
                } else why = p.why || ''
            } catch (e) {
                if (stopped()) return
                why = String(e instanceof Error ? e.message : e)
            }
            c.done++
            if (why && !c.why) c.why = why
            onStep({ ...c })
        }
    }
    await Promise.all(Array.from({ length: Math.min(PROBE_LIMIT, queue.length) }, worker))
    return { ...c }
}

/** rpc к методам плагина: объект ubus `splify2.p.<id>` (host-api.md, rpc).
 *
 *  Мост тот же, что у панели (`window.luci_rpc`, под LuCI — загрузчик home.js). Ответ программы
 *  плагина идёт как есть; отказ — `RpcError` с видом: `denied` (нет прав ACL `splify2-p-<id>`),
 *  `timeout`, `unavailable` (нет моста или объекта), `failed` (метод сказал `ok: false`). */
import { rpc } from '@/lib/rpc'
import { S } from '@/copy'
import type { Rpc, RpcError as RpcErrorT } from './api'

export class RpcError extends Error implements RpcErrorT {
    readonly kind: RpcErrorT['kind']
    readonly code?: string
    readonly args?: Record<string, string>
    constructor(message: string, kind: RpcErrorT['kind'], code?: string, args?: Record<string, string>) {
        super(message)
        this.name = 'RpcError'
        this.kind = kind
        this.code = code
        this.args = args
    }
}

function classify(e: unknown): RpcError {
    if (e instanceof RpcError) return e
    const msg = e instanceof Error ? e.message : String(e)
    if (/denied|-32002|permission/i.test(msg)) return new RpcError(msg, 'denied')
    if (/not found|-32000|unavailable|outside LuCI/i.test(msg)) return new RpcError(msg, 'unavailable')
    if (/timed? ?out|-32003/i.test(msg)) return new RpcError(msg, 'timeout')
    return new RpcError(msg, 'failed')
}

type Fn = (...a: unknown[]) => Promise<unknown>
const cache = new Map<string, Fn>()

/** Оболочка без объектов ubus (приложение для ПК: мост знает только объект `splify2`) ходит через
 *  `plugin_call` — шлюз роутера отдаёт тот же ответ программы плагина. */
let viaGateway = false
export function setGatewayRpc(on: boolean): void { viaGateway = on }

function bridgeCall(object: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    if (viaGateway && object.startsWith('splify2.p.'))
        return rpc.pluginCall(object.slice('splify2.p.'.length), method, params)
    const bridge = typeof window === 'undefined' ? undefined : window.luci_rpc
    if (!bridge) return Promise.reject(new RpcError(S.plugins.netSvyazi(`${object}.${method}`), 'unavailable'))
    const keys = Object.keys(params)
    const id = `${object}|${method}|${keys.join(',')}`
    let fn = cache.get(id)
    if (!fn) {
        fn = bridge.declare({ object, method, params: keys })
        cache.set(id, fn)
    }
    return fn(...keys.map((k) => params[k]))
}

/** Один вызов метода плагина. `{ok: false, error}` — отказ. */
export async function callPlugin<T>(id: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    let r: unknown
    try {
        r = await bridgeCall(`splify2.p.${id}`, method, params)
    } catch (e) {
        throw classify(e)
    }
    if (r && typeof r === 'object' && (r as { ok?: unknown }).ok === false) {
        const code = (r as { code?: unknown }).code
        const kind = code === 'timeout' ? 'timeout'
            : code === 'unavailable' || code === 'not_installed' || code === 'disabled' || code === 'no_method' ? 'unavailable' : 'failed'
        // Текст `error` хост уже подставил на языке каркаса; `code` и `args` — для плагина, у которого свой перевод.
        const args = (r as { args?: unknown }).args
        throw new RpcError(String((r as { error?: unknown }).error ?? S.plugins.otkaz), kind,
            typeof code === 'string' ? code : undefined,
            args && typeof args === 'object' ? (args as Record<string, string>) : undefined)
    }
    return r as T
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Долгий метод (`job: true`): ответ `{job}`, дальше `splify2.plugin_job {id}` до конца задания. */
export async function jobPlugin<T>(
    id: string, method: string, params: Record<string, unknown> = {}, onProgress?: (p: unknown) => void,
    poll = 1000,
): Promise<T> {
    const first = await callPlugin<{ job?: string }>(id, method, params)
    if (!first || typeof first.job !== 'string') return first as T
    for (;;) {
        await sleep(poll)
        let j
        try { j = await rpc.pluginJob(first.job) } catch (e) { throw classify(e) }
        if (j.state === 'running') { onProgress?.(j); continue }
        if (j.state === 'failed' || j.ok === false) throw new RpcError(j.error ?? S.plugins.otkaz, 'failed')
        return j.result as T
    }
}

export function deadlineOf<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new RpcError(S.plugins.netOtveta, 'timeout')), ms)
        p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(classify(e)) })
    })
}

/** `host.rpc` плагина `id`. */
export function pluginRpc(id: string): Rpc {
    return {
        call: (method, params) => callPlugin(id, method, params),
        job: (method, params, onProgress) => jobPlugin(id, method, params, onProgress),
        deadline: (p, ms) => deadlineOf(p, ms),
    }
}

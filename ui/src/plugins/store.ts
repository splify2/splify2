/** Действия над плагинами для вкладки «Плагины» и загрузки при старте: список от бэкенда, загрузчик,
 *  задания установки. Состояние — в `runtime.ts`, слоты — в `registry.ts`. */
import { rpc, type PluginAct } from '@/lib/rpc'
import { buildId } from '@/lib/assets'
import { S } from '@/copy'
import type { PluginEntry } from './api'
import { defaultEnv, syncPlugins, dropPlugin, type LoaderEnv } from './loader'
import { pluginsState } from './runtime'
import { normalizePlugins, normalizeRepos } from './normalize'
import { setGatewayRpc } from './rpc'

let env: LoaderEnv | null = null
let inflight: Promise<void> | null = null
let again = false

/** Окружение загрузчика; тесты и приложение для ПК подменяют его до первого `refreshPlugins`. */
export function configurePlugins(over: Partial<LoaderEnv>): void {
    setGatewayRpc(over.platform === 'desktop')
    env = defaultEnv({ hostVersion: buildId() || '0.0.0', ...over })
}

/** Спросить список у бэкенда и привести загрузку плагинов в соответствие. Вызовы, пришедшие во время
 *  работы, сворачиваются в один повторный. */
export function refreshPlugins(): Promise<void> {
    if (inflight) { again = true; return inflight }
    inflight = (async () => {
        do {
            again = false
            try {
                const r = await rpc.pluginsList()
                const repos = normalizeRepos(r?.repos)
                const list = normalizePlugins(r?.plugins, repos)
                pluginsState.setEntries(list)
                env ??= defaultEnv({ hostVersion: buildId() || '0.0.0' })
                await syncPlugins(list, env)
            } catch (e) {
                // Список не пришёл (старый бэкенд, нет плагинов): панель живёт без них.
                pluginsState.setError(e instanceof Error ? e.message : String(e))
                if (!pluginsState.get().loaded) pluginsState.setEntries([])
            }
        } while (again)
    })().finally(() => { inflight = null })
    return inflight
}

/** Выполнить действие над плагином и перечитать список. Отказ — исключением с текстом бэкенда. */
export async function act(run: () => Promise<PluginAct>): Promise<PluginAct> {
    const r = await run()
    if (!r.ok) throw new Error(r.error || S.plugins.otkaz)
    return r
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Установка и обновление — задания: ответ `{job}`, дальше опрос `plugin_job` до конца. */
export async function runJob(
    start: () => Promise<PluginAct>, onStep?: (text: string) => void, poll = 1000,
): Promise<void> {
    const r = await act(start)
    if (r.job) {
        for (;;) {
            await sleep(poll)
            const j = await rpc.pluginJob(r.job)
            if (j.state === 'running') { onStep?.(j.progress ?? ''); continue }
            if (j.state === 'failed' || j.ok === false) throw new Error(j.error || S.plugins.otkaz)
            break
        }
    }
    await refreshPlugins()
}

export const pluginActions = {
    install: (id: string, version?: string, onStep?: (t: string) => void) =>
        runJob(() => rpc.pluginInstall(id, version), onStep),
    update: (id: string, onStep?: (t: string) => void) => runJob(() => rpc.pluginUpdate(id), onStep),
    remove: async (id: string) => { await act(() => rpc.pluginRemove(id)); await refreshPlugins() },
    enable: async (id: string) => { await act(() => rpc.pluginEnable(id)); await refreshPlugins() },
    disable: async (id: string) => { await act(() => rpc.pluginDisable(id)); await refreshPlugins() },
    autoupdate: async (id: string, enabled: boolean) => { await act(() => rpc.pluginAutoupdate(id, enabled)); await refreshPlugins() },
}

/** Предохранитель просит отключить плагин: в этой сессии он снимается сразу, на роутере — запросом.
 *  Запрос не вышел — плагин всё равно остаётся снятым до перезагрузки панели. */
export async function disableBroken(e: Pick<PluginEntry, 'id' | 'name'>): Promise<void> {
    await dropPlugin(e.id, S.plugins.otklyuchen(e.name))
    try { await act(() => rpc.pluginDisable(e.id)) } catch { /* осталось только на эту сессию */ }
    await refreshPlugins()
}

/** Загрузчик плагинов UI (host-api.md, «Загрузка»).
 *
 *  Для каждого включённого плагина с `ui`: сверка версии host API → словари → `import()` модуля →
 *  `activate(host)`. Плагин, который не прошёл, не грузится, а причина записывается в его карточку
 *  (`runtime.ts`). Ошибка плагина не роняет панель: и при загрузке, и при запуске она ловится, а
 *  регистрации плагина снимаются. Темы манифеста и словари плагинов языка подключаются и без кода.
 *
 *  Безопасный режим: `?safe=1` в адресе панели — плагины не грузятся совсем. */
import { S } from '@/copy'
import { registerHostDict } from '@/copy'
import { HOST_API_VERSION, type PluginEntry, type PluginModule } from './api'
import { createHost, pluginRoot, preactExports, type HostEnv, type MadeHost } from './host'
import { fetchJson, loadDicts, type JsonFetcher } from './i18n'
import { registry } from './registry'
import { pluginsState } from './runtime'
import { satisfies } from './semver'
import { manifestTheme, registerTheme } from './themes'

export interface LoaderEnv extends HostEnv {
    /** Загрузить ES-модуль по адресу. В панели — динамический `import()`, в тестах — заглушка. */
    importModule(url: string): Promise<unknown>
    fetchJson: JsonFetcher
    /** Безопасный режим. */
    safe: boolean
}

export function safeMode(): boolean {
    try {
        return typeof location !== 'undefined' && new URLSearchParams(location.search).get('safe') === '1'
    } catch {
        return false
    }
}

export const defaultEnv = (over: Partial<LoaderEnv> & Pick<HostEnv, 'hostVersion'>): LoaderEnv => ({
    platform: 'luci',
    importModule: (url) => import(/* @vite-ignore */ url),
    fetchJson,
    safe: safeMode(),
    ...over,
})

interface Live {
    version: string
    made: MadeHost | null
    mod: PluginModule | null
    off: Array<() => void>
}

const loaded = new Map<string, Live>()
/** Отключённые в этой сессии (ошибка отрисовки, запуска): до перезагрузки панели не поднимаются, как бы ни ответил бэкенд. */
const sessionOff = new Map<string, string>()

/** `globalThis.__splify2_host`: прокладка preact плагина берёт всё отсюда (ставится до первого
 *  `import()`; значение одно и то же, повторная запись безвредна). */
function ensureShim() {
    ;(globalThis as { __splify2_host?: unknown }).__splify2_host = { preact: preactExports }
}

function hasUi(e: PluginEntry): boolean {
    return !!e.ui?.entry
}

/** Почему плагин не грузится из-за версии host API; null — годится. */
export function incompatibility(e: PluginEntry, apiVersion: string): string | null {
    const range = e.compat?.['host-api']
    if (range === undefined) return S.plugins.netVersiiInterfeysa(e.name)
    if (!satisfies(apiVersion, range)) return S.plugins.trebuetHostApi(e.name, e.version, range, apiVersion)
    return null
}

async function unload(id: string) {
    const l = loaded.get(id)
    if (!l) return
    loaded.delete(id)
    try { l.mod?.deactivate?.() } catch (err) { console.error(`[plugin ${id}] deactivate`, err) }
    for (const o of l.off.splice(0)) { try { o() } catch (err) { console.error(`[plugin ${id}] dispose`, err) } }
    l.made?.cleanup()
    registry.clearOwner(id)
}

async function activate(e: PluginEntry, env: LoaderEnv): Promise<void> {
    const live: Live = { version: e.version, made: null, mod: null, off: [] }
    loaded.set(e.id, live)
    pluginsState.setRuntime(e.id, { status: 'loading' })
    try {
        const root = pluginRoot(e)
        const dicts = await loadDicts(root, e.languages, env.fetchJson)
        ensureShim()
        const made = createHost(e, dicts, env)
        live.made = made
        // `ui.css` манифеста — пути от каталога плагина («ui/style.css»), а `styles.link` считает от `ui/`.
        for (const css of e.ui?.css ?? []) made.host.styles.link(`../${css}`)
        const entryUrl = new URL(e.ui!.entry, new URL(root, typeof location !== 'undefined' ? location.href : 'http://localhost/'))
        const url = `${entryUrl.pathname}?v=${encodeURIComponent(e.version)}`
        const mod = (await env.importModule(url)) as Partial<PluginModule> & { default?: Partial<PluginModule> }
        const m = (mod.default && typeof mod.default.activate === 'function' ? mod.default : mod) as Partial<PluginModule>
        if (typeof m.activate !== 'function') throw new Error(S.plugins.netActivate)
        live.mod = m as PluginModule
        const dispose = await m.activate(made.host)
        if (typeof dispose === 'function') live.off.push(dispose)
        // Плагин могли отключить, пока он грузился: тогда регистрации уже не нужны.
        if (loaded.get(e.id) !== live) { made.cleanup(); return }
        pluginsState.setRuntime(e.id, { status: 'active' })
    } catch (err) {
        console.error(`[plugin ${e.id}]`, err)
        await unload(e.id)
        const msg = err instanceof Error ? err.message : String(err)
        const reason = S.plugins.nePodnyalsya(e.name, msg)
        sessionOff.set(e.id, reason)
        pluginsState.setRuntime(e.id, { status: 'failed', reason })
    }
}

/** Темы манифеста и словарь плагина языка — без кода плагина. */
async function declarative(e: PluginEntry, env: LoaderEnv): Promise<Array<() => void>> {
    const off: Array<() => void> = []
    for (const t of e.themes ?? []) off.push(registerTheme(e.id, manifestTheme(e.id, t)))
    for (const hl of e.host_langs ?? []) {
        if (hl.host && !satisfies(env.hostVersion, hl.host)) continue
        const d = await env.fetchJson(hl.url)
        if (d && typeof d === 'object') registerHostDict(hl.lang, hl.name, d as Record<string, string>)
    }
    return off
}

const themeOff = new Map<string, Array<() => void>>()

/** Привести загруженные плагины в соответствие со списком бэкенда. Зовётся после каждого `plugins_list`. */
export async function syncPlugins(entries: PluginEntry[], env: LoaderEnv): Promise<void> {
    const apiVersion = env.apiVersion ?? HOST_API_VERSION
    const wanted = new Map(entries.map((e) => [e.id, e]))
    for (const id of [...sessionOff.keys()]) if (wanted.get(id)?.state !== 'enabled') sessionOff.delete(id)
    for (const id of [...loaded.keys()]) {
        const e = wanted.get(id)
        if (!e || e.state !== 'enabled' || loaded.get(id)!.version !== e.version || env.safe) await unload(id)
    }
    for (const [id, offs] of [...themeOff]) {
        const e = wanted.get(id)
        if (!e || e.state !== 'enabled' || env.safe) {
            for (const o of offs) o()
            themeOff.delete(id)
        }
    }
    await Promise.all(entries.map(async (e) => {
        if (e.state !== 'enabled') { pluginsState.setRuntime(e.id, { status: 'off' }); return }
        if (sessionOff.has(e.id)) { pluginsState.setRuntime(e.id, { status: 'failed', reason: sessionOff.get(e.id)! }); return }
        if (env.safe) { pluginsState.setRuntime(e.id, { status: 'safe' }); return }
        const declares = !!(e.themes?.length || e.host_langs?.length)
        if (!hasUi(e) && !declares) { pluginsState.setRuntime(e.id, { status: 'none' }); return }
        const bad = incompatibility(e, apiVersion)
        if (bad) { pluginsState.setRuntime(e.id, { status: 'incompatible', reason: bad }); return }
        if (declares && !themeOff.has(e.id)) themeOff.set(e.id, await declarative(e, env))
        if (!hasUi(e)) { pluginsState.setRuntime(e.id, { status: 'none' }); return }
        if (env.platform === 'desktop' && e.ui!.desktop === false) {
            pluginsState.setRuntime(e.id, { status: 'skipped', reason: S.plugins.netVPrilozhenii(e.name) })
            return
        }
        if (loaded.has(e.id)) return
        await activate(e, env)
    }))
}

/** Отключить плагин в этой сессии (ошибка отрисовки, «Отключить» в предохранителе). */
export async function dropPlugin(id: string, reason: string): Promise<void> {
    sessionOff.set(id, reason)
    await unload(id)
    pluginsState.setRuntime(id, { status: 'failed', reason })
}

/** Снять плагин, не трогая роутер: следующий `syncPlugins` поднимет его заново (смена «показывать в полосе»). */
export async function reloadPlugin(id: string): Promise<void> {
    sessionOff.delete(id)
    await unload(id)
}

/** Для тестов: забыть всё загруженное. */
export async function resetLoader(): Promise<void> {
    for (const id of [...loaded.keys()]) await unload(id)
    for (const offs of themeOff.values()) for (const o of offs) o()
    themeOff.clear()
    sessionOff.clear()
    pluginsState.reset()
}

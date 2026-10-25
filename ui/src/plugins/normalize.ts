/** Записи менеджера плагинов (`steer plugin list|search|repo list --json`) → модель панели.
 *
 *  Бэкенд отдаёт массивы менеджера как есть (docs/rpcd-api.md), а у менеджера запись — это
 *  `state.json` плюс манифест. Поэтому разбор терпимый: поле берётся плоским или из вложенного
 *  `manifest`, недостающее получает разумное умолчание. Чего панели недостаёт без этого, видно по
 *  карточке: нет `compat` — плагин с `ui` не грузится («не называет версию панели»). */
import type { CatalogEntry, ManifestHostLang, ManifestTheme, PluginEntry, RepoEntry } from './api'

/** Каталог плагинов на роутере для LuCI; для других оболочек адрес приходит от бэкенда (`root`). */
export const PLUGIN_ROOT = '/luci-static/resources/splify2/plugins/'

type Raw = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const list = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined)

export function normalizeRepo(raw: unknown): RepoEntry | null {
    const r = obj(raw)
    const name = str(r.name) ?? str(r.id)
    const url = str(r.url)
    if (!name) return null
    return { name, url: url ?? '', official: r.official === true || (r.official === undefined && name === 'splify2'), key_id: str(r.key_id) ?? str(r.key) }
}

export const normalizeRepos = (raw: unknown): RepoEntry[] =>
    (Array.isArray(raw) ? raw : []).map(normalizeRepo).filter((r): r is RepoEntry => !!r)

function trustOf(r: Raw, repo: string, repos: RepoEntry[]): PluginEntry['trust'] {
    const t = str(r.trust)
    if (t === 'official' || t === 'third-party' || t === 'unsigned') return t
    if (r.unsigned === true) return 'unsigned'
    const known = repos.find((x) => x.name === repo)
    return (known ? known.official : repo === 'splify2') ? 'official' : 'third-party'
}

/** Виды выходов из манифеста: `steer.kinds[].name`. */
const kindsOf = (m: Raw): string[] | undefined => {
    const k = obj(m.steer).kinds
    return Array.isArray(k) ? k.map((x) => str(obj(x).name)).filter((x): x is string => !!x) : undefined
}

/** Права: массив слов или объект «право → …» (`permissions` манифеста). */
const permsOf = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? list(v) : v && typeof v === 'object' ? Object.keys(v as Raw).filter((k) => (v as Raw)[k]) : undefined

export function railShown(id: string): boolean {
    try { return localStorage.getItem(`splify2.rail.${id}`) !== '0' } catch { return true }
}

export function setRailShown(id: string, on: boolean): void {
    try { localStorage.setItem(`splify2.rail.${id}`, on ? '1' : '0') } catch { /* без памяти — только на эту сессию */ }
}

export function normalizePlugin(raw: unknown, repos: RepoEntry[]): PluginEntry | null {
    const r = obj(raw)
    const id = str(r.id)
    if (!id) return null
    const m = { ...obj(r.manifest), ...r }
    const repo = str(r.repo) ?? 'splify2'
    const root = str(r.root) ?? `${PLUGIN_ROOT}${id}/`
    const ui = obj(m.ui)
    const i18n = obj(m.i18n)
    const hostLangs: ManifestHostLang[] = Object.entries(obj(i18n.host)).flatMap(([lang, v]) => {
        const f = str(obj(v).file)
        return f ? [{ lang, name: str(obj(v).name) ?? lang, url: new URL(f, new URL(root, 'http://x')).pathname, host: str(obj(v).host) }] : []
    })
    const themes = Array.isArray(m.themes) ? (m.themes as ManifestTheme[]).filter((t) => t && typeof t.name === 'string' && t.light) : undefined
    return {
        id,
        name: str(m.name) ?? id,
        description: str(m.description),
        version: str(r.version) ?? str(m.version) ?? '',
        repo,
        trust: trustOf(r, repo, repos),
        type: ['plugin', 'library', 'language', 'theme'].includes(m.type) ? m.type : undefined,
        state: ['installed', 'enabled', 'disabled', 'failed', 'pending'].includes(r.state) ? r.state : 'installed',
        why: str(r.why) ?? null,
        update: str(r.update) ?? str(r.update_to) ?? str(r.available),
        compat: m.compat && typeof m.compat === 'object' ? (m.compat as Record<string, string>) : undefined,
        ui: str(ui.entry) ? {
            entry: ui.entry, css: list(ui.css), desktop: typeof ui.desktop === 'boolean' ? ui.desktop : undefined,
            rail: ui.rail === true, base: str(ui.base),
        } : undefined,
        rail_shown: railShown(id),
        languages: list(i18n.languages) ?? list(m.languages),
        root: str(r.root),
        themes,
        host_langs: hostLangs.length ? hostLangs : undefined,
        kinds: list(m.kinds) ?? kindsOf(m),
        permissions: permsOf(m.permissions),
        autoupdate: typeof r.auto_update === 'boolean' ? r.auto_update : typeof r.autoupdate === 'boolean' ? r.autoupdate : undefined,
        pinned: typeof r.pinned === 'boolean' ? r.pinned : undefined,
        packages: list(r.packages),
        used_by: list(r.used_by),
    }
}

export const normalizePlugins = (raw: unknown, repos: RepoEntry[]): PluginEntry[] =>
    (Array.isArray(raw) ? raw : []).map((x) => normalizePlugin(x, repos)).filter((p): p is PluginEntry => !!p)

export function normalizeCatalog(raw: unknown, repos: RepoEntry[]): CatalogEntry[] {
    return (Array.isArray(raw) ? raw : []).flatMap((x) => {
        const r = obj(x)
        const id = str(r.id)
        if (!id) return []
        const m = { ...obj(r.manifest), ...r }
        const repo = str(r.repo) ?? 'splify2'
        return [{
            id, name: str(m.name) ?? id, description: str(m.description), version: str(r.version) ?? '',
            repo, trust: trustOf(r, repo, repos),
            kinds: list(m.kinds) ?? kindsOf(m), permissions: permsOf(m.permissions),
            installed: r.installed === true, size: typeof r.size === 'number' ? r.size : undefined,
        }]
    })
}

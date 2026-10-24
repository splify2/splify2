import type { Channel, ServiceEntry, Spec } from '@/lib/model'
import { isPart } from '@/lib/model'
import { pathFor, srsProbe } from '@/lib/rulefiles'

/** Быстрый старт на пустой главной (D-P3.1): ссылка подписки → выход → плитки «что обходить» →
 *  правила. Здесь — то, что не про экран: какие плитки и как плитка превращается в правило. */

export interface Tile {
    id: string
    /** Какие записи каталога плитка берёт — по id и названию, без зашитых путей: каталог издателя
     *  может поменять состав, а плитка должна продолжать находить «своё». */
    match?: RegExp
    /** Плитка «весь трафик» — правило без списков. */
    all?: boolean
}

export const TILES: Tile[] = [
    { id: 'youtube', match: /youtube/i },
    { id: 'discord', match: /discord/i },
    { id: 'telegram', match: /telegram/i },
    { id: 'ai', match: /anthropic|google_ai|openai|chatgpt|gemini|claude/i },
    { id: 'all', all: true },
]

/** Записи каталога, которые берёт плитка. Пусто — каталог их не знает (плитка не показывается). */
export function tileEntries(t: Tile, services: ServiceEntry[]): ServiceEntry[] {
    if (!t.match) return []
    return services.filter((sv) => t.match!.test(`${sv.id} ${sv.name}`))
}

/** Выход по умолчанию для первого правила: первый туннельный, не служебная часть пула и не блок. */
export function quickOutput(spec: Spec): string | undefined {
    return Object.entries(spec.outputs)
        .find(([, o]) => o.kind !== 'direct' && (o.kind as string) !== 'block' && !isPart(o))?.[0]
}

/** Правило плитки: записи каталога — списками или набором .srs (как в редакторе правила), «весь
 *  трафик» — без списков. Имя занято — добавляется номер. */
export async function tileRule(
    t: Tile, title: string, entries: ServiceEntry[], out: string, local: Record<string, unknown>, used: Set<string>,
): Promise<Channel> {
    let name = title
    for (let n = 2; used.has(name); n++) name = `${title} ${n}`
    used.add(name)
    if (t.all) return { name, out, match: { any: true } }
    const pref = new Set<string>(), doms = new Set<string>(), srs = new Set<string>()
    const narrow: NonNullable<Channel['narrow']> = {}
    for (const sv of entries) {
        const r = sv.srs ? await srsProbe(sv, local) : { asked: false as const }
        if ('set' in r && r.set) { srs.add(r.set); continue }
        for (const f of sv.prefixes) {
            pref.add(pathFor(f))
            const nw = sv.narrow ?? ('narrow' in r ? r.narrow : undefined)
            if (nw) narrow[pathFor(f)] = nw
        }
        for (const f of sv.domains) doms.add(pathFor(f))
    }
    return {
        name, out,
        match: {
            ...(pref.size ? { prefixes_files: [...pref] } : {}),
            ...(doms.size ? { domains_files: [...doms] } : {}),
            ...(srs.size ? { srs_files: [...srs] } : {}),
            ...(doms.size || srs.size ? { mode: 'fakeip' as const } : {}),
        },
        ...(Object.keys(narrow).length ? { narrow } : {}),
    }
}

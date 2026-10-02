/** Файлы правила и сервисов каталога — чистые функции без интерфейса.
 *
 *  Жили в редакторе правила, но их читает и каталог (другой раздел). Модуль, общий для двух
 *  ленивых кусков, rollup выносил в отдельный `splify-RuleEditor.js` без пина версии, и
 *  scripts/check-dist.mjs валил сборку. В src/lib они уезжают в общий кусок. */
import { rpc } from '@/lib/rpc'
import { type Channel, type ServiceEntry } from '@/lib/model'

/** Путь, по которому движок будет искать список. Повторяет путь у издателя, а не берёт от него
 *  одно имя файла: иначе адресный `hodca.lst` и доменный `domains/hodca.lst` становятся одним
 *  локальным файлом и затирают друг друга. Ровно это и случилось однажды — nft отверг набор
 *  ЦЕЛИКОМ, и встала вся маршрутизация, а не один канал. Правило продублировано в бэкенде
 *  (`local_path`), и это единственное место, где дублирование терпимо: разойдясь, они дадут
 *  «список скачан, а правило его не находит». */
export function pathFor(file: string) {
    return `/etc/steer/lists/${file.replace(/^\/+/, '')}`
}

/** Путь набора, который правило берёт ФАЙЛОМ: запись каталога без «.lst»
 *  (`jinndi/domains/adguard.srs.lst` → `…/adguard.srs`). Так его кладёт бэкенд (`ad_srs_rel`). */
export function srsPathFor(file: string) {
    const p = pathFor(file).replace(/\.lst$/, '')
    return p.endsWith('.srs') ? p : `${p}.srs`
}

/** Все файлы правила: списки и наборы файлом. */
export function ruleFiles(ch: Channel): string[] {
    return [...(ch.match.prefixes_files || []), ...(ch.match.domains_files || []), ...(ch.match.srs_files || [])]
}

/** Пути сервиса в правиле — списками и, у набора каталога, файлом. */
export function serviceFiles(sv: ServiceEntry): string[] {
    const files = [...sv.prefixes, ...sv.domains]
    return [...files.map(pathFor), ...(sv.srs ? files.map(srsPathFor) : [])]
}

const relOf = (p: string) => p.replace(/^\/etc\/steer\/lists\//, '').replace(/^\/+/, '')

/** Сервис уже лежит на роутере — списками или набором. */
export function onRouter(sv: ServiceEntry, local: Record<string, unknown>): boolean {
    const set = sv.srs ? srsPathFor(sv.prefixes[0] ?? sv.domains[0]) : ''
    return (!!set && !!local[relOf(set)]) || sv.parts.every((p) => local[relOf(p.file)])
}

/** Как сервис встаёт в правило: путь набора файлом или `undefined` — списками, как всегда.
 *
 *  Набор каталога бывает не выразим списком (исключения фильтра AdGuard, splify2-lists#1):
 *  тогда роутер кладёт его самого, и правило берёт его ключом `srs`. Узнать это можно только
 *  разобрав набор, то есть скачав его (`list_fetch` отвечает полем `srs`); лежащее на роутере
 *  отвечает без сети. Не вышло спросить — списками: сохранение доскачает их само. */
export async function srsOf(sv: ServiceEntry, local: Record<string, unknown>): Promise<string | undefined> {
    if (!sv.srs) return undefined
    const set = srsPathFor(sv.prefixes[0] ?? sv.domains[0])
    if (local[relOf(set)]) return set
    if (sv.parts.every((p) => local[relOf(p.file)])) return undefined
    const part = sv.parts.find((p) => p.kind === 'prefixes') ?? sv.parts[0]
    const r = await rpc.listFetch(part.id, part.kind).catch(() => null)
    return r?.ok && r.srs ? r.srs : undefined
}



/** Сервис выбран, если в правиле есть ХОТЯ БЫ ОДНА его часть.
 *
 *  Не «все части»: сервис бывает включён наполовину — например, руками правленной спекой, — и
 *  показать его невыбранным значило бы предложить включить то, что уже включено. */
export function selectedIds(ch: Channel, services: ServiceEntry[]): string[] {
    const files = new Set(ruleFiles(ch))
    return services.filter((sv) => serviceFiles(sv).some((f) => files.has(f))).map((sv) => sv.id)
}

export function isDomains(ch: Channel) {
    return (ch.match.domains_files?.length ?? 0) > 0
}

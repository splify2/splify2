import { useEffect, useState } from 'react'
import type { Output, PathDown } from '@/lib/model'
import { rpc } from '@/lib/rpc'

import { S } from '@/copy'
/** Помощник выхода — процесс, который ядро steer держит ради выхода (клиент VLESS, hysteria2,
 *  прокси, xsteer, мост tgws, обфускатор, обработчик zapret), — глазами демона (`steer ctl
 *  helper <выход>`, steer docs/ctl.md, «helper»). Строка JSON на помощника; у выхода их бывает
 *  несколько (интерфейс с обфускацией и ещё что-то), поэтому — массив.
 *
 *  Чего здесь нет: счётчиков и рукопожатия клиента xsteer (он сообщает демону только смену
 *  состояния) — их у такого выхода не знает никто, кроме самого процесса. */
export interface HelperState {
    out: string
    /** Вид помощника: vless, hysteria2, proxy, xsteer, tgws, obfs, zapret… */
    helper: string
    /** Процесс есть. */
    running: boolean
    /** Последнее событие помощника — «поднят». */
    up: boolean
    /** Когда `up` сменилось, секунды Unix; 0 — ни разу. */
    since: number
    started: number
    /** Перезапусков с подъёма демона. */
    restarts: number
    /** Причина последнего отказа словами ядра или помощника; поля нет — отказа не было. */
    last_down?: string
    /** Бинарник модуля (`steer-vless`…), его версия из `hello` и отказ демона в нём. */
    module?: string
    module_ver?: string
    rejected?: boolean
    node?: number
    total?: number
    paths_down?: PathDown[]
}

/** Разобрать ответ метода `helper`: `{code, stdout}`, где stdout — строки JSON. Код не ноль
 *  (помощника нет, демон без `--supervise`) и битые строки — пустой массив, а не исключение:
 *  «о помощнике сказать нечего» не должно ломать строку выхода. */
export function parseHelpers(r: { code?: number; stdout?: string } | null | undefined): HelperState[] {
    if (!r || r.code !== 0 || typeof r.stdout !== 'string') return []
    const out: HelperState[] = []
    for (const line of r.stdout.split('\n')) {
        if (!line.trim()) continue
        try {
            const h = JSON.parse(line)
            if (h && typeof h === 'object' && typeof h.helper === 'string') out.push(h as HelperState)
        } catch {
            /* строка оборвана — пропускаем её, остальные годны */
        }
    }
    return out
}

/** Есть ли у выхода такого вида помощник (src/kinds/*.c, kind_ops.helper). Спрашивать демона о
 *  выходе без помощника незачем: ответ заранее известен, а вызов стоит запуска скрипта. */
export function hasHelper(o: Output): boolean {
    return (
        o.kind === 'vless' || o.kind === 'hysteria2' || o.kind === 'tunnel' || o.kind === 'xsteer' ||
        o.kind === 'tgws' || o.kind === 'zapret' || (o.kind === 'interface' && !!o.obfs)
    )
}

/** Беда помощника словами: модуль другой версии (демон его отверг), нет модуля, процесс не
 *  запущен; null — беды нет. Причину отказа словами процесса («процесс вышел (код 1)») экран не
 *  пересказывает — это техническое пояснение; её видно в журнале «Диагностики». Исключение —
 *  модуля нет: тогда «нужен пакет steer-…», это действие. */
export function helperTrouble(h: HelperState): string | null {
    if (h.rejected) return S.helperState.modulDrugoyVersii
    if (h.running) return null
    /* Бинарника модуля нет: демон пишет «нужен пакет steer-<имя>» — имя модуля в причине.
     * Падение процесса называется иначе («процесс вышел…»), и имени модуля в нём нет. */
    return h.module && h.last_down?.includes(h.module) ? S.helperState.nuzhenPaket(h.module) : S.helperState.neZapushchen
}

/** Слова о помощниках выхода для строки выхода: беды — в `words`, сколько раз помощников
 *  перезапускали — отдельно, в `restarts`: беда читается первой, счёт — последним. */
export function helperWords(hs: HelperState[]): { words: string[]; alarm: boolean; restarts: string | null } {
    const words = hs.map(helperTrouble).filter((w): w is string => !!w)
    const n = hs.reduce((k, h) => k + (h.restarts || 0), 0)
    return { words, alarm: words.length > 0, restarts: n > 0 ? S.helperState.perezapuskov(n) : null }
}

/** Помощники выходов, о которых спрашивают: по вызову на выход.
 *
 *  Спрашиваются при открытии и заново при смене состояния выходов (`key` — поднят ли и в отказе
 *  ли каждый): перезапуск помощника и отказ модуля видны в status переменой `up`, а опрашивать
 *  демона на каждом круге ради неизменного ответа незачем. Отказ вызова (бэкенд постарше, демон
 *  не запущен) — пусто: «о помощнике сказать нечего». */
export function useHelpers(names: string[], key: string): Record<string, HelperState[]> {
    const [map, setMap] = useState<Record<string, HelperState[]>>({})
    const list = names.join(',')
    useEffect(() => {
        if (!list) return
        let stop = false
        for (const n of list.split(',')) {
            rpc.helper(n)
                .then((r) => { if (!stop) setMap((m) => ({ ...m, [n]: parseHelpers(r) })) })
                .catch(() => { if (!stop) setMap((m) => ({ ...m, [n]: [] })) })
        }
        return () => { stop = true }
    }, [list, key])
    return map
}

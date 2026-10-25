import type { PathDown } from '@/lib/model'

import { S } from '@/copy'

/** Помощник выхода — процесс, который ядро steer держит ради выхода (клиент VLESS, hysteria2,
 *  прокси, xsteer, мост tgws, обфускатор), — глазами демона (`steer ctl
 *  helper <выход>`, steer docs/ctl.md, «helper»). Строка JSON на помощника; у выхода их бывает
 *  несколько (интерфейс с обфускацией и ещё что-то), поэтому — массив.
 *
 *  Чего здесь нет: счётчиков и рукопожатия клиента xsteer (он сообщает демону только смену
 *  состояния) — их у такого выхода не знает никто, кроме самого процесса. */
export interface HelperState {
    out: string
    /** Вид помощника: vless, hysteria2, proxy, xsteer, tgws, obfs… */
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

import type { OutputStatus } from '@/lib/model'

import { S } from '@/copy'
/** Беда выхода, у которого устройство ЕСТЬ: ядро 2.0 различает её двумя полями status.
 *
 *  `failed: true` — сторож признал выход неработающим (ни одно устройство не ответило на пробу)
 *  и поставил `on_fail`; `up` тогда ложно, хотя устройство на месте. `node_down` — клиент туннеля
 *  потерял узел за устройством и сказал об этом сам. До этих слов интерфейс знал только `up` и
 *  говорил «выход не поднят: устройства нет» там, где устройство стоит, а не отвечает сервер за
 *  ним — и человек шёл чинить не то.
 *
 *  Причина `node_down.why` — слова клиента о проверке узла («TCP не соединился»): на экран она не
 *  выводится, это техническое пояснение; его печатает «Диагностика» словами ядра. */
export function outDown(st?: OutputStatus | null): 'node' | 'failed' | null {
    if (!st) return null
    if (st.node_down) return 'node'
    if (st.failed) return 'failed'
    return null
}

/** Короткое слово для строки выхода («Выходы», правило на главной). null — беды этого рода нет. */
export function outDownWord(st?: OutputStatus | null): string | null {
    const d = outDown(st)
    return d === 'node' ? S.outState.uzelNeOtvechaet : d === 'failed' ? S.outState.neOtvechaet : null
}

/** Куда идёт трафик выхода, пока он не отвечает, — тем, что записано в `on_fail`. Без отказа
 *  сторожа (узел потерян, а сторож ещё не переключил) — что выход вернётся сам. */
export function outDownLine(st: OutputStatus): string {
    if (!st.failed) return S.outState.vernyotsyaSam
    return st.on_fail === 'direct'
        ? S.outState.trafikNapryamuyu
        : st.on_fail === 'zapret'
          ? S.outState.trafikCherezObhod
          : S.outState.trafikOstanovlen
}

import { insecureApplies, type Output, type OutputStatus } from '@/lib/model'

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

/** Что ещё ядро 2.0 говорит о выходе сверх «работает ли» — словами для строки выхода в
 *  «Выходах». `alarm` — среди слов есть беда (строка цветом предупреждения).
 *
 *  - мост tgws: пути, которые помощник отставил (`paths_down`); пустой массив — все пути живы;
 *  - VLESS, trojan, vmess, http с `insecure`: сертификат узла не проверяется — решение человека,
 *    не беда;
 *  - IPv6 от хоста, только у выхода с записанным `ipv6`: какой префикс раздаётся (записанный
 *    или выведенный ядром; `null` — не узнать), подменяется ли IPv6 при `nat`, и не действует
 *    ли ключ на этой платформе (`ipv6_applied: false`). Без ключа о IPv6 здесь молчим: подмену
 *    по умолчанию проверяет «Диагностика», и повторять её в каждой строке — шум. */
export function outExtras(
    o: Output,
    st?: OutputStatus | null,
    /** insecure: false — проверку сертификата показывает бейдж (lib/badges.ts), словом не нужно. */
    opts: { insecure?: boolean } = {},
): { words: string[]; alarm: boolean } {
    const words: string[] = []
    let alarm = false
    if (!st) return { words, alarm }
    if (o.kind === 'tgws' && Array.isArray(st.paths_down) && st.paths_down.length) {
        words.push(S.outState.putiNeOtvechayut(st.paths_down.length))
        alarm = true
    }
    /* У vless признак печатает ядро, у прокси с TLS (trojan, vmess, http) — нет: там он из спеки. */
    if (opts.insecure !== false && (st.insecure || (o.insecure && insecureApplies(o.kind)))) words.push(S.outState.sertifikatNeProveryaetsya)
    if (st.ipv6_applied === false) {
        words.push(S.outState.ipv6ZdesNeDeystvuet)
    } else if (o.ipv6 === 'routed') {
        /* `prefix` в ответе status — у выхода-донора: записанный или выведенный по ядру сейчас,
         * null — не узнать. Поля нет вовсе (ядро старше) — записанный в спеке. */
        const raw = (st as { prefix?: string | null }).prefix
        const p = raw === undefined ? o.prefix : raw
        if (p) words.push(S.outState.ipv6Prefiks(p))
        else {
            words.push(S.outState.ipv6PrefiksNeIzvesten)
            alarm = true
        }
    } else if (o.ipv6 === 'nat' && st.nat6 !== undefined) {
        if (st.nat6) words.push(S.outState.ipv6AdresomHosta)
        else {
            words.push(S.outState.ipv6NePodmenyaetsya)
            alarm = true
        }
    }
    return { words, alarm }
}

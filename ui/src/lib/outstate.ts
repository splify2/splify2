import { insecureApplies, type Output, type OutputStatus, type TunnelPoolState } from '@/lib/model'
import { plainName } from '@/lib/nodename'

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

/** Все кандидаты выхода исключены («Не брать»): слово ядра — probe.state `excluded`. Не отказ
 *  сторожа и не «не запущен»: узлы в подписке есть, их не велено брать, и чинится это в «Не
 *  брать», а не перезапуском. Отказ сторожа и остановка помощника при этом — следствия: без
 *  отдельного слова строка выхода говорила «не отвечает · не запущен · перезапусков: N» и
 *  отправляла чинить то, что не сломано. */
export function outExcluded(st?: OutputStatus | null): boolean {
    return st?.probe?.state === 'excluded'
}

/** Короткое слово для строки выхода («Выходы», правило на главной). null — беды этого рода нет.
 *  Исключение всех кандидатов — своё слово, как в блоке выхода (OutputCards): оно называет
 *  причину, а сторож в этот момент тоже считает выход неработающим, и общее «не отвечает» её
 *  закрывало бы. */
export function outDownWord(st?: OutputStatus | null): string | null {
    if (outExcluded(st)) return S.outputCards.vseUzlyIsklyucheny
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

/** Пул узлов туннеля сейчас (spec-v2.md, «Пул узлов туннеля»): объект `vless` или `proxy` у
 *  выхода в status. Сводится по нескольким туннелям сразу — у пула выходов это его части.
 *  null — пула узлов нет (просят один узел), клиент не запущен или ядро старше пула.
 *
 *  - `names` — имена живых активных узлов (без флагов, как в остальном интерфейсе);
 *  - `have` / `want` — сколько работают и сколько просит спека;
 *  - `slots` — сколько клиент держит: меньше `want`, когда кандидатов в подписке меньше. */
export interface PoolNow {
    names: string[]
    have: number
    want: number
    slots: number
}

export function poolNow(sts: (OutputStatus | null | undefined)[]): PoolNow | null {
    const ps = sts
        .map((st) => st?.vless || st?.proxy)
        .filter((p): p is TunnelPoolState => !!p && Array.isArray(p.active) && (p.want ?? 1) > 1)
    if (!ps.length) return null
    const names = ps.flatMap((p) => p.active!.map((a) => plainName(a.name) || S.poolEditor.uzel(a.index + 1)))
    const want = ps.reduce((n, p) => n + (p.want ?? 1), 0)
    const slots = ps.reduce((n, p) => n + Math.min(p.slots ?? p.want ?? 1, p.want ?? 1), 0)
    return { names, have: names.length, want, slots }
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
    /** insecure: false — проверку сертификата показывает бейдж (lib/badges.ts), словом не нужно.
     *  parts — состояние частей пула выхода (туннелей по подписке, из которых он собран). */
    opts: { insecure?: boolean; parts?: (OutputStatus | undefined)[] } = {},
): { words: string[]; alarm: boolean } {
    const words: string[] = []
    let alarm = false
    /* Пул узлов: какие узлы работают сейчас; меньше заданного — беда. */
    const pool = poolNow([st, ...(opts.parts || [])])
    if (pool) {
        if (pool.have < pool.want) {
            words.push(pool.have ? `${S.outState.rabotayutIz(pool.have, pool.want)}: ${pool.names.join(', ')}` : S.outState.zhivyhNet)
            alarm = true
        } else words.push(S.outState.rabotayutUzly(pool.names.join(', ')))
    }
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

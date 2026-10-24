import { S } from '@/copy'

/** Отказы движка (ошибки steer при проверке и применении спеки) — человеческими словами.
 *
 *  Движок пишет для того, кто смотрит в журнал: «/etc/steer/lists/x.lst: cannot read a channel's
 *  list», «apply: output vless: cannot route via vless». Человеку нужно другое — что случилось и что
 *  сделать. Таблица ниже знает только проверенные формулировки; всё остальное показывается как есть:
 *  придуманное объяснение хуже сырого текста. Для известного отказа исходные слова остаются второй
 *  строкой — их удобно показать тому, кто поможет разобраться. */
const KNOWN: Array<[RegExp, (m: RegExpExecArray) => string]> = [
    [/cannot read a channel'?s? list/i, () => S.engineErr.spisokNeProchitan],
    [/выхода\s+«([^»]+)»\s+нет в outputs/i, (m) => S.engineErr.vyhodaNet(m[1])],
    [/cannot route via (\S+)/i, (m) => S.engineErr.neMarshrutizuetsya(m[1])],
    [/cannot open/i, () => S.engineErr.nastroykiNeOtkrylis],
    [/(unknown (flag|option)|неизвестный флаг)/i, () => S.engineErr.yadroStaroe],
    [/(address already in use|port .*in use)/i, () => S.engineErr.portZanyat],
]

/** Слова для человека; `null` — отказ незнакомый. */
export function knownEngineError(raw: string): string | null {
    for (const [re, say] of KNOWN) {
        const m = re.exec(raw)
        if (m) return say(m)
    }
    return null
}

/** Отказ движка для показа: известный — по-человечески с исходной строкой следом, незнакомый — как есть. */
export function engineErrorText(raw: string): string {
    const text = raw.trim()
    if (!text) return text
    const human = knownEngineError(text)
    return human ? `${human}\n${S.engineErr.ishodnyTekst(text)}` : text
}

/** Отказы сервера DNS из журнала резолвера: слова Go-сети («i/o timeout», «connection refused») —
 *  человеческими; незнакомое и уже русское («нет ответа за 4000 мс») — как есть. */
const DNS_KNOWN: Array<[RegExp, string]> = [
    [/i\/o timeout|deadline exceeded|timed out/i, S.engineErr.dnsTaymaut],
    [/connection refused/i, S.engineErr.dnsOtkaz],
    [/no route to host|network is unreachable/i, S.engineErr.dnsNetMarshruta],
    [/(tls|x509|certificate)/i, S.engineErr.dnsSertifikat],
    [/(no such host|lookup .* failed)/i, S.engineErr.dnsNetAdresa],
]

export function dnsErrorText(raw: string): string {
    const text = raw.trim()
    for (const [re, say] of DNS_KNOWN) if (re.test(text)) return `${say} (${text})`
    return text
}

/** Ответ «Куда пойдёт запрос» человеческими словами. Ядро печатает строку вида
 *  «youtube.com -> vless (правило: Youtube)»; узнаём только её и ничего не додумываем: не разобралось —
 *  `null`, и экран показывает вывод ядра как есть. Сырой текст при разобранном ответе остаётся по раскрытию. */
export function explainSummary(text: string): string | null {
    const m = /^\s*(\S+)\s*->\s*(\S+)(?:\s*\((?:правило|rule):\s*([^)]+)\))?/m.exec(text)
    if (!m) return null
    const [, host, out, rule] = m
    const where = out === 'direct' ? S.explain.napryamuyu : S.explain.cherezVyhod(out)
    return rule ? S.explain.poPravilu(host, where, rule) : S.explain.bezPravila(host, where)
}

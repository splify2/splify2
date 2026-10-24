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

import type { Live } from '@/lib/live'
import { History } from '@/lib/history'

/** Пустой Live: всё, чего тест не задал, отсутствует, а не выдумано.
 *
 *  Так проверка не может случайно опереться на фикстуру вместо кода — если поле важно,
 *  тест обязан назвать его сам. */
export function live(patch: Partial<Live> = {}): Live {
    return {
        status: null,
        net: null,
        build: null,
        releases: null,
        selfUpdate: null,
        error: null,
        errorKind: null,
        phase: null,
        diag: null,
        devs: null,
        speed: { ch: {}, dev: {} },
        rawSpeed: { ch: {}, dev: {} },
        history: new History(),
        conns: null,
        dnsLog: null,
        engineLog: null,
        want: () => () => {},
        refresh: () => {},
        ...patch,
    } as Live
}

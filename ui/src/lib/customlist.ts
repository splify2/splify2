import { rpc } from '@/lib/rpc'
import { toPunycodeList } from '@/lib/validate'
import { S } from '@/copy'

/** Свой список роутера: запись текстом, файлом (.lst/.txt — строками, .srs — набором sing-box) или по
 *  ссылке. Общая часть редакторов своих списков (CustomLists под LuCI, пилюли правила на ПК). */

export type ListKind = 'domains' | 'prefixes'
/** Сколько строк в одной порции файла: ubus не резиновый (list_put). */
const CHUNK = 1000
/** Порция набора .srs в base64, знаков. */
const SRS_CHUNK = 48_000

export const isSrs = (nameOrUrl: string) => /\.srs(\?.*)?$/i.test(nameOrUrl.trim())

/** Итог записи: сколько записей и сколько строк не подошло; у набора .srs — по видам. */
export type PutResult = { count: number; dropped: number; domains?: number; prefixes?: number }

function fail(r: { ok: boolean; error?: string }, why: string): never {
    throw new Error(r.error || why)
}

export async function putListText(name: string, kind: ListKind, text: string): Promise<PutResult> {
    const body = kind === 'domains' ? toPunycodeList(text) : text
    const r = await rpc.listPut({ name, kind, text: body, source: 'text' })
    if (!r.ok) fail(r, S.customLists.neSohranilos)
    return { count: r.count ?? 0, dropped: r.dropped ?? 0 }
}

export async function putListUrl(name: string, kind: ListKind, url: string): Promise<PutResult> {
    if (isSrs(url)) {
        const r = await rpc.listSrsPut({ name, url })
        if (!r.ok) fail(r, S.customLists.neSkachalos)
        return { count: (r.domains ?? 0) + (r.prefixes ?? 0), dropped: 0, domains: r.domains, prefixes: r.prefixes }
    }
    const r = await rpc.listPut({ name, kind, url, source: 'url' })
    if (!r.ok) fail(r, S.customLists.neSkachalos)
    return { count: r.count ?? 0, dropped: r.dropped ?? 0 }
}

/** Файл: строками порциями (первая замещает, остальные дописываются) или набором .srs в base64. */
export async function putListFile(name: string, kind: ListKind, file: File): Promise<PutResult> {
    if (isSrs(file.name)) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        let b64 = ''
        for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        b64 = btoa(b64)
        let last: Awaited<ReturnType<typeof rpc.listSrsPut>> = { ok: false }
        for (let i = 0; i < b64.length || i === 0; i += SRS_CHUNK) {
            const final = i + SRS_CHUNK >= b64.length
            last = await rpc.listSrsPut({ name, data: b64.slice(i, i + SRS_CHUNK), append: i > 0, final, filename: i === 0 ? file.name : undefined })
            if (!last.ok) fail(last, S.customLists.neSohranilos)
            if (final) break
        }
        return { count: (last.domains ?? 0) + (last.prefixes ?? 0), dropped: 0, domains: last.domains, prefixes: last.prefixes }
    }
    const raw = await file.text()
    const lines = (kind === 'domains' ? toPunycodeList(raw) : raw).split(/\r?\n/)
    let count = 0
    let dropped = 0
    for (let i = 0; i < lines.length; i += CHUNK) {
        const r = await rpc.listPut({
            name, kind, text: lines.slice(i, i + CHUNK).join('\n'), append: i > 0, source: 'file',
            filename: i === 0 ? file.name : undefined,
        })
        if (!r.ok) fail(r, S.customLists.neSohranilos)
        count = r.count ?? count
        dropped += r.dropped ?? 0
    }
    return { count, dropped }
}

/** Записи своего списка целиком (list_get порциями по байтам) — для правки набранного руками. */
export async function readList(name: string, kind: ListKind): Promise<string> {
    let text = ''
    for (let off = 0; ;) {
        const r = await rpc.listGet(name, kind, off)
        if (!r.ok) fail(r, S.customLists.neSohranilos)
        text += r.text ?? ''
        if (r.eof || r.next === undefined || r.next <= off) break
        off = r.next
    }
    return text
}

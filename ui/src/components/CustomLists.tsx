import { useEffect, useRef, useState } from 'react'
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Block, CardHead } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { rpc } from '@/lib/rpc'
import { customServices } from '@/lib/model'
import { toPunycodeList } from '@/lib/validate'

import { S } from '@/copy'
// Свои списки доменов и адресов.
//
// Вопрос задан снаружи: маршрутизировать можно было только то, что опубликовал издатель.
// Движок сопоставляет исключительно по файлам, а каталог рисуется из манифеста, поэтому
// свой .lst, положенный в /etc/steer/lists руками, был виден local_lists — и не
// предлагался ни одному правилу.
//
// Три способа ввода, и все три сводятся к одному методу rpcd. Файл читается в браузере и
// уходит порциями через append: cgi-io означал бы второй путь загрузки со своими правами
// и своей проверкой формата, а проверка формата здесь не косметическая — непринятая
// строка это молча пустой канал.
//
// ПРАВКА УЖЕ ЗАВЕДЁННОГО — по тому же разделению, каким список завели.
//
// Изменить список было нечем: единственная кнопка рядом с ним удаляла его, и «поправить
// одну строку» означало завести заново. Причём три способа ввода правятся по-разному, и это
// не оформление: у файла меняют ФАЙЛ, у ссылки — ССЫЛКУ, у набранного руками — сами
// ЗАПИСИ. Предложить всем один способ значило бы предложить человеку, положившему файл на
// двадцать тысяч строк, отредактировать его в текстовом поле — а заодно потерять всё, что
// он не станет туда вставлять.
//
// Поэтому происхождение теперь запоминается на роутере рядом со списком (list_custom), и
// редактор открывается ровно тот, которым список заводили. Происхождение неизвестно (список
// от прежней версии, положенный руками, вернувшийся из архива настроек) — предлагаются все
// три способа, как предлагалось всегда: признать незнание честнее, чем угадать неверно.

/** По сколько строк отправлять файл. ubus не резиновый, и целиком большой список в один
 *  вызов не помещается; тысяча строк — это порядка 20 КБ, с запасом. */
const CHUNK = 1000

/** До какого размера список можно править ТЕКСТОМ.
 *
 *  Не предел записи (тот втрое больше и стоит в бэкенде), а предел осмысленности: 64 КБ это
 *  порядка четырёх тысяч доменов, и текстовое поле с бо́льшим содержимым правят не глазами.
 *  Сверх этого редактор записей не открывается вовсе, и сказано почему — иначе человек ждал
 *  бы загрузки, которая приедет кусками и подвесит браузер. */
const TEXT_EDIT_MAX = 65536

/** Происхождение списка, как его помнит роутер. Пустая строка — не помним. */
type Source = '' | 'text' | 'file' | 'url'

interface CustomMeta {
    name: string
    kind: 'domains' | 'prefixes'
    source: Source
    url: string
    filename: string
    bytes: number
}

/** Чем список завели — словами человека, а не именем поля. */
function sourceText(m: CustomMeta | undefined) {
    if (!m || !m.source) return null
    if (m.source === 'url') return m.url ? S.customLists.ssylka(m.url) : S.customLists.ssylka2
    if (m.source === 'file') return m.filename ? S.customLists.fayl(m.filename) : S.customLists.fayl2
    return S.customLists.zapisiVruchnuyu
}

export default function CustomLists({
    local,
    onChanged,
}: {
    local: Record<string, { count: number; mtime: number }>
    onChanged: () => void | Promise<void>
}) {
    const [name, setName] = useState('')
    const [kind, setKind] = useState<'domains' | 'prefixes'>('domains')
    const [text, setText] = useState('')
    const [url, setUrl] = useState('')
    const [busy, setBusy] = useState(false)
    const fileRef = useRef<HTMLInputElement>(null)

    /** Происхождение своих списков, по ключу «вид:имя». Спрашивается отдельным вызовом, а не
     *  приходит вместе с local: local отвечает про ВСЕ списки на диске и считается одним awk
     *  по всему каталогу, а происхождение бывает только у своих — их единицы. */
    const [meta, setMeta] = useState<Record<string, CustomMeta>>({})
    /** Какой список правим сейчас. Один за раз: два открытых редактора на одном экране
     *  означали бы два поля «Сохранить», и человек не знает, какое из них про его список. */
    const [editing, setEditing] = useState<CustomMeta | null>(null)

    const loadMeta = async () => {
        try {
            const r = await rpc.listCustom()
            const m: Record<string, CustomMeta> = {}
            for (const l of r.lists || []) m[`${l.kind}:${l.name}`] = l
            setMeta(m)
        } catch {
            /* Метода нет — объект старее интерфейса (пакет обновили, rpcd не перезапустили).
             * Это не отказ роутера: без происхождения редактор предлагает все три способа,
             * то есть работает как работал. Показывать тут нечего. */
            setMeta({})
        }
    }
    useEffect(() => { void loadMeta() }, [local])

    const mine = customServices(local)
    const nameOk = /^[A-Za-z0-9_-]+$/.test(name)

    /** Общий хвост всех трёх способов: сообщить, сколько принято и сколько отброшено, и
     *  перечитать список. Отброшенные строки называются числом всегда — молчаливая потеря
     *  здесь была бы худшим из возможных поведений. */
    async function done(listName: string, count: number, dropped: number) {
        await onChanged()
        await loadMeta()
        notify(
            dropped
                ? S.customLists.spisokStrokOtbroshenoFormat(listName, count, dropped)
                : S.customLists.spisokStrok(listName, count),
            dropped ? 'warning' : 'info',
        )
        setText('')
        setUrl('')
        if (fileRef.current) fileRef.current.value = ''
    }

    /** Записать список одним вызовом: текстом или по ссылке.
     *
     *  Один путь на добавление и на правку нарочно: правка своего списка — это его перезапись
     *  целиком, и второй способ записи разошёлся бы с первым в проверке формата. */
    async function put(
        target: { name: string; kind: 'domains' | 'prefixes' },
        payload: { text?: string; url?: string },
        source: 'text' | 'url',
    ) {
        setBusy(true)
        try {
            /* Домены — в punycode ЗДЕСЬ, до отправки: браузер переводит `.рф` той же
               функцией, которой спрашивает адрес, а роутеру кириллица не годится ни в
               списке, ни в сравнении с запросом DNS. См. toPunycodeList. */
            const body = payload.text !== undefined && target.kind === 'domains'
                ? { ...payload, text: toPunycodeList(payload.text) }
                : payload
            const r = await rpc.listPut({ ...target, ...body, source })
            if (!r.ok) throw new Error(r.error || (payload.url ? S.customLists.neSkachalos : S.customLists.neSohranilos))
            await done(target.name, r.count ?? 0, r.dropped ?? 0)
            setEditing(null)
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy(false)
        }
    }

    async function putText() {
        if (!nameOk) { notify(S.customLists.imyaSpiskaLatinitsaTsifry, 'warning'); return }
        if (!text.trim()) { notify(S.customLists.spisokPust, 'warning'); return }
        await put({ name, kind }, { text }, 'text')
    }

    async function putUrl() {
        if (!nameOk) { notify(S.customLists.imyaSpiskaLatinitsaTsifry, 'warning'); return }
        if (!/^https?:\/\//.test(url.trim())) { notify(S.customLists.ssylkaDolzhnaNachinatsyaS, 'warning'); return }
        await put({ name, kind }, { url: url.trim() }, 'url')
    }

    /** Файл — порциями через append. Имя файла уезжает вместе с первой порцией: по нему
     *  человек потом узнаёт, что за список у него лежит, и его же видит, выбирая другой. */
    async function putFile(
        target: { name: string; kind: 'domains' | 'prefixes' },
        file: File,
    ) {
        setBusy(true)
        try {
            const raw = await file.text()
            // Тот же перевод, что у текстового пути: файл со своими доменами приносят чаще,
            // чем набирают их руками.
            const lines = (target.kind === 'domains' ? toPunycodeList(raw) : raw).split(/\r?\n/)
            let count = 0
            let dropped = 0
            // Первая порция ЗАМЕЩАЕТ, остальные дописываются. Иначе повторная загрузка
            // того же файла удваивала бы список, а не обновляла его.
            for (let i = 0; i < lines.length; i += CHUNK) {
                const r = await rpc.listPut({
                    ...target,
                    text: lines.slice(i, i + CHUNK).join('\n'),
                    append: i > 0,
                    source: 'file',
                    filename: i === 0 ? file.name : undefined,
                })
                if (!r.ok) throw new Error(r.error || S.customLists.neSohranilos)
                count = r.count ?? count
                dropped += r.dropped ?? 0
            }
            await done(target.name, count, dropped)
            setEditing(null)
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy(false)
        }
    }

    async function remove(listName: string, listKind: 'domains' | 'prefixes') {
        setBusy(true)
        try {
            const r = await rpc.listRemoveCustom(listName, listKind)
            if (!r.ok) throw new Error(r.error || S.customLists.neUdalosUdalit)
            await onChanged()
            await loadMeta()
            if (editing?.name === listName && editing?.kind === listKind) setEditing(null)
            notify(S.customLists.spisokUdalen(listName))
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        /* Bode: карточкой приложения — заголовок со счётчиком, списки строками через линию
           (имя, под ним вид и число записей), действия у правого края. */
        <Block>
            <CardHead title={S.customLists.svoiSpiski} meta={mine.length ? S.customLists.spiskov(mine.length) : undefined} />
            <p className="text-xs text-muted-foreground">
                {S.customLists.domenyIPodsetiKotoryh}</p>

            {mine.length > 0 && (
                <ul className="divide-y divide-border text-sm">
                    {mine.map((sv) => {
                        const svKind = sv.domains.length ? 'domains' : 'prefixes'
                        const m = meta[`${svKind}:${sv.name}`]
                        const from = sourceText(m)
                        const open = editing?.name === sv.name && editing?.kind === svKind
                        return (
                            <li key={sv.id} className="py-2">
                                <div className="flex min-h-[44px] items-center gap-2">
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium">{sv.name}</span>
                                        <span className="mt-0.5 block truncate text-xs text-subtle">
                                            {svKind === 'domains' ? S.customLists.domeny : S.customLists.podseti} {S.customLists.zapisey}{sv.count}
                                            {from ? ` · ${from}` : ''}
                                        </span>
                                    </span>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={busy}
                                        aria-label={S.customLists.izmenitSpisok(sv.name)}
                                        onClick={() =>
                                            setEditing(
                                                open
                                                    ? null
                                                    : m ?? {
                                                        name: sv.name,
                                                        kind: svKind,
                                                        source: '',
                                                        url: '',
                                                        filename: '',
                                                        bytes: 0,
                                                    },
                                            )
                                        }
                                    >
                                        {open
                                            ? <X className="h-4 w-4" aria-hidden="true" />
                                            : <Pencil className="h-4 w-4" aria-hidden="true" />}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={busy}
                                        aria-label={S.customLists.udalitSpisok(sv.name)}
                                        onClick={() => remove(sv.name, svKind)}
                                    >
                                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                                    </Button>
                                </div>
                                {open && editing && (
                                    <ListEditor
                                        list={editing}
                                        busy={busy}
                                        onFile={(f) => putFile({ name: editing.name, kind: editing.kind }, f)}
                                        onUrl={(u) =>
                                            put({ name: editing.name, kind: editing.kind }, { url: u }, 'url')}
                                        onText={(t) =>
                                            put({ name: editing.name, kind: editing.kind }, { text: t }, 'text')}
                                    />
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}

            <div className="space-y-3 border-t border-border pt-3">
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        value={name}
                        onChange={(e) => setName(e.currentTarget.value)}
                        placeholder={S.customLists.imyaSpiska}
                        aria-label={S.customLists.imyaSpiska2}
                        className="min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <select
                        value={kind}
                        onChange={(e) => setKind(e.currentTarget.value as 'domains' | 'prefixes')}
                        aria-label={S.customLists.vidSpiska}
                        className="rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                        <option value="domains">{S.customLists.domeny}</option>
                        <option value="prefixes">{S.customLists.podseti}</option>
                    </select>
                </div>
                {name && !nameOk && (
                    <p className="text-xs text-destructive">
                        {/* Ограничение отсюда: имя списка становится именем файла на роутере. */}
                        {S.customLists.tolkoLatinitsaTsifryDefis}</p>
                )}

                <div>
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.currentTarget.value)}
                        rows={4}
                        aria-label={S.customLists.zapisiSpiska}
                        placeholder={
                            kind === 'domains'
                                ? S.customLists.poOdnomuImeniNa
                                : S.customLists.poOdnoyPodsetiNa
                        }
                        className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button onClick={putText} disabled={busy || !nameOk || !text.trim()}>
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            {S.customLists.sohranit}</Button>
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".lst,.txt,text/plain"
                            aria-label={S.customLists.faylSoSpiskom}
                            disabled={busy || !nameOk}
                            onChange={(e) => {
                                const f = e.currentTarget.files?.[0]
                                if (f) void putFile({ name, kind }, f)
                            }}
                            className="text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm"
                        />
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <input
                        value={url}
                        onChange={(e) => setUrl(e.currentTarget.value)}
                        placeholder={S.customLists.httpsSkachaetRouter}
                        aria-label={S.customLists.ssylkaNaSpisok}
                        className="min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <Button variant="secondary" onClick={putUrl} disabled={busy || !nameOk || !url.trim()}>
                        {S.customLists.skachat}</Button>
                </div>
                {/* Сказать сразу: обновления по расписанию у своего списка нет. Ждать его
                    молча — то же самое, что показывать устаревшие данные как свежие. */}
                <p className="text-xs text-muted-foreground">
                    {S.customLists.skachivaetsyaOdinRazObnovlyat}</p>
            </div>
        </Block>
    )
}

/** Редактор одного своего списка: ровно тот способ, которым список завели.
 *
 *  ЧТО ЗДЕСЬ ГЛАВНОЕ. Запись списка ЗАМЕЩАЕТ его целиком, поэтому редактор записей обязан
 *  сначала показать то, что лежит на роутере: пустое поле, из которого человек нажмёт
 *  «Сохранить», — это молчаливая потеря всего набранного. Пока записи едут, поля нет вовсе, а
 *  не «есть и пустое».
 *
 *  Ссылку и файл это не касается: там замещение и есть смысл действия — «возьми вместо этого
 *  вот то». */
function ListEditor({
    list,
    busy,
    onFile,
    onUrl,
    onText,
}: {
    list: CustomMeta
    busy: boolean
    onFile: (f: File) => void | Promise<void>
    onUrl: (u: string) => void | Promise<void>
    onText: (t: string) => void | Promise<void>
}) {
    const [url, setUrl] = useState(list.url || '')
    const [text, setText] = useState<string | null>(null)
    const [loadErr, setLoadErr] = useState<string | null>(null)
    const fileRef = useRef<HTMLInputElement>(null)

    /* Записи нужны двум случаям: списку, набранному руками, и списку неизвестного
     * происхождения — там текстовый редактор один из трёх предложенных. Файлу и ссылке они не
     * нужны вовсе, и качать их туда значило бы возить мегабайт ради поля, которого не будет. */
    const wantsText = list.source === 'text' || list.source === ''
    const tooBig = list.bytes > TEXT_EDIT_MAX

    useEffect(() => {
        if (!wantsText || tooBig) return
        let stop = false
        void (async () => {
            try {
                /* Порциями до конца файла. Склейка простой конкатенацией: куски приходят байт
                 * в байт, границы не по строкам — иначе на границе пропадал бы перевод строки
                 * и две записи склеивались бы в одну, которую санитайзер отбросит молча. */
                let acc = ''
                let offset = 0
                for (let guard = 0; guard < 128; guard++) {
                    const r = await rpc.listGet(list.name, list.kind, offset)
                    if (stop) return
                    if (!r.ok) throw new Error(r.error || S.customLists.neProchitalos)
                    acc += r.text ?? ''
                    if (r.eof || typeof r.next !== 'number' || r.next <= offset) break
                    offset = r.next
                }
                if (!stop) setText(acc)
            } catch (e) {
                if (!stop) setLoadErr(String(e instanceof Error ? e.message : e))
            }
        })()
        return () => { stop = true }
    }, [list.name, list.kind, wantsText, tooBig])

    return (
        <div className="mt-2 space-y-3 rounded-md border border-border bg-background/50 p-3">
            {(list.source === 'file' || list.source === '') && (
                <div>
                    <label className="text-xs text-muted-foreground" htmlFor="sp-edit-file">
                        {list.filename
                            ? S.customLists.seychasIzFaylaVyberite(list.filename)
                            : S.customLists.vyberiteFaylOnZamenit}
                    </label>
                    <input
                        id="sp-edit-file"
                        ref={fileRef}
                        type="file"
                        accept=".lst,.txt,text/plain"
                        aria-label={S.customLists.drugoyFaylDlyaSpiska(list.name)}
                        disabled={busy}
                        onChange={(e) => {
                            const f = e.currentTarget.files?.[0]
                            if (f) void onFile(f)
                        }}
                        className="mt-1 block text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm"
                    />
                </div>
            )}

            {(list.source === 'url' || list.source === '') && (
                <div>
                    <label className="text-xs text-muted-foreground" htmlFor="sp-edit-url">
                        {S.customLists.ssylkaOtkudaRouterBeret}</label>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                        <input
                            id="sp-edit-url"
                            value={url}
                            onChange={(e) => setUrl(e.currentTarget.value)}
                            placeholder="https://…"
                            aria-label={S.customLists.ssylkaSpiska(list.name)}
                            className="min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                        <Button
                            variant="secondary"
                            disabled={busy || !/^https?:\/\//.test(url.trim())}
                            onClick={() => void onUrl(url.trim())}
                        >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            {S.customLists.skachatZanovo}</Button>
                    </div>
                </div>
            )}

            {wantsText && (
                <div>
                    {tooBig ? (
                        /* Сказать причину, а не спрятать поле молча: «редактора нет» человек
                         * читает как поломку, а «список слишком велик» — как то, что и есть. */
                        <p className="text-xs text-muted-foreground">
                            {S.customLists.spisokSlishkomVelikChtoby}{Math.round(list.bytes / 1024)} {S.customLists.kbZameniteEgoFaylom}</p>
                    ) : loadErr ? (
                        <p className="text-xs text-destructive">
                            {/* Поле правки прячется НАМЕРЕННО: сохранение заменяет список целиком,
                              * и если записи не прочитались, то сохранение из пустого поля стёрло
                              * бы то, чего мы не увидели. Человеку эта арифметика не нужна — ему
                              * нужно знать, что правка текстом сейчас недоступна, и чем её
                              * заменить. */}
                            {S.customLists.zapisiNeProchitalis}{loadErr}{S.customLists.pravitTekstomSeychasNelzya}</p>
                    ) : text === null ? (
                        <p className="text-xs text-muted-foreground">{S.customLists.chitaemZapisi}</p>
                    ) : (
                        <>
                            <label className="text-xs text-muted-foreground" htmlFor="sp-edit-text">
                                {S.customLists.zapisiSpiskaSohranenieZamenyaet}</label>
                            <textarea
                                id="sp-edit-text"
                                value={text}
                                onChange={(e) => setText(e.currentTarget.value)}
                                rows={8}
                                aria-label={S.customLists.zapisiSpiska2(list.name)}
                                className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            />
                            <div className="mt-2">
                                <Button
                                    disabled={busy || !text.trim()}
                                    onClick={() => void onText(text)}
                                >
                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                    {S.customLists.sohranitZapisi}</Button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}

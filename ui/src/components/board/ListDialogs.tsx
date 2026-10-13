import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/layout'
import { inputCls } from '@/components/formbits'
import { rpc } from '@/lib/rpc'
import { notify } from '@/lib/notify'
import { type ServiceEntry } from '@/lib/model'
import { pathFor, srsPathFor } from '@/lib/rulefiles'
import { isSrs, putListFile, putListText, putListUrl, readList, type ListKind, type PutResult } from '@/lib/customlist'
import { S } from '@/copy'

/** Окна списков в правиле (приложение для ПК): посмотреть содержимое любого списка и завести или
 *  поправить свой (текстом, файлом .lst/.txt/.srs или по ссылке). */

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
    useEffect(() => {
        const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', on)
        return () => window.removeEventListener('keydown', on)
    }, [onClose])
    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
            <div
                role="dialog"
                aria-label={title}
                onClick={(e) => e.stopPropagation()}
                className={`an-glass an-glass-float flex max-h-[85vh] w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} flex-col gap-3 rounded-2xl border p-5`}
            >
                <div className="flex items-center gap-2">
                    <h3 className="sp-sub min-w-0 flex-1 truncate">{title}</h3>
                    <button type="button" onClick={onClose} aria-label={S.listDialogs.zakryt}
                        className="flex h-7 w-7 items-center justify-center rounded-md bg-transparent p-0 text-muted-foreground hover:text-foreground">
                        <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                </div>
                {children}
            </div>
        </div>
    )
}

/** Части сервиса — файлами на роутере: подсети и домены; набор каталога, взятый файлом, — им. */
function partsOf(sv: ServiceEntry): { key: string; label: string; path: string }[] {
    const out = sv.parts.map((p) => ({
        key: p.file,
        label: p.kind === 'domains' ? S.ruleEditor.domeny : S.ruleEditor.adresa,
        path: pathFor(p.file),
    }))
    if (sv.srs) {
        const f = sv.prefixes[0] ?? sv.domains[0]
        if (f) out.push({ key: 'srs', label: S.listDialogs.nabor, path: srsPathFor(f) })
    }
    return out
}

/** Содержимое списка: записи с роутера (до 300 за раз) и поиск по ним. */
export function ListViewer({ sv, onClose }: { sv: ServiceEntry; onClose: () => void }) {
    const parts = partsOf(sv)
    const [at, setAt] = useState(parts[0]?.key ?? '')
    const [q, setQ] = useState('')
    const [res, setRes] = useState<{ busy: boolean; total?: number; found?: number; text?: string; error?: string }>({ busy: true })
    const part = parts.find((p) => p.key === at) ?? parts[0]
    useEffect(() => {
        if (!part) return
        let stop = false
        setRes((r) => ({ ...r, busy: true }))
        const t = setTimeout(() => {
            rpc.listPeek(part.path, q.trim())
                .then((r) => { if (!stop) setRes(r.ok ? { busy: false, total: r.total, found: r.found, text: r.text } : { busy: false, error: r.error }) })
                .catch((e) => { if (!stop) setRes({ busy: false, error: String(e instanceof Error ? e.message : e) }) })
        }, q ? 300 : 0)
        return () => { stop = true; clearTimeout(t) }
    }, [part?.path, q])
    const lines = (res.text ?? '').split('\n').filter(Boolean)
    return (
        <Modal title={sv.name} onClose={onClose} wide>
            {parts.length > 1 && (
                <Segmented label={sv.name} value={part?.key ?? ''} onChange={setAt} items={parts.map((p) => ({ value: p.key, label: p.label }))} />
            )}
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder={S.listDialogs.poisk}
                    className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none" autoFocus />
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {res.total === undefined ? '' : q.trim() ? S.listDialogs.naydeno(res.found ?? 0, res.total) : S.listDialogs.zapisey(res.total)}
                </span>
            </div>
            {res.error && <p className="text-sm text-muted-foreground">{res.error}</p>}
            {!res.error && (
                <pre className="sp-selectable min-h-[160px] flex-1 overflow-auto rounded-xl border border-border bg-muted/60 p-3 font-mono text-xs leading-relaxed">
                    {res.busy && !lines.length ? '…' : lines.join('\n')}
                </pre>
            )}
            {!res.error && (res.found ?? 0) > lines.length && (
                <p className="text-xs text-muted-foreground">{S.listDialogs.pokazanyPervye(lines.length)}</p>
            )}
        </Modal>
    )
}

type Source = 'text' | 'file' | 'url'

/** Свой список: новый (имя, вид, откуда) или правка прежнего (имя и вид не меняются). `onSaved` —
 *  какие виды записаны: у набора .srs их бывает два. */
export function OwnListDialog({ edit, onClose, onSaved }: {
    edit?: { name: string; kind: ListKind }
    onClose: () => void
    onSaved: (name: string, kinds: ListKind[]) => void
}) {
    const [name, setName] = useState(edit?.name ?? '')
    const [kind, setKind] = useState<ListKind>(edit?.kind ?? 'domains')
    const [source, setSource] = useState<Source>('text')
    const [text, setText] = useState('')
    const [url, setUrl] = useState('')
    const [file, setFile] = useState<File | null>(null)
    const [busy, setBusy] = useState(false)
    const fileRef = useRef<HTMLInputElement>(null)

    /* Правка: записи прежнего списка — в поле (набранный руками правится там же). */
    useEffect(() => {
        if (!edit) return
        let stop = false
        setBusy(true)
        readList(edit.name, edit.kind).then((t) => { if (!stop) setText(t) }).catch(() => undefined).finally(() => { if (!stop) setBusy(false) })
        return () => { stop = true }
    }, [edit?.name, edit?.kind])

    const srs = (source === 'file' && !!file && isSrs(file.name)) || (source === 'url' && isSrs(url))
    const nameOk = /^[A-Za-z0-9_-]{1,64}$/.test(name)

    async function save() {
        if (!nameOk) { notify(S.customLists.imyaSpiskaLatinitsaTsifry, 'warning'); return }
        setBusy(true)
        try {
            let r: PutResult
            if (source === 'text') {
                if (!text.trim()) { notify(S.customLists.spisokPust, 'warning'); return }
                r = await putListText(name, kind, text)
            } else if (source === 'file') {
                if (!file) { notify(S.listDialogs.vyberiteFayl, 'warning'); return }
                r = await putListFile(name, kind, file)
            } else {
                if (!/^https?:\/\//.test(url.trim())) { notify(S.customLists.ssylkaDolzhnaNachinatsyaS, 'warning'); return }
                r = await putListUrl(name, kind, url.trim())
            }
            const kinds: ListKind[] = r.domains !== undefined || r.prefixes !== undefined
                ? [...((r.domains ?? 0) > 0 ? ['domains' as const] : []), ...((r.prefixes ?? 0) > 0 ? ['prefixes' as const] : [])]
                : [kind]
            notify(r.dropped ? S.customLists.spisokStrokOtbroshenoFormat(name, r.count, r.dropped) : S.customLists.spisokStrok(name, r.count), r.dropped ? 'warning' : 'info')
            onSaved(name, kinds)
            onClose()
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Modal title={edit ? S.listDialogs.pravkaSpiska(edit.name) : S.listDialogs.svoySpisok} onClose={onClose}>
            {!edit && (
                <input className={inputCls + ' w-full font-mono'} value={name} onChange={(e) => setName(e.currentTarget.value)}
                    placeholder={S.listDialogs.imyaLatinitsey} spellCheck={false} autoFocus />
            )}
            <Segmented label={S.listDialogs.otkuda} value={source} onChange={setSource} items={[
                { value: 'text', label: S.listDialogs.tekst },
                { value: 'file', label: S.listDialogs.fayl },
                { value: 'url', label: S.listDialogs.ssylka },
            ]} />
            {!edit && !srs && (
                <Segmented label={S.listDialogs.vid} value={kind} onChange={setKind} items={[
                    { value: 'domains', label: S.ruleEditor.domeny },
                    { value: 'prefixes', label: S.ruleEditor.adresa },
                ]} />
            )}
            {source === 'text' && (
                <textarea className={inputCls + ' h-48 w-full resize-y py-2 font-mono text-xs'} value={text}
                    onChange={(e) => setText(e.currentTarget.value)} spellCheck={false}
                    placeholder={kind === 'domains' ? 'example.org\nvideo.example.net' : '10.0.0.0/8\n203.0.113.7'} />
            )}
            {source === 'file' && (
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>{S.listDialogs.vybratFayl}</Button>
                    <span className="min-w-0 truncate text-sm text-muted-foreground">{file?.name ?? S.listDialogs.lstTxtSrs}</span>
                    <input ref={fileRef} type="file" accept=".lst,.txt,.srs" className="hidden"
                        onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)} />
                </div>
            )}
            {source === 'url' && (
                <input className={inputCls + ' w-full font-mono text-xs'} value={url} onChange={(e) => setUrl(e.currentTarget.value)}
                    placeholder={S.listDialogs.ssylkaPlaceholder} spellCheck={false} />
            )}
            {srs && <p className="text-xs text-muted-foreground">{S.listDialogs.naborSrs}</p>}
            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose} disabled={busy}>{S.subsBoard.otmena}</Button>
                <Button onClick={() => void save()} disabled={busy || (!edit && !nameOk)}>
                    {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                    {S.ruleEditor.sohranit}
                </Button>
            </div>
        </Modal>
    )
}

import { useCallback, useEffect, useState } from 'react'
import { Link2, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm'
import { inputCls } from '@/components/formbits'
import { rpc } from '@/lib/rpc'
import { notify } from '@/lib/notify'
import { subsRemember, subsRemembered } from '@/lib/subs'
import { isSubSource } from '@/lib/validate'
import { S } from '@/copy'

/** Вкладка VPN приложения для компьютера — только ссылки подписок: добавить, обновить, удалить
 *  (владелец: «во вкладке VPN мы просто добавляем ссылки, не более»). Какие конфигурации брать и
 *  как между ними выбирать — в правиле, в блоке «Куда». Под LuCI этой вкладки нет. */

type Sub = Awaited<ReturnType<typeof rpc.subList>>['subs'][number]

export default function SubsBoard() {
    const [subs, setSubs] = useState<Sub[] | null>(() => (subsRemembered() as Sub[] | null))
    const [adding, setAdding] = useState(false)

    const load = useCallback(async () => {
        try {
            const r = await rpc.subList()
            setSubs(r.subs || [])
            subsRemember(r.subs)
        } catch {
            setSubs([])
        }
    }, [])
    useEffect(() => { void load() }, [load])

    return (
        <section className="sp-board-group an-glass space-y-3 rounded-2xl border p-3">
            <h2 className="sp-sub flex items-center gap-2 px-1 pt-1">
                {S.subsBoard.podpiski}
                {(subs?.length ?? 0) > 0 && (
                    <span className="rounded-full bg-primary/15 px-2 text-xs font-semibold text-primary">{subs!.length}</span>
                )}
            </h2>
            {subs === null && <p className="px-1 text-sm text-muted-foreground">{S.vlessScreen.zagruzka}</p>}
            {subs?.map((s) => <SubRow key={s.name} sub={s} onChanged={load} />)}
            {adding
                ? <AddCard existing={subs || []} onDone={() => { setAdding(false); void load() }} onCancel={() => setAdding(false)} />
                : (
                    <button
                        type="button"
                        onClick={() => setAdding(true)}
                        style={{ borderColor: 'color-mix(in srgb, var(--sp-muted-foreground) 45%, transparent)' }}
                        className="flex h-[64px] w-full items-center justify-center gap-2 rounded-2xl border border-dashed bg-transparent text-sm text-muted-foreground transition-colors duration-200 hover:border-primary/50 hover:text-primary"
                    >
                        <Plus className="h-4 w-4" aria-hidden="true" /> {S.vlessScreen.dobavitPodpisku}
                    </button>
                )}
        </section>
    )
}

/** Где лежит подписка: адрес панели без пути и ключа — ключ в ссылке не показываем. */
function sourceOf(sub: Sub): string {
    if (sub.kind === 'links') return S.vlessScreen.ssylkiVless
    if (!sub.url) return ''
    try { return new URL(sub.url).host } catch { return '' }
}

function SubRow({ sub, onChanged }: { sub: Sub; onChanged: () => void }) {
    const [busy, setBusy] = useState('')
    const [ask, dialog] = useConfirm()

    async function refresh() {
        if (!sub.url) return
        setBusy('refresh')
        try {
            const r = await rpc.subSet(sub.url, sub.name, sub.title || '')
            if (!r.ok) notify(r.error || S.vlessScreen.podpiskaNeSkachalas, 'error')
            else if (r.warn) notify(r.warn, 'warning')
            onChanged()
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy('')
        }
    }

    async function remove() {
        const ok = await ask({ title: S.subsBoard.udalitPodpisku(sub.title || sub.name), body: S.subsBoard.udalitPodpiskuTelo, confirmLabel: S.vlessScreen.udalit2 })
        if (!ok) return
        setBusy('del')
        try {
            const r = await rpc.subDel(sub.name)
            if (!r.ok) notify(r.error || S.vlessScreen.podpiskaNeUdalilas, 'error')
            onChanged()
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy('')
        }
    }

    return (
        <div className="sp-board-tile an-glass flex items-center gap-3 rounded-2xl border px-4 py-3">
            <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{sub.title || sub.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                    {[sourceOf(sub), sub.present ? '' : S.vlessScreen.neSkachana].filter(Boolean).join(' · ')}
                </div>
            </div>
            {sub.url && (
                <Button variant="outline" size="sm" onClick={refresh} disabled={!!busy}>
                    {busy === 'refresh' ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                    {S.vlessScreen.obnovit}
                </Button>
            )}
            <Button
                variant="ghost"
                size="sm"
                onClick={remove}
                disabled={!!busy || !!sub.used}
                title={sub.used ? S.subsBoard.snachalaUberiteIzPravil : undefined}
                className="text-destructive"
            >
                <Trash2 aria-hidden="true" /> {S.vlessScreen.udalit2}
            </Button>
            {dialog}
        </div>
    )
}

function AddCard({ existing, onDone, onCancel }: { existing: Sub[]; onDone: () => void; onCancel: () => void }) {
    const [src, setSrc] = useState('')
    const [title, setTitle] = useState('')
    const [busy, setBusy] = useState(false)

    async function add() {
        const v = src.trim()
        if (!v || !isSubSource(v)) { notify(S.vlessScreen.nuzhnaSsylkaPodpiskiHttp, 'warning'); return }
        const taken = new Set(existing.map((x) => x.name))
        let i = existing.length + 1
        while (taken.has(`sub${i}`)) i++
        setBusy(true)
        try {
            const r = await rpc.subSet(v, `sub${i}`, title.trim())
            if (!r.ok) { notify(r.error || S.vlessScreen.podpiskaNeSohranilas, 'error'); return }
            if (r.warn) notify(r.warn, 'warning')
            else if (r.usable === 0) notify(S.vlessScreen.podpiskaSkachalasNoPrigodnyh, 'warning')
            onDone()
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="sp-board-tile an-glass space-y-3 rounded-2xl border p-4">
            <label className="block space-y-1">
                <span className="block text-sm text-subtle">{S.vlessScreen.ssylkaLabel}</span>
                <textarea
                    className={inputCls + ' h-20 w-full resize-y py-2 font-mono text-xs'}
                    value={src}
                    onChange={(e) => setSrc(e.currentTarget.value)}
                    placeholder={S.subsBoard.ssylkaPlaceholder}
                    spellCheck={false}
                    autoFocus
                />
            </label>
            <label className="block space-y-1">
                <span className="block text-sm text-subtle">{S.vlessScreen.imyaLabel}</span>
                <input
                    className={inputCls + ' w-full'}
                    value={title}
                    onChange={(e) => setTitle(e.currentTarget.value)}
                    placeholder={S.vlessScreen.imyaNeobyazatelno}
                />
            </label>
            <div className="flex gap-2">
                <Button onClick={add} disabled={busy || !src.trim()}>
                    {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                    {busy ? S.vlessScreen.dobavlyaem : S.vlessScreen.dobavit}
                </Button>
                <Button variant="ghost" onClick={onCancel} disabled={busy}>{S.subsBoard.otmena}</Button>
            </div>
        </div>
    )
}

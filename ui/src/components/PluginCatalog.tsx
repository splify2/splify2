import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { Block, CardHead } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useConfirm } from '@/components/ui/confirm'
import { Field, inputCls } from '@/components/formbits'
import { rpc } from '@/lib/rpc'
import { notify } from '@/lib/notify'
import { pluginActions, act } from '@/plugins/store'
import { normalizeCatalog, normalizeRepos } from '@/plugins/normalize'
import type { CatalogEntry, RepoEntry } from '@/plugins/api'
import { RepoBadge, TRUST_TEXT } from '@/components/PluginCard'
import { S } from '@/copy'

/** Верх вкладки «Плагины»: каталог подключённых репозиториев (поиск и «Установить») и сами
 *  репозитории (список, добавление по адресу и ключу, «Убрать»). Сторонний помечен словами
 *  «не официальный, splify2 за него не отвечает» (решение В6). Установка — задание: ход
 *  показывается на кнопке, отказ — числами бэкенда (место, совместимость). */
export default function PluginCatalog({ onChanged }: { onChanged?: () => void }) {
    const [q, setQ] = useState('')
    const [found, setFound] = useState<CatalogEntry[] | null>(null)
    const [failed, setFailed] = useState(false)
    const [repos, setRepos] = useState<RepoEntry[]>([])
    const [installing, setInstalling] = useState<{ id: string; step: string } | null>(null)
    const [url, setUrl] = useState('')
    const [key, setKey] = useState('')
    const [adding, setAdding] = useState(false)
    /** Номер ключа, посчитанный бэкендом по тому, что вставлено: человек видит его до добавления. */
    const [keyId, setKeyId] = useState<string | null>(null)
    const [keyBad, setKeyBad] = useState(false)
    const [ask, dialog] = useConfirm()
    const seq = useRef(0)

    const search = useCallback((text: string) => {
        const n = ++seq.current
        Promise.all([rpc.pluginsSearch(text || undefined), rpc.reposList().catch(() => ({ repos: [] }))])
            .then(([r, rp]) => {
                if (n === seq.current) { setFound(normalizeCatalog(r.plugins, normalizeRepos(rp.repos))); setFailed(false) }
            })
            .catch(() => { if (n === seq.current) setFailed(true) })
    }, [])
    const loadRepos = useCallback(() => {
        rpc.reposList().then((r) => setRepos(normalizeRepos(r.repos))).catch(() => setRepos([]))
    }, [])

    useEffect(() => { loadRepos() }, [loadRepos])
    useEffect(() => {
        setKeyId(null)
        setKeyBad(false)
        const text = key.trim()
        if (!text) return
        let stop = false
        const t = setTimeout(() => {
            rpc.repoKey(text)
                .then((r) => { if (!stop) { if (r.ok === false || !r.key_id) setKeyBad(true); else setKeyId(r.key_id) } })
                .catch(() => { if (!stop) setKeyBad(true) })
        }, 400)
        return () => { stop = true; clearTimeout(t) }
    }, [key])
    useEffect(() => {
        const t = setTimeout(() => search(q), q ? 300 : 0)
        return () => clearTimeout(t)
    }, [q, search])

    async function install(p: CatalogEntry) {
        setInstalling({ id: p.id, step: '' })
        try {
            await pluginActions.install(p.id, p.version || undefined, (step) => setInstalling({ id: p.id, step }))
            notify(S.plugins.postavlen(p.name))
            search(q)
            onChanged?.()
        } catch (e) {
            notify(e instanceof Error ? e.message : String(e), 'error')
        } finally {
            setInstalling(null)
        }
    }

    async function addRepo() {
        setAdding(true)
        try {
            await act(() => rpc.repoAdd(url.trim(), key.trim(), keyId ?? undefined))
            setUrl('')
            setKey('')
            setKeyId(null)
            loadRepos()
            search(q)
        } catch (e) {
            notify(e instanceof Error ? e.message : String(e), 'error')
        } finally {
            setAdding(false)
        }
    }

    async function delRepo(r: RepoEntry) {
        const ok = await ask({ title: S.plugins.ubratRepozitoriy(r.name), body: S.plugins.ubratRepozitoriyPodpis, confirmLabel: S.plugins.ubrat })
        if (!ok) return
        try {
            await act(() => rpc.repoDel(r.name))
            loadRepos()
            search(q)
        } catch (e) {
            notify(e instanceof Error ? e.message : String(e), 'error')
        }
    }

    return (
        <div className="space-y-3">
            <Block>
                <CardHead title={S.plugins.katalog} />
                <input
                    type="search"
                    aria-label={S.plugins.poiskPlaginov}
                    placeholder={S.plugins.poiskPlaginov}
                    value={q}
                    onChange={(e) => setQ(e.currentTarget.value)}
                    className={`${inputCls} w-full`}
                />
                {failed && <p className="text-sm text-muted-foreground">{S.plugins.katalogNedostupen}</p>}
                {!failed && found && found.length === 0 && (
                    <p className="text-sm text-muted-foreground">{q ? S.plugins.nichegoNeNaydeno : S.plugins.katalogPust}</p>
                )}
                <ul className="divide-y divide-border">
                    {(found ?? []).map((p) => (
                        <li key={`${p.repo}/${p.id}`} className="flex flex-wrap items-start gap-3 py-2.5">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-sm font-medium">{p.name}</span>
                                    <Badge variant="proto">{p.version}</Badge>
                                    <RepoBadge trust={p.trust} repo={p.repo} />
                                </div>
                                {p.description && <div className="mt-0.5 text-xs text-muted-foreground">{p.description}</div>}
                                {(p.kinds?.length || p.permissions?.length) ? (
                                    <div className="mt-0.5 text-xs text-muted-foreground">
                                        {S.plugins.dobavit(
                                            [...(p.kinds ?? []), ...(p.permissions ?? [])].join(', '),
                                        )}
                                    </div>
                                ) : null}
                                {p.trust !== 'official' && <div className="mt-0.5 text-xs text-warning-fg">{TRUST_TEXT[p.trust]}</div>}
                            </div>
                            {p.installed ? (
                                <span className="text-xs text-muted-foreground">{S.plugins.ustanovlen}</span>
                            ) : (
                                <Button size="sm" disabled={!!installing} onClick={() => install(p)}>
                                    {installing?.id === p.id && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {installing?.id === p.id && installing.step ? installing.step : S.plugins.ustanovit}
                                </Button>
                            )}
                        </li>
                    ))}
                </ul>
            </Block>

            <Block>
                <CardHead title={S.plugins.repozitorii} />
                <ul className="divide-y divide-border">
                    {repos.map((r) => (
                        <li key={r.name} className="flex items-start gap-3 py-2">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-sm font-medium">{r.name}</span>
                                    {r.official ? <Badge variant="secondary">{S.plugins.oficialnyy}</Badge> : <Badge variant="warn">{S.plugins.storonniyKratko}</Badge>}
                                </div>
                                <div className="truncate text-xs text-muted-foreground" title={r.url}>{r.url}</div>
                                {r.key_id && <div className="text-xs text-muted-foreground">{S.plugins.nomerKlyucha(r.key_id)}</div>}
                                {!r.official && <div className="text-xs text-warning-fg">{S.plugins.storonniy}</div>}
                            </div>
                            {!r.official && (
                                <button
                                    type="button"
                                    onClick={() => delRepo(r)}
                                    aria-label={S.plugins.ubratRepozitoriy(r.name)}
                                    title={S.plugins.ubratRepozitoriy(r.name)}
                                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center bg-transparent p-0 text-muted-foreground transition-colors hover:text-destructive"
                                >
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
                <div className="grid gap-2 sm:grid-cols-2">
                    <Field label={S.plugins.adresRepozitoriya}>
                        <input className={`${inputCls} w-full`} value={url} onChange={(e) => setUrl(e.currentTarget.value)} placeholder="https://…" />
                    </Field>
                    <Field label={S.plugins.klyuchRepozitoriya}>
                        {/* Ключ — файл .pub целиком (две строки), поэтому поле многострочное. */}
                        <textarea
                            rows={3}
                            className="min-w-0 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            value={key}
                            onChange={(e) => setKey(e.currentTarget.value)}
                        />
                    </Field>
                </div>
                {keyId && <p className="text-xs text-muted-foreground">{S.plugins.nomerKlyucha(keyId)}</p>}
                {keyBad && <p className="text-xs text-destructive">{S.plugins.klyuchNeRaspoznan}</p>}
                <p className="text-xs text-muted-foreground">{S.plugins.storonniyPodpis}</p>
                <Button size="sm" disabled={adding || !url.trim() || !keyId} onClick={addRepo}>
                    {adding && <Loader2 className="h-4 w-4 animate-spin" />}
                    {S.plugins.dobavitRepozitoriy}
                </Button>
            </Block>
            {dialog}
        </div>
    )
}

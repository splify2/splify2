import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Block, CardHead } from '@/components/ui/layout'
import { inputCls } from '@/components/formbits'
import { notify } from '@/lib/notify'
import { pending, usePending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { useCatalog, useLocalLists } from '@/lib/catalog'
import { makeSubOutput } from '@/lib/suboutput'
import { isSubSource } from '@/lib/validate'
import { quickOutput, tileEntries, tileRule, TILES } from '@/lib/quickstart'

import { S } from '@/copy'
/** Быстрый старт на пустой главной (D-P3.1): человек со стороны приходит от установки к сайту через
 *  туннель за три действия на одном экране — вставил ссылку подписки, отметил, что пустить, нажал
 *  «Включить». Выход на узлах подписки создаётся сам, правила пишутся обычной правкой, применяет их
 *  автоприменение.
 *
 *  Показывается, пока в спеке нет ни одного правила. Выход уже есть (подписку добавили раньше) — сразу
 *  второй шаг. «Не сейчас» запоминается в памяти интерфейса на роутере (`ui_set`, поле `quick`):
 *  роутер, который нарочно без правил, не должен видеть карточку вечно. */

const KEY = 'quick'

async function dismissed(): Promise<boolean> {
    try {
        const r = await rpc.uiGet()
        return !!(r.state && (JSON.parse(r.state) as Record<string, unknown>)[KEY])
    } catch {
        return false
    }
}

async function dismiss() {
    let st: Record<string, unknown> = {}
    try { st = JSON.parse((await rpc.uiGet()).state || '{}') } catch { /* пусто */ }
    await rpc.uiSet(JSON.stringify({ ...st, [KEY]: 1 })).catch(() => undefined)
}

export default function QuickStart() {
    const { spec } = usePending()
    const catalog = useCatalog() ?? []
    const local = useLocalLists() ?? {}
    const [hidden, setHidden] = useState<boolean | null>(null)
    const [url, setUrl] = useState('')
    const [busy, setBusy] = useState(false)
    const [picked, setPicked] = useState<string[]>([])
    useEffect(() => { void dismissed().then(setHidden) }, [])

    if (!spec || hidden !== false || spec.channels.length > 0) return null
    const out = quickOutput(spec)
    const tiles = TILES.filter((t) => t.all || tileEntries(t, catalog).length > 0)

    async function connect() {
        const src = url.trim()
        if (!src || !isSubSource(src)) { notify(S.vlessScreen.nuzhnaSsylkaPodpiskiHttp, 'warning'); return }
        setBusy(true)
        /* Подписка и выход на её узлах — одной пачкой: применение дождётся обоих. */
        const release = pending.hold()
        try {
            const list = await rpc.subList().catch(() => ({ subs: [] as { name: string; path: string }[] }))
            const taken = new Set(list.subs.map((x) => x.name))
            let name = 'sub1'
            for (let k = 2; taken.has(name); k++) name = `sub${k}`
            const r = await rpc.subSet(src, name, '')
            if (!r.ok) { notify(r.error || S.vlessScreen.podpiskaNeSohranilas, 'error'); return }
            if (r.warn) notify(r.warn, 'warning')
            else if (r.usable === 0) notify(S.vlessScreen.podpiskaSkachalasNoPrigodnyh, 'warning')
            const path = (await rpc.subList().catch(() => null))?.subs.find((x) => x.name === name)?.path
            if (r.usable === 0 || r.warn || !path || !(await makeSubOutput({ name, path }))) {
                if (!r.warn && r.usable !== 0) notify(S.quick.netVyhoda, 'warning')
                return
            }
            setUrl('')
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            release()
            setBusy(false)
        }
    }

    async function enable() {
        const cur = pending.saved
        const to = cur && quickOutput(cur)
        if (!cur || !to || !picked.length) return
        setBusy(true)
        try {
            /* «Весь трафик» — один на всё: остальное при нём лишнее. */
            const chosen = TILES.filter((t) => picked.includes(t.id))
            const wholly = chosen.find((t) => t.all)
            const used = new Set(cur.channels.map((c) => c.name))
            const rules = []
            for (const t of wholly ? [wholly] : chosen)
                rules.push(await tileRule(t, S.quick[t.id as 'youtube'], tileEntries(t, catalog), to, local, used))
            /* Спека читается после ожидания: пока качались наборы, человек мог её править. */
            const now = pending.saved ?? cur
            pending.edit({ ...now, channels: [...now.channels, ...rules] })
            notify(S.quick.gotovo(rules.map((r) => r.name).join(', '), to), 'info')
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy(false)
        }
    }

    const toggle = (id: string) => setPicked((p) => {
        if (p.includes(id)) return p.filter((x) => x !== id)
        return id === 'all' ? ['all'] : [...p.filter((x) => x !== 'all'), id]
    })

    return (
        <Block>
            <CardHead title={S.quick.zagolovok}
                      action={<Button variant="ghost" size="sm" onClick={() => { setHidden(true); void dismiss() }}>{S.quick.neSeychas}</Button>} />
            {!out ? (
                <>
                    <p className="text-sm">{S.quick.shag1}</p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <input value={url} onChange={(e) => setUrl(e.currentTarget.value)} aria-label={S.quick.ssylka}
                               placeholder="https://" disabled={busy} className={`${inputCls} min-w-0 flex-1 font-mono`}
                               onKeyDown={(e) => { if (e.key === 'Enter') void connect() }} />
                        <Button onClick={() => void connect()} disabled={busy || !url.trim()}>
                            {busy ? S.quick.podklyuchayu : S.quick.podklyuchit}</Button>
                    </div>
                </>
            ) : (
                <>
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Check className="h-4 w-4 text-success" aria-hidden="true" /> {S.quick.vyhod(out)}</p>
                    <p className="text-sm">{S.quick.shag2}</p>
                    <div className="flex flex-wrap gap-2">
                        {tiles.map((t) => (
                            <button key={t.id} type="button" aria-pressed={picked.includes(t.id)} onClick={() => toggle(t.id)}
                                    className={`rounded-xl border px-4 py-2.5 text-sm transition-colors ${picked.includes(t.id) ? 'border-primary bg-primary/15 font-semibold text-primary' : 'border-border bg-card hover:bg-accent'}`}>
                                {S.quick[t.id as 'youtube']}
                            </button>
                        ))}
                    </div>
                    <Button onClick={() => void enable()} disabled={busy || !picked.length} className="w-full sm:w-auto">
                        {S.quick.vklyuchit}</Button>
                </>
            )}
        </Block>
    )
}

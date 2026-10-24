import { useEffect, useRef, useState } from 'react'
import { Gauge, LoaderCircle, Plug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { rpc } from '@/lib/rpc'
import { usePending } from '@/lib/pending'
import { hasSubOutput, makeSubOutput } from '@/lib/suboutput'
import { checkSubAll, loadSubNodes, type SubCheck } from '@/lib/subnodes'

import { S } from '@/copy'
/** Что можно сделать с подпиской, не уходя с её карточки: назвать по-своему, проверить все серверы
 *  одной кнопкой, сделать выходом.
 *
 *  Всё, что ходит в сеть роутера, — ТОЛЬКО по нажатию: карточек несколько, и проверка на каждой
 *  при открытии экрана подняла бы десятки соединений через движок. */

export interface ToolSub {
    name: string
    title?: string
    path: string
    present: boolean
}

export default function SubTools({ sub, onRenamed }: { sub: ToolSub; onRenamed: () => void }) {
    const { spec } = usePending()
    const [title, setTitle] = useState(sub.title || '')
    const [saving, setSaving] = useState(false)
    const [check, setCheck] = useState<SubCheck | null>(null)
    const [running, setRunning] = useState(false)
    const [making, setMaking] = useState(false)
    /** Номер проверки: отмена и уход с экрана сдвигают его, и поздние ответы выбрасываются. */
    const run = useRef(0)
    useEffect(() => () => { run.current += 1 }, [])
    /* Название пришло с роутера заново (после «Обновить», переименования) — поле берёт его. Только
     * когда оно ИЗМЕНИЛОСЬ: на первом показе поле уже равно ему, а запоздалая подмена стирала бы
     * то, что человек успел набрать. */
    const seen = useRef(sub.title || '')
    useEffect(() => {
        if ((sub.title || '') === seen.current) return
        seen.current = sub.title || ''
        setTitle(seen.current)
    }, [sub.title])

    const dirty = title.trim() !== (sub.title || '')

    async function rename() {
        setSaving(true)
        try {
            const r = await rpc.subRename(sub.name, title.trim())
            if (!r.ok) { notify(r.error || S.vlessScreen.nazvanieNeSohraneno, 'error'); return }
            onRenamed()
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setSaving(false)
        }
    }

    async function checkAll() {
        if (running) { run.current += 1; setRunning(false); return }
        const token = ++run.current
        const alive = () => run.current === token
        setRunning(true)
        setCheck(null)
        try {
            const nodes = await loadSubNodes(sub.path)
            if (!alive()) return
            if (!nodes.length) { notify(S.vlessScreen.proverkaUzlovNet, 'warning'); return }
            setCheck({ total: nodes.length, done: 0, ok: 0 })
            const res = await checkSubAll(sub.path, nodes, () => !alive(), (c) => { if (alive()) setCheck(c) })
            if (alive()) setCheck(res)
        } catch (e) {
            if (alive()) notify(String(e instanceof Error ? e.message : e) || S.vlessScreen.proverkaNeVyshla, 'error')
        } finally {
            if (alive()) setRunning(false)
        }
    }

    async function makeOutput() {
        setMaking(true)
        try {
            const n = await makeSubOutput(sub)
            if (!n) notify(S.vlessScreen.vyhodNeSozdan, 'error')
        } finally {
            setMaking(false)
        }
    }

    const left = check ? check.total - check.done : 0
    const haveOut = hasSubOutput(spec, sub.path)

    return (
        <div className="space-y-2 border-t border-border pt-2">
            <label className="block space-y-1">
                <span className="block text-sm text-subtle">{S.vlessScreen.nazvanie}</span>
                <span className="flex gap-2">
                    <input
                        value={title}
                        onChange={(e) => setTitle(e.currentTarget.value)}
                        onKeyDown={(e) => e.key === 'Enter' && dirty && void rename()}
                        placeholder={sub.name}
                        maxLength={100}
                        aria-label={`${S.vlessScreen.nazvanie} ${sub.name}`}
                        className="h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm"
                    />
                    <Button variant="outline" className="h-10 shrink-0" disabled={!dirty || saving} onClick={() => void rename()}>
                        {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        {S.vlessScreen.sohranitNazvanie}
                    </Button>
                </span>
                <span className="block text-xs text-muted-foreground">{S.vlessScreen.nazvanieHint}</span>
            </label>

            {sub.present && (
                <div className="grid gap-2 sm:grid-cols-2">
                    <Button variant="outline" className="h-10 w-full" onClick={() => void checkAll()}>
                        {running
                            ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                            : <Gauge className="h-4 w-4" aria-hidden="true" />}
                        {running ? S.vlessScreen.proverkaOstanovit(left) : S.vlessScreen.proveritVse}
                    </Button>
                    {spec && !haveOut && (
                        <Button
                            className="h-10 w-full"
                            disabled={making}
                            onClick={() => void makeOutput()}
                            title={S.vlessScreen.sdelatVyhodomPodskazka}
                        >
                            {making
                                ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                                : <Plug className="h-4 w-4" aria-hidden="true" />}
                            {S.vlessScreen.sdelatVyhodom}
                        </Button>
                    )}
                    {spec && haveOut && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Plug className="h-4 w-4" aria-hidden="true" /> {S.vlessScreen.vyhodNaPodpiske}
                        </div>
                    )}
                </div>
            )}

            {check && (
                <p role="status" className="text-xs text-muted-foreground">
                    {running
                        ? S.vlessScreen.proverkaIdet(check.done, check.total)
                        : check.ok === 0
                            ? `${S.vlessScreen.proverkaItog(0, check.total)} — ${S.vlessScreen.proverkaNikto}`
                            : S.vlessScreen.proverkaItog(check.ok, check.total)}
                    {check.best && ` · ${S.vlessScreen.proverkaLuchshiy(check.best.name, check.best.ms)}`}
                    {!running && check.ok === 0 && check.why && ` · ${S.vlessScreen.proverkaPochemu(check.why)}`}
                </p>
            )}
        </div>
    )
}

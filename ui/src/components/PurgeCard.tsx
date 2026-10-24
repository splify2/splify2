import { useState } from 'react'
import { Loader2, Trash2, Hourglass } from 'lucide-react'
import { Block, CardHead } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { rpc } from '@/lib/rpc'

import { S } from '@/copy'

// «Удалить splify2» — третья кнопка рядом с установкой и обновлением.
//
// Шаги: кнопка → план (что будет убрано, выбор «оставить настройки») → подтверждение →
// экран «Удаляется…». План запрашивается у роутера и ничего не меняет; сам запуск на
// стороне бэкенда отсоединённый, ответ приходит сразу, поэтому после него спиннера нет:
// страница всё равно перестанет отвечать, и бесконечное «загрузка» выглядело бы поломкой.

type Plan = { items: string[]; notes: string[]; packages: string[] }
type Step = 'idle' | 'loading' | 'plan' | 'confirm' | 'starting' | 'started'

export default function PurgeCard() {
    const [step, setStep] = useState<Step>('idle')
    const [plan, setPlan] = useState<Plan | null>(null)
    const [keep, setKeep] = useState(false)
    const [log, setLog] = useState('')

    async function load(keepConfig: boolean) {
        setStep('loading')
        try {
            const r = await rpc.splify2Purge(true, keepConfig)
            if (!r.ok) throw new Error(r.error || S.purgeCard.planNePoluchen)
            setPlan({ items: r.items ?? [], notes: r.notes ?? [], packages: r.packages ?? [] })
            setStep('plan')
        } catch (e) {
            notify(`${S.purgeCard.planNePoluchen}: ${e instanceof Error ? e.message : String(e)}`, 'error')
            setStep('idle')
        }
    }

    async function start() {
        setStep('starting')
        try {
            const r = await rpc.splify2Purge(false, keep)
            if (!r.ok || !r.started) throw new Error(r.error || S.purgeCard.neZapustilos)
            setLog(r.log ?? '')
            setStep('started')
        } catch (e) {
            notify(`${S.purgeCard.neZapustilos}: ${e instanceof Error ? e.message : String(e)}`, 'error')
            setStep('plan')
        }
    }

    function toggleKeep(v: boolean) {
        setKeep(v)
        void load(v)
    }

    function cancel() {
        setStep('idle')
        setPlan(null)
    }

    if (step === 'started') {
        return (
            <Block>
                <CardHead title={S.purgeCard.udalyaetsya} />
                <div role="status" className="flex items-start gap-3 text-sm">
                    <Hourglass className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <div className="space-y-2">
                        <p>{S.purgeCard.udalyaetsyaTekst}</p>
                        {log && (
                            <p className="text-xs text-muted-foreground">
                                {S.purgeCard.zhurnal} <code>{log}</code>
                            </p>
                        )}
                    </div>
                </div>
            </Block>
        )
    }

    return (
        <Block>
            <CardHead title={S.purgeCard.zagolovok} />
            {step === 'idle' && (
                <>
                    <p className="text-sm">{S.purgeCard.opisanie}</p>
                    <Button variant="destructive" onClick={() => void load(keep)}>
                        <Trash2 className="h-4 w-4" />
                        {S.purgeCard.udalit}
                    </Button>
                </>
            )}

            {step === 'loading' && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {S.purgeCard.smotrim}
                </p>
            )}

            {(step === 'plan' || step === 'confirm' || step === 'starting') && plan && (
                <>
                    {step === 'plan' && (
                        <>
                            <p className="text-sm font-semibold">{S.purgeCard.planZagolovok}</p>
                            {plan.items.length === 0 && plan.packages.length === 0 ? (
                                <p className="text-sm">{S.purgeCard.planPust}</p>
                            ) : (
                                <ul className="list-disc space-y-1 pl-5 text-sm">
                                    {plan.items.map((t) => <li key={t}>{t}</li>)}
                                </ul>
                            )}
                            {plan.packages.length > 0 && (
                                <p className="text-sm">
                                    {S.purgeCard.pakety}: <code>{plan.packages.join(', ')}</code>
                                </p>
                            )}
                            {plan.notes.length > 0 && (
                                <div className="text-xs text-muted-foreground">
                                    <p className="font-semibold">{S.purgeCard.primechaniya}:</p>
                                    <ul className="list-disc space-y-0.5 pl-5">
                                        {plan.notes.map((t) => <li key={t}>{t}</li>)}
                                    </ul>
                                </div>
                            )}
                            <label className="flex items-start gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    className="mt-1"
                                    checked={keep}
                                    onChange={(e) => toggleKeep(e.currentTarget.checked)}
                                />
                                <span>
                                    {S.purgeCard.ostavitNastroyki}
                                    <span className="block text-xs text-muted-foreground">
                                        {keep ? S.purgeCard.ostavitPodskazka : S.purgeCard.nastroykiBudutUdaleny}
                                    </span>
                                </span>
                            </label>
                            <div className="flex flex-wrap gap-2">
                                <Button variant="destructive" onClick={() => setStep('confirm')}>
                                    {S.purgeCard.dalee}
                                </Button>
                                <Button variant="outline" onClick={cancel}>{S.purgeCard.otmena}</Button>
                            </div>
                        </>
                    )}
                    {(step === 'confirm' || step === 'starting') && (
                        <div role="alertdialog" aria-label={S.purgeCard.podtverzhdenie} className="space-y-3">
                            <p className="text-sm font-semibold">{S.purgeCard.podtverzhdenie}</p>
                            <p className="text-sm">
                                {S.purgeCard.podtverzhdenieTekst}{' '}
                                {keep ? S.purgeCard.podtverzhdenieOstavit : S.purgeCard.podtverzhdenieNeOstavit}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <Button variant="destructive" disabled={step === 'starting'} onClick={() => void start()}>
                                    {step === 'starting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                    {S.purgeCard.udalitSeychas}
                                </Button>
                                <Button variant="outline" disabled={step === 'starting'} onClick={() => setStep('plan')}>
                                    {S.purgeCard.nazad}
                                </Button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </Block>
    )
}

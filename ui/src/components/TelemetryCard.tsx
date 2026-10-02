import { useEffect, useState } from 'react'
import { Block, CardHead } from '@/components/ui/layout'
import { Switch } from '@/components/ui/switch'
import { rpc } from '@/lib/rpc'
import { notify } from '@/lib/notify'
import { fmtWhen } from '@/lib/format'

import { S } from '@/copy'

/** Учёт роутера в счётчике на splify2.github.io. Описание — docs/TELEMETRY.md.
 *
 *  Включено по умолчанию: ключа настройки нет — роутер учитывается, единственное явное
 *  действие здесь — выключить. Решение «уходит ли отклик» считает роутер (`on`), а
 *  карточка его только показывает. Не ответил бэкенд — переключатель включён: молчание
 *  rpcd отклик не выключает. */

interface St {
    on: boolean
    lastAt: number
    lastError: string
}

/** Слово причины с роутера → текст. Незнакомое слово — общий текст. */
function errorText(code: string): string {
    const c = S.telemetryCard
    switch (code) {
        case 'rejected': return c.errRejected
        case 'toomany': return c.errTooMany
        case 'unavailable': return c.errUnavailable
        case 'network': return c.errNetwork
        case 'noid': return c.errNoId
        case 'nosender': return c.errNoSender
        default: return c.errOther
    }
}

export default function TelemetryCard() {
    const [st, setSt] = useState<St | null>(null)
    const [busy, setBusy] = useState(false)

    async function load() {
        const r = await rpc.telemetryState()
        setSt({
            on: r.on !== undefined ? Boolean(r.on) : r.consent !== 'off',
            lastAt: Number(r.last_at) || 0,
            lastError: r.last_error || '',
        })
    }

    useEffect(() => {
        void load().catch(() => setSt({ on: true, lastAt: 0, lastError: '' }))
    }, [])

    const on = st ? st.on : true

    async function toggle() {
        if (!st || busy) return
        const next = !on
        setBusy(true)
        try {
            const r = await rpc.telemetrySet(next)
            if (!r.ok) throw new Error(r.error || S.telemetryCard.neSohranilos)
            notify(next ? S.telemetryCard.vklyucheno : S.telemetryCard.vyklyucheno)
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy(false)
            // Перечитать, а не подставить: запись на роутере могла не пройти.
            await load().catch(() => undefined)
        }
    }

    let status = ''
    let warn = false
    if (st && !on) status = S.telemetryCard.vyklyuchenoStatus
    else if (st && st.lastError) {
        status = errorText(st.lastError)
        warn = true
    } else if (st && st.lastAt) status = `${S.telemetryCard.posledniyOtklik}: ${fmtWhen(st.lastAt)}`
    else if (st) status = S.telemetryCard.otklikaEschNeBylo

    return (
        <Block>
            <CardHead title={S.telemetryCard.schetchikNaSayte} />
            <div className="flex flex-row-reverse items-start justify-between gap-3">
                <Switch
                    on={on}
                    label={S.telemetryCard.uchityvatRouter}
                    disabled={busy || st === null}
                    onClick={() => void toggle()}
                />
                <div className="min-w-0">
                    <div className="text-[13px]">{S.telemetryCard.uchityvatRouter}</div>
                    {status && (
                        <div className={warn ? 'text-xs text-warning-fg' : 'text-xs text-muted-foreground'}>
                            {status}
                        </div>
                    )}
                </div>
            </div>
            <div className="text-xs leading-relaxed text-muted-foreground">
                {S.telemetryCard.chtoUhodit}
            </div>
        </Block>
    )
}

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { useConfirm } from '@/components/ui/confirm'
import { PluginGuard } from '@/plugins/boundary'
import { registry, useRegistry } from '@/plugins/registry'
import { toHostLive } from '@/plugins/hostlive'
import { pluginActions } from '@/plugins/store'
import type { PluginEntry, PluginSettingsSlot } from '@/plugins/api'
import type { RuntimeStatus } from '@/plugins/runtime'
import { notify } from '@/lib/notify'
import type { Live } from '@/lib/live'
import { S } from '@/copy'

/** Карточка установленного плагина — по образцу карточки правила (RuleCard, Home.tsx):
 *  имя открывает настройки, выключатель справа сверху, бейджи «версия, репозиторий», корзина с
 *  подтверждением и строка состояния в подвале. Строка — `summary(live)` плагина, а если его нет
 *  или он молчит, общая: состояние хоста и причина (несовместим, не запустился, нужен пакет…). */

export const TRUST_TEXT: Record<PluginEntry['trust'], string> = {
    official: S.plugins.oficialnyy,
    'third-party': S.plugins.storonniy,
    unsigned: S.plugins.bezPodpisi,
}

export function RepoBadge({ trust, repo }: { trust: PluginEntry['trust']; repo: string }) {
    return (
        <Badge variant={trust === 'official' ? 'secondary' : 'warn'} title={trust === 'official' ? undefined : TRUST_TEXT[trust]}>
            {repo}
        </Badge>
    )
}

/** Слот `pluginSettings` плагина — запись реестра или ничего. */
export function useSettingsSlot(id: string): PluginSettingsSlot | undefined {
    useRegistry()
    return registry.get<PluginSettingsSlot>('pluginSettings', id)?.value
}

export function stateLine(
    e: PluginEntry, rt: RuntimeStatus | undefined, live: Live, slot: PluginSettingsSlot | undefined,
): { text: string; tone: 'ok' | 'warn' | 'bad' | 'idle' } {
    if (e.state === 'disabled' || e.state === 'installed') return { text: S.plugins.vyklyuchen, tone: 'idle' }
    if (rt?.status === 'incompatible' || rt?.status === 'failed') return { text: rt.reason, tone: 'bad' }
    if (e.state === 'failed') return { text: e.why || S.plugins.neZapustilsya, tone: 'bad' }
    if (e.state === 'pending') return { text: e.why || S.plugins.zhdetPaketa, tone: 'warn' }
    if (rt?.status === 'skipped') return { text: rt.reason, tone: 'idle' }
    if (rt?.status === 'safe') return { text: S.plugins.bezPlaginov, tone: 'idle' }
    if (slot?.summary) {
        try {
            const s = slot.summary(toHostLive(live))
            if (s?.text) return { text: s.text, tone: s.tone === 'bad' ? 'bad' : s.tone ?? 'ok' }
        } catch (err) {
            console.error(`[plugin ${e.id}] summary`, err)
        }
    }
    return { text: S.plugins.rabotaet, tone: 'ok' }
}

const DOT: Record<'ok' | 'warn' | 'bad' | 'idle', string> = {
    ok: 'bg-success', warn: 'bg-warning', bad: 'bg-destructive', idle: 'bg-muted-foreground',
}

export default function PluginCard({ entry, runtime, live, onOpen }: {
    entry: PluginEntry
    runtime?: RuntimeStatus
    live: Live
    onOpen: () => void
}) {
    const [busy, setBusy] = useState(false)
    const [ask, dialog] = useConfirm()
    const slot = useSettingsSlot(entry.id)
    const on = entry.state === 'enabled'
    const line = stateLine(entry, runtime, live, slot)

    async function run(f: () => Promise<unknown>) {
        setBusy(true)
        try { await f() } catch (e) { notify(e instanceof Error ? e.message : String(e), 'error') } finally { setBusy(false) }
    }

    async function remove() {
        const used = entry.used_by?.length ? S.plugins.nuzhenVyhodam(entry.used_by.join(', ')) : undefined
        const ok = await ask({
            title: S.plugins.udalitPlagin(entry.name),
            body: used ?? S.plugins.udalitPodpis,
            confirmLabel: S.plugins.udalit,
        })
        if (ok) await run(() => pluginActions.remove(entry.id))
    }

    return (
        <article className={['sp-board-tile an-glass sp-board-rule flex min-w-0 flex-col gap-2 rounded-2xl border p-3.5', on ? '' : 'sp-board-rule-off'].join(' ')}>
            <div className="flex min-w-0 items-start justify-between gap-3">
                <button type="button" onClick={onOpen} className="sp-board-rule-open min-w-0 bg-transparent text-left text-sm font-semibold">
                    {entry.name}
                </button>
                <div className="sp-board-rule-control">
                    <Switch
                        on={on}
                        disabled={busy}
                        label={on ? S.plugins.vyklyuchitPlagin(entry.name) : S.plugins.vklyuchitPlagin(entry.name)}
                        onClick={() => run(() => (on ? pluginActions.disable(entry.id) : pluginActions.enable(entry.id)))}
                    />
                </div>
            </div>
            <div className="sp-board-rule-control flex min-w-0 flex-wrap items-center gap-1.5">
                <Badge variant="proto">{entry.version}</Badge>
                <RepoBadge trust={entry.trust} repo={entry.repo} />
                {entry.trust !== 'official' && (
                    <span className="min-w-0 text-[11px] text-muted-foreground">{TRUST_TEXT[entry.trust]}</span>
                )}
                {entry.update && <Badge variant="warn">{S.plugins.dostupnaVersiya(entry.update)}</Badge>}
            </div>
            <div className="mt-auto flex min-w-0 items-start gap-2 text-[11px] text-muted-foreground">
                <button
                    type="button"
                    onClick={remove}
                    disabled={busy}
                    aria-label={S.plugins.udalitPlagin(entry.name)}
                    title={S.plugins.udalitPlagin(entry.name)}
                    className="sp-board-rule-control mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center bg-transparent p-0 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-60"
                >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[line.tone]}`} aria-hidden="true" />
                <PluginGuard name={entry.name} quiet>
                    <span className="min-w-0 break-words" data-testid="plugin-state">{line.text}</span>
                </PluginGuard>
            </div>
            {dialog}
        </article>
    )
}

import { useState } from 'react'
import { Block, KV, ScreenHeader, ToggleRow } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { PluginGuard, SlotView } from '@/plugins/boundary'
import { toHostLive } from '@/plugins/hostlive'
import { disableBroken, pluginActions, refreshPlugins } from '@/plugins/store'
import { setRailShown } from '@/plugins/normalize'
import { reloadPlugin } from '@/plugins/loader'
import type { PluginEntry } from '@/plugins/api'
import { notify } from '@/lib/notify'
import type { Live } from '@/lib/live'
import { RepoBadge, TRUST_TEXT, useSettingsSlot } from '@/components/PluginCard'
import { Loader2 } from 'lucide-react'
import { S } from '@/copy'

/** Раскрытая карточка плагина: на месте списка, со стрелкой назад — как открытое правило
 *  (RulesTab → RuleEditor). Сверху — настройки плагина (слот `pluginSettings`, под предохранителем),
 *  под ними общий блок хоста: версия и «Обновить», автообновление, закрепление, права, пакеты. */
export default function PluginOpen({ entry, live, onClose, deferred }: {
    entry: PluginEntry
    live: Live
    onClose: () => void
    /** Приложение для ПК: правки спеки — черновиком до «Сохранить». */
    deferred: boolean
}) {
    const slot = useSettingsSlot(entry.id)
    const [busy, setBusy] = useState<string | null>(null)
    const [step, setStep] = useState('')

    async function run(what: string, f: () => Promise<unknown>) {
        setBusy(what)
        try { await f() } catch (e) { notify(e instanceof Error ? e.message : String(e), 'error') } finally { setBusy(null); setStep('') }
    }

    return (
        <div className="space-y-4">
            <ScreenHeader title={entry.name} back={onClose} right={<RepoBadge trust={entry.trust} repo={entry.repo} />} />
            {entry.description && <p className="text-sm text-muted-foreground">{entry.description}</p>}
            {slot && (
                <PluginGuard name={entry.name} onDisable={() => void disableBroken(entry)} reset={slot}>
                    <SlotView render={() => slot.render({ live: toHostLive(live), close: onClose, deferred })} />
                </PluginGuard>
            )}
            <Block>
                <KV k={S.plugins.versiya} v={entry.version} />
                {entry.update && (
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-sm">{S.plugins.dostupnaVersiya(entry.update)}</span>
                        <Button size="sm" disabled={!!busy} onClick={() => run('update', () => pluginActions.update(entry.id, setStep))}>
                            {busy === 'update' && <Loader2 className="h-4 w-4 animate-spin" />}
                            {busy === 'update' && step ? step : S.plugins.obnovit}
                        </Button>
                    </div>
                )}
                <ToggleRow
                    label={S.plugins.avtoobnovlenie}
                    on={entry.autoupdate !== false}
                    disabled={!!busy}
                    onToggle={() => run('auto', () => pluginActions.autoupdate(entry.id, entry.autoupdate === false))}
                />
                {entry.ui?.rail && (
                    <ToggleRow
                        label={S.plugins.pokazyvatVPolose}
                        on={entry.rail_shown !== false}
                        disabled={!!busy}
                        onToggle={() => run('rail', async () => {
                            setRailShown(entry.id, entry.rail_shown === false)
                            // Слот раздела регистрируется в activate: плагин поднимается заново, роутер не трогается.
                            await reloadPlugin(entry.id)
                            await refreshPlugins()
                        })}
                    />
                )}
                {entry.trust !== 'official' && <p className="text-xs text-muted-foreground">{TRUST_TEXT[entry.trust]}</p>}
                {!!entry.permissions?.length && <KV k={S.plugins.prava} v={entry.permissions.join(', ')} />}
                {!!entry.kinds?.length && <KV k={S.plugins.vidyVyhodov} v={entry.kinds.join(', ')} />}
                {!!entry.packages?.length && <KV k={S.plugins.paketyDlyaPlagina} v={entry.packages.join(', ')} />}
            </Block>
        </div>
    )
}

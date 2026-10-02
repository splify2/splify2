import { useEffect, useState } from 'react'
import { Info, Layers, Library, Network, Sliders } from 'lucide-react'
import { Group, ScreenHeader, TapRow } from '@/components/ui/layout'
import CatalogTab from '@/components/tabs/CatalogTab'
import BackupCard from '@/components/BackupCard'
import ClientNetsCard from '@/components/ClientNetsCard'
import CustomLists from '@/components/CustomLists'
import EngineCard from '@/components/EngineCard'
import FetchCard from '@/components/FetchCard'
import ListsSourceCard from '@/components/ListsSourceCard'
import SelfUpdateCard from '@/components/SelfUpdateCard'
import TelemetryCard from '@/components/TelemetryCard'
import XsteerPanel from '@/components/XsteerPanel'
import { rpc } from '@/lib/rpc'
import { pending, usePending } from '@/lib/pending'
import { type ServiceEntry, type Spec } from '@/lib/model'
import { type Live } from '@/lib/live'

import { S } from '@/copy'
/** Настройки: всё, что не про маршрутизацию, пятью входами. Диагностика — свой раздел рельса.
 *
 *  Раздел-склад («Логи steer») в проекте уже был: в него въезжало всё, что не влезло в
 *  остальные вкладки, и найти в нём что-либо можно было только прокруткой. Здесь вместо
 *  склада шесть названных входов, и каждый открывает своё содержимое на месте раздела. */

type Screen = 'root' | 'general' | 'catalog' | 'xsteer' | 'extra' | 'about'

const TITLE: Record<Exclude<Screen, 'root'>, string> = {
    general: S.settings.obschee,
    catalog: S.settings.katalog,
    xsteer: 'XSTEER',
    extra: S.settings.dopolnitelno,
    about: S.settings.oPo,
}

export default function Settings({
    live, onUseInRule,
}: {
    live: Live
    /** Запись каталога «в правило»: переход между разделами — дело оболочки. */
    onUseInRule: (s: ServiceEntry) => void
}) {
    const [screen, setScreen] = useState<Screen>('root')
    const { spec } = usePending()
    const [local, setLocal] = useState<Record<string, { count: number; mtime: number }>>({})
    const [editable, setEditable] = useState<Spec | null>(null)

    const reloadLocal = () =>
        rpc.localLists().then((d) => setLocal(d.files || {})).catch(() => setLocal({}))

    useEffect(() => {
        void reloadLocal()
        pending.load().then(setEditable).catch(() => setEditable(null))
    }, [])

    if (screen !== 'root') {
        return (
            <div className="space-y-4">
                {/* Bode: шапка вложенного экрана — стрелка назад и заголовок, как в приложении. */}
                <ScreenHeader title={TITLE[screen]} back={() => setScreen('root')} backLabel={S.settings.nastroyki} />
                <>
                    {screen === 'general' && (
                        <div className="space-y-4">
                            <ClientNetsCard
                                spec={editable}
                                status={live.status}
                                onChange={(next) => {
                                    setEditable(next)
                                    pending.edit(next)
                                }}
                            />
                            <FetchCard />
                            <ListsSourceCard />
                        </div>
                    )}
                    {screen === 'catalog' && <CatalogTab onUseInRule={onUseInRule} />}
                    {screen === 'xsteer' && <XsteerPanel live={live} />}
                    {screen === 'extra' && (
                        <div className="space-y-4">
                            <CustomLists local={local} onChanged={reloadLocal} />
                            <BackupCard />
                        </div>
                    )}
                    {screen === 'about' && (
                        <div className="space-y-4">
                            <EngineCard
                                engine={live.build}
                                releases={live.releases}
                                onInstalled={live.refresh}
                            />
                            <SelfUpdateCard info={live.selfUpdate} onInstalled={live.refresh} />
                            {/* Отчёт о работе живёт здесь, а не среди общих выключателей:
                                «О ПО» — раздел про сам продукт и про то, что он о себе
                                собирает, и именно это место названо человеку в документации
                                как то, где телеметрия выключается. Разойдись названное место
                                с настоящим — отказ превратился бы в поиски. */}
                            <TelemetryCard />
                        </div>
                    )}
                </>
            </div>
        )
    }

    /* Свои — это custom/, а не всё, что лежит на роутере: скачанные списки каталога тоже
       файлы, и «своих списков: 47» на роутере с двумя своими было неправдой. */
    const own = Object.keys(local).filter((f) => f.startsWith('custom/')).length
    const used = new Set(
        (spec?.channels || []).flatMap((c) => [
            ...(c.match.prefixes_files || []),
            ...(c.match.domains_files || []),
            ...(c.match.srs_files || []),
        ]),
    ).size

    return (
        <Group>
            <TapRow
                icon={Sliders}
                title={S.settings.obschee}
                subtitle={(live.status?.lan_devices || spec?.lan_devices || []).join(', ') || undefined}
                onClick={() => setScreen('general')}
            />
            <TapRow
                icon={Library}
                title={S.settings.katalog}
                subtitle={S.settings.spiskovIspolzuetsya(used)}
                onClick={() => setScreen('catalog')}
            />
            <TapRow icon={Network} title="XSTEER" onClick={() => setScreen('xsteer')} />
            <TapRow
                icon={Layers}
                title={S.settings.dopolnitelno}
                subtitle={own ? S.settings.svoihSpiskov(own) : undefined}
                onClick={() => setScreen('extra')}
            />
            <TapRow
                icon={Info}
                title={S.settings.oPo}
                subtitle={[
                    live.selfUpdate?.current ? `splify2 ${live.selfUpdate.current}` : '',
                    live.build?.version ? `steer ${live.build.version}` : '',
                ]
                    .filter(Boolean)
                    .join(' · ') || undefined}
                onClick={() => setScreen('about')}
            />
        </Group>
    )
}

import { useState } from 'react'
import { Power } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm'
import { notify } from '@/lib/notify'
import { rpc } from '@/lib/rpc'
import { engineAction } from '@/lib/engine'
import { type Live } from '@/lib/live'
import { type SectionId } from '@/lib/sections'

import { S } from '@/copy'
/** «Остановить всё» — и то, что стоит рядом с ней: какой движок установлен и есть ли что
 *  обновлять.
 *
 *  Отдельным компонентом, потому что мест у неё ДВА, и это не дубль: на широком экране она
 *  живёт в подвале рельса, на узком рельс уезжает в нижнюю панель, куда красная кнопка на всю
 *  ширину не поместится и не должна. Логика при этом одна — включая подтверждение, которое
 *  обязано быть одинаковым в обоих местах.
 *
 *  Просьба из публичного теста (R-017) была дословно про ОДНУ кнопку, которой снимается
 *  маршрутизация целиком. Спрятать её на телефоне значило бы не выполнить просьбу ровно на том
 *  экране, с которого чаще всего и тушат интернет в доме. */

export default function EngineToggle({
    live, variant, onSection,
}: {
    live: Live
    /** `rail` — подвал рельса: сведения о движке плюс кнопка. `block` — узкий экран: только
     *  кнопка, сведения там были бы тремя строками справки поперёк дороги. */
    variant: 'rail' | 'block'
    onSection?: (s: SectionId) => void
}) {
    const [toggling, setToggling] = useState(false)
    const [ask, confirmDialog] = useConfirm()
    const eng = live.build

    /** Подтверждение обязательно и только на остановке: она снимает маршрутизацию у всех, кто
     *  сейчас в сети, и вдобавок автозапуск, то есть перезагрузкой не чинится. Запуск ничего не
     *  ломает и спрашивать не о чем. */
    /** ВЫКЛЮЧЕН — это снятый автозапуск И неработающая служба, а не одно из двух.
     *
     *  Пара расходится чаще, чем кажется: движок поднимался сам после ночного обновления
     *  списков (`reload_dnsd` при отсутствии экземпляра резолвера поднимал всю службу), а
     *  ссылка автозапуска оставалась снятой. Кнопка при этом читала только автозапуск и
     *  предлагала «Запустить» уже работающий движок — то есть говорила «выключено» о том, что
     *  работает. Обратка владельца: «запускается сам steer, splify2 всё ещё считает, что всё
     *  выключено». Причину чинит движок и ночное обновление; здесь чинится ПОКАЗ, потому что
     *  расхождение возможно и по другим поводам — службу поднимают руками из консоли. */
    const off = eng?.enabled === false && eng?.running !== true

    async function toggleEngine() {
        const stopping = !off
        if (stopping) {
            const ok = await ask({
                title: S.engineToggle.ostanovitVse,
                body:
                    S.engineToggle.marshrutizatsiyaSnimetsyaTselikomYadro +
                    S.engineToggle.avtozapuskTozheSnimetsyaPoetomu +
                    S.engineToggle.vklyuchatPridetsyaEtoyZhe,
                confirmLabel: S.engineToggle.ostanovit,
            })
            if (!ok) return
        }
        setToggling(true)
        try {
            const r = stopping ? await rpc.engineStop() : await rpc.engineStart()
            notify(
                stopping ? S.engineToggle.yadroOstanovleno : r.running ? S.engineToggle.yadroZapuscheno : S.engineToggle.yadroVklyuchenoNoNe,
                stopping || r.running ? 'info' : 'warning',
            )
            live.refresh()
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setToggling(false)
        }
    }

    /* Ни движка, ни сведений о нём — показывать нечего: останавливать нечего, пока его нет, а
     * кнопка в никуда хуже отсутствующей. */
    if (!eng) return null

    return (
        <div className="flex flex-col gap-2">
            {confirmDialog}
            {variant === 'rail' && (
                <div className="rounded-xl border border-border p-2.5">
                    {eng.present ? (
                        <>
                            <div className="text-[11px] text-muted-foreground">{S.engineToggle.yadro}</div>
                            {/* Версия и модули рядом с ядром — то, что стоит, а не вариант сборки:
                                в ядре 2.0 вариантов нет, есть steer-core и модули. */}
                            <div className="truncate text-[13px]">
                                {['steer ' + (eng.version || '—'), eng.busy ? S.engineToggle.zanyato(eng.busy) : (eng.modules || []).join(', ')]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </div>
                        </>
                    ) : (
                        <div className="text-[13px]">
                            {S.engineToggle.yadraNet}<div className="text-[11px] text-muted-foreground">
                                {S.engineToggle.primenitNastroykuNechem}</div>
                        </div>
                    )}
                    {onSection && (
                        <button
                            type="button"
                            onClick={() => onSection('settings')}
                            className="mt-1 text-[12px] text-primary underline decoration-dotted"
                        >
                            {/* Подпись считает engineAction, а не эта строка: то же действие
                                названо ещё и в разделе «Система», и пока слово выбиралось в двух
                                местах, они расходились — рельс обещал обновление, которого нет
                                (I-038). */}
                            {engineAction(eng, live.releases).label}
                        </button>
                    )}
                </div>
            )}

            {/* Ядро ведёт steer-box-connector (podkop, forkop): службу steer поверх него не
                поднимаем и не гасим — вместо кнопки состояние. */}
            {eng.present && eng.busy && (
                <p className="text-[12px] text-muted-foreground">{S.engineToggle.yadroZanyato(eng.busy)}</p>
            )}
            {eng.present && !eng.busy && (
                <div>
                    <Button
                        variant={off ? 'secondary' : 'destructive'}
                        className="w-full"
                        onClick={toggleEngine}
                        disabled={toggling}
                    >
                        <Power className="h-4 w-4" aria-hidden="true" />
                        {toggling ? S.engineToggle.sekundu : off ? S.engineToggle.zapustit : S.engineToggle.ostanovitVse2}
                    </Button>
                    {off && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                            {S.engineToggle.avtozapuskSnyatPerezagruzkaYadro}</p>
                    )}
                    {/* Работает, хотя выключали. Сказать об этом обязаны: молча показывать
                        «Остановить всё» на движке, который человек считает выключенным, —
                        значит оставить его в уверенности, что маршрутизации нет. */}
                    {eng.enabled === false && eng.running === true && (
                        <p className="mt-1 text-[11px] text-warning-fg">
                            {S.engineToggle.yadroRabotaetHotyaAvtozapusk}</p>
                    )}
                </div>
            )}
        </div>
    )
}

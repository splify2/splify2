import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Info, RefreshCw, Search, TriangleAlert, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConnsCard, NamesCard } from '@/components/ObserveCards'
import { Block, CardHead } from '@/components/ui/layout'
import { type Live } from '@/lib/live'
import { parseLog } from '@/lib/log'
import { rpc } from '@/lib/rpc'

import { S } from '@/copy'
/** Диагностика: то, за чем приходят, когда «применилось, но не работает».
 *
 *  Проверки идут по ЖИВОМУ ядру и живым процессам, а не по настройке: совпадение с настройкой
 *  ничего не доказывает. Текст находки печатается ДОСЛОВНО из `diag.checks[].what` — интерфейс
 *  движок не пересказывает: формулировки принадлежат ему и меняются вместе с ним, а пересказ
 *  здесь означал бы, что правка сообщения в движке тихо ломает показ.
 *
 *  Чего здесь больше нет. Счётчики трафика и «куда пойдёт запрос» уехали на обзор, а движок,
 *  самообновление и архив настроек — в «Настройки → Интерфейс». Раздел был складом: в него въезжало всё, что
 *  не влезало в остальные вкладки, и по его названию нельзя было угадать содержимое. */

/** Сколько исправных проверок видно до «Показать все». */
const OK_FOLD = 6

export default function Diagnostics({ live, board = false }: { live: Live; board?: boolean }) {
    /* Журнал движка спрашивает ЭТОТ экран, пока он открыт, а не общий круг опроса.
     *
     * Читает его один-единственный список — тот, что ниже, — а стоил он дороже всего
     * остального вместе взятого: `logread -l 300 | grep steer` это 76 мс на каждом круге,
     * плюс запуск скрипта объекта (126 мс), то есть 350 мс каждые пять секунд ради строк,
     * которых на экране в это время нет. Замер на стенде 10.8.1.87.
     *
     * Общий круг от этого не расходится во времени с журналом: числа и вердикты приходят
     * своим ответом, строки журнала — своим, и сверять их между собой незачем — это
     * разные вопросы. Расхождение мгновений опасно там, где два числа об одном и том же
     * (см. шапку lib/live.ts), а здесь такого нет. */
    const [log, setLog] = useState<string[] | null>(null)
    const [logFilter, setLogFilter] = useState('')
    const [refreshingLog, setRefreshingLog] = useState(false)
    const [allOk, setAllOk] = useState(false)

    const pull = async () => {
        setRefreshingLog(true)
        try {
            const e = await rpc.engineState()
            setLog(e.log || [])
        } catch {
            setLog([])
        } finally {
            setRefreshingLog(false)
        }
    }

    useEffect(() => {
        let stop = false
        const timerPull = () => {
            if (!stop && !document.hidden) {
                rpc.engineState()
                    .then((e) => { if (!stop) setLog(e.log || []) })
                    .catch(() => { if (!stop) setLog([]) })
            }
        }
        void timerPull()
        const id = setInterval(timerPull, 5000)
        return () => { stop = true; clearInterval(id) }
    }, [])

    const filteredLog = useMemo(() => {
        if (!log) return []
        const q = logFilter.trim().toLowerCase()
        if (!q) return log
        return log.filter((line) => line.toLowerCase().includes(q))
    }, [log, logFilter])

    const bad = (live.diag?.checks || []).filter((c) => c.verdict === 'fail' || c.verdict === 'warn')

    /* Советы отдельно и НЕ в счётчиках: они верны всегда, а не описывают эту установку. Смешав
     * их с находками, мы держали бы «есть о чём знать» постоянно — и человек перестал бы читать
     * находки вовсе. */
    const notes = (live.diag?.checks || []).filter((c) => c.verdict === 'note')
    const good = (live.diag?.checks || []).filter((c) => c.verdict === 'ok')

    const verdict = live.diagOld
                            ? S.diagnostics.proverkaSostoyaniyaNedostupna
                            : live.diag?.fail
                              ? S.diagnostics.proverokSOtkazom(live.diag.fail)
                              : live.diag?.warn
                                ? S.diagnostics.proverokSPreduprezhdeniem(live.diag.warn)
                                : S.diagnostics.vseVPoryadke
    const logRefresh = (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                        disabled={refreshingLog}
                        onClick={() => void pull()}
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${refreshingLog ? 'animate-spin' : ''}`} />
                        <span>{S.diagnostics.obnovit}</span>
                    </Button>
    )
    const logBody = (
                <div className="space-y-2">
                    {log && log.length > 0 && (
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                            <input
                                type="text"
                                value={logFilter}
                                onChange={(e) => setLogFilter(e.target.value)}
                                placeholder={S.diagnostics.poiskPoZhurnalu}
                                className="w-full h-8 pl-8 pr-8 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                            {logFilter && (
                                <button
                                    type="button"
                                    onClick={() => setLogFilter('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    aria-label={S.diagnostics.ochistitPoisk}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </div>
                    )}
                    {log === null ? (
                        <p className="py-4 text-center text-sm text-muted-foreground">
                            {S.diagnostics.zagruzkaZhurnala}</p>
                    ) : filteredLog.length > 0 ? (
                        <div className="max-h-72 overflow-auto rounded-xl border border-border bg-muted p-3 text-[11px] leading-relaxed font-mono">
                            {filteredLog.map((line, i) => {
                                const l = parseLog(line)
                                return (
                                    <div key={i} className="flex gap-2 whitespace-pre-wrap">
                                        {l.time && (
                                            <span className="shrink-0 text-muted-foreground">
                                                {l.time}
                                            </span>
                                        )}
                                        {/* Значок только у предупреждения: подпись «info» на
                                            каждой строке — это шум, из-за которого перестают
                                             замечать те самые строки, ради которых сюда и
                                             пришли. */}
                                        {l.level === 'warn' && (
                                            <span className="shrink-0 text-warning-fg font-bold">!</span>
                                        )}
                                        <span
                                            className={`min-w-0 ${l.level === 'warn' ? 'text-warning-fg font-medium' : ''}`}
                                        >
                                            {l.text}
                                        </span>
                                    </div>
                                )
                            })}
                        </div>
                    ) : log.length > 0 ? (
                        <div className="py-6 text-center space-y-1 text-xs text-muted-foreground">
                            <p>{S.diagnostics.strokPoZaprosu}{logFilter}{S.diagnostics.neNaydeno}</p>
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setLogFilter('')}>
                                {S.diagnostics.sbrositFiltr}</Button>
                        </div>
                    ) : (
                        <p className="py-4 text-center text-sm text-muted-foreground">
                            {S.diagnostics.yadroNichegoNePisalo}</p>
                    )}
                </div>
    )

    /* Приложение для компьютера — блоками, как главная: находки плитками, исправное пилюлями,
     * трафик и журнал — своими блоками. */
    if (board) {
        const GROUP = 'sp-board-group an-glass space-y-3 rounded-2xl border p-3'
        const TILE = 'sp-board-tile an-glass min-w-0 rounded-2xl border p-3.5'
        const okShown = allOk ? good : good.slice(0, OK_FOLD)
        return (
            <div className="space-y-4">
                <section className={GROUP}>
                    <h2 className="sp-sub px-1 pt-1">{verdict}</h2>
                    {live.diagOld && <p className="px-1 text-xs text-muted-foreground">{S.diagnostics.obnoviteSteerVRazdele}</p>}
                    {bad.map((c, i) => (
                        <div key={`${c.id}-${i}`} className={`${TILE} flex gap-2.5 text-[13px] ${c.verdict === 'fail' ? 'border-destructive/50' : 'border-warning/50'}`}>
                            {c.verdict === 'fail'
                                ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                                : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" aria-hidden="true" />}
                            <div className="min-w-0 flex-1">
                                <div className="font-semibold">{c.what}</div>
                                {c.why && <div className="text-xs text-muted-foreground">{c.why}</div>}
                            </div>
                        </div>
                    ))}
                    {notes.map((c, i) => (
                        <div key={`${c.id}-note-${i}`} className={`${TILE} flex gap-2.5 text-[13px]`}>
                            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                                <div className="font-semibold">{c.what}</div>
                                {c.why && <div className="text-xs text-muted-foreground">{c.why}</div>}
                            </div>
                        </div>
                    ))}
                    {good.length > 0 && (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
                            {okShown.map((c, i) => (
                                <div key={`${c.id}-ok-${i}`} className="an-glass sp-pill flex min-h-[44px] min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-[12.5px]" title={c.what}>
                                    <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                                    <span className="min-w-0 truncate text-muted-foreground">{c.what}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {good.length > OK_FOLD && (
                        <button type="button" onClick={() => setAllOk((v) => !v)} className="flex items-center gap-1.5 bg-transparent px-1 text-xs text-primary">
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${allOk ? 'rotate-180' : ''}`} aria-hidden="true" />
                            {allOk ? S.subsBoard.svernut : S.diagnostics.ispravnyh(good.length)}
                        </button>
                    )}
                </section>

                <section className={GROUP}>
                    <h2 className="sp-sub px-1 pt-1">{S.diagnostics.trafikSeychas}</h2>
                    <ConnsCard />
                    <NamesCard />
                </section>

                <section className={GROUP}>
                    <div className="flex items-center justify-between gap-2 px-1 pt-1">
                        <h2 className="sp-sub">{S.diagnostics.logiSteer}</h2>
                        {logRefresh}
                    </div>
                    <div className={TILE}>{logBody}</div>
                </section>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {/* Плохое наверху, исправное свёрнуто: двенадцать зелёных галочек прячут одну
                красную. */}
            <Block>
                <CardHead
                    title={verdict}
                />
                    {/* Объяснять, ЧТО такое проверки, на экране незачем: об этом не
                        спрашивают. Остаётся то, после чего человек делает следующий шаг —
                        движок старый и проверок не умеет. */}
                    {live.diagOld && (
                        <p className="text-xs text-muted-foreground">{S.diagnostics.obnoviteSteerVRazdele}</p>
                    )}
                {!live.diagOld && (
                    <div className="space-y-2">
                        {bad.map((c, i) => (
                            <div
                                key={`${c.id}-${i}`}
                                className={[
                                    'flex gap-2 rounded-xl border p-2.5 text-[13px]',
                                    c.verdict === 'fail'
                                        ? 'border-destructive/40 bg-destructive/10'
                                        : 'border-warning/40 bg-warning/10',
                                ].join(' ')}
                            >
                                {c.verdict === 'fail' ? (
                                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                                ) : (
                                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" aria-hidden="true" />
                                )}
                                <div className="min-w-0 flex-1">
                                    <div>{c.what}</div>
                                    {c.why && <div className="text-xs text-muted-foreground">{c.why}</div>}
                                </div>
                            </div>
                        ))}
                        {notes.length > 0 && (
                            <div className="space-y-2 border-t border-border pt-2">
                                {notes.map((c, i) => (
                                    <div key={`${c.id}-note-${i}`} className="flex gap-2 text-[13px]">
                                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                        <div className="min-w-0">
                                            <div>{c.what}</div>
                                            {c.why && (
                                                <div className="text-xs text-muted-foreground">{c.why}</div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        {good.length > 0 && (
                            <div className="space-y-1 border-t border-border pt-2">
                                {good.map((c, i) => (
                                    <div key={`${c.id}-ok-${i}`} className="flex gap-2 text-[13px]">
                                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                                        <span className="text-muted-foreground">{c.what}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </Block>

            {/* Что ядро делает с трафиком сейчас: соединения через выходы и недавние имена. */}
            <ConnsCard />
            <NamesCard />

            <Block>
                <CardHead
                    title={S.diagnostics.logiSteer}
                    action={logRefresh}
                />
                {logBody}
            </Block>
        </div>
    )
}

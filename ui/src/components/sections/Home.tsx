import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, LoaderCircle, Plus, Search, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Block, CardHead, Meter } from '@/components/ui/layout'
import { SubBlock, TunnelBlock, type Facts } from '@/components/OutputCards'
import { deadline, rpc, type SubQuota } from '@/lib/rpc'
import { subsRemember, subsRemembered } from '@/lib/subs'
import { human, type DiagCheck, type Live } from '@/lib/live'
import { usePending } from '@/lib/pending'
import { specV2Unsupported } from '@/lib/engine'
import { ON_FAIL_TEXT, type Channel, type ChannelStatus, type OutputStatus, devList, isPart, isTunnelKind } from '@/lib/model'
import { devKindsOf } from '@/lib/badges'
import { country } from '@/lib/geo'
import { outDownWord } from '@/lib/outstate'
import Flag from '@/components/Flag'
import { type SectionId } from '@/lib/sections'

import { S } from '@/copy'
/** Главная: работает ли, куда идут правила и чем роутер выходит наружу.
 *
 *  ДВА СТОЛБЦА, И ЭТО ДВА РАЗНЫХ ВОПРОСА. Слева правила: что куда ведёт, сколько через него
 *  прошло и куда оно перейдёт, если нынешний выход упадёт. Справа выходы: по блоку на
 *  подписку и по блоку на свой туннель. Раньше на обзоре стояла таблица «куда идёт трафик»
 *  наборами ядра и одна карточка подписки, выбранная из выходов наугад: набор — это не
 *  правило, а «одна карточка» — это молчание про второй туннель.
 *
 *  Здесь нет ни одного своего мнения о работоспособности: всё, что показано, приходит от
 *  движка. Два ответа на «работает ли» — это на один ответ больше, чем нужно. */

interface Verdict {
    text: string
    tone: 'good' | 'warn' | 'bad' | 'idle'
    why: string
    /** Сами советы, а не только их число: строку «советов: N» человек прочитал как вопрос
     *  («что за совет?» — splify2#4, I-039), потому что содержания в ней не было. */
    notes: DiagCheck[]
}

/** Итог по всему: сначала поломки движка, потом предупреждения, потом «работает».
 *
 *  Порядок именно такой, потому что зелёная надпись сверху при красной проверке ниже учит не
 *  верить надписи. Строк ровно четыре: заголовок состояния не пересказывает находки, что
 *  именно нашлось — читается в диагностике, дословно словами движка. */
function verdict(live: Live): Verdict {
    /* Советы (note) в цвет не идут: они верны всегда, и красить ими состояние значило бы
     * держать роутер вечно нездоровым. Полный перечень остаётся в диагностике. */
    const notes = (live.diag?.checks || []).filter((c) => c.verdict === 'note')
    if (live.error) return { text: S.home.yadroNeOtvechaet, tone: 'bad', why: live.error, notes }
    if (live.diag?.fail)
        return { text: S.home.estPolomki, tone: 'bad', why: S.home.proverokSOtkazom(live.diag.fail), notes }
    if (live.diag?.warn)
        return {
            text: S.home.marshrutizatsiyaRabotaet,
            tone: 'warn',
            why: S.home.proverokSPreduprezhdeniem(live.diag.warn),
            notes,
        }
    if (!live.status) return { text: S.home.zagruzka, tone: 'idle', why: '', notes }
    return {
        text: S.home.marshrutizatsiyaRabotaet,
        tone: 'good',
        why: notes.length ? S.home.sovetov(notes.length) : '',
        notes,
    }
}

/** Вердикт с поправкой на то, что показанное — ещё не сегодняшнее.
 *
 *  На экране прошлое, и у него два источника: снимок прошлого открытия из памяти браузера и
 *  запомненный ответ САМОГО ДВИЖКА — тот, что приходит на первом, быстром круге опроса
 *  (`steer status --fast`). Утверждать по любому из них «Маршрутизация работает» нельзя: это
 *  уже не задержка, а неправда — туннель мог упасть между сборкой снимка и открытием окна.
 *
 *  Поэтому заголовок говорит «Обновление…» жёлтой точкой — «подожди секунду», — а всё
 *  найденное в прошлый раз остаётся под ним. Свежий круг выпускается сразу за быстрым, так
 *  что слово стоит доли секунды, а не пять. */
function verdictNow(live: Live): Verdict {
    const v = verdict(live)
    /* Переход, о котором мы знаем (см. Live.phase), — нейтральное слово серой точкой и без
     * находок: то, что движок находит, пока перестраивает правила или поднимается, — не
     * поломки, а стройплощадка. Выше «Обновление…» нарочно: пока применяется, ответы
     * приезжают, и «свежие» они ровно в том смысле, в котором бесполезны. */
    if (live.phase)
        return { ...v, text: live.phase === 'applying' ? S.home.primenyaetsya : S.home.zapuskaetsya, tone: 'idle', why: '', notes: [] }
    return live.stale ? { ...v, text: S.home.obnovlenie, tone: 'warn' } : v
}

/** «4 ч 12 мин» — то, как об этом говорят. Секунды показываем только первую минуту: дальше они
 *  ничего не добавляют, а строку удлиняют. */
function uptimeText(sec: number) {
    if (!(sec > 0)) return null
    if (sec < 60) return S.home.s(sec)
    const m = Math.floor(sec / 60) % 60
    const h = Math.floor(sec / 3600) % 24
    const d = Math.floor(sec / 86400)
    if (d) return S.home.dCh(d, h)
    if (h) return S.home.chMin(h, m)
    return S.home.min(m)
}

const DOT: Record<string, string> = {
    good: 'bg-success',
    warn: 'bg-warning',
    bad: 'bg-destructive',
    idle: 'bg-muted-foreground',
}
const RING: Record<string, string> = {
    good: 'ring-success/25',
    warn: 'ring-warning/25',
    bad: 'ring-destructive/25',
    idle: 'ring-muted-foreground/20',
}

/** Что известно про выходы СНАРУЖИ: страна, внешний адрес и отклик.
 *
 *  ОДИН ЗАХОД НА ВСЮ СТРАНИЦУ, а не по запросу из каждого блока: колонка выходов и колонка
 *  правил называют одну и ту же локацию, и два опроса показали бы два разных мгновения.
 *
 *  НЕ ПО КРУГУ. Проверка отклика упирается в таймаут до шести секунд на выход, а измерение
 *  страны уходит наружу; гонять их каждые пять секунд значило бы держать роутер занятым
 *  проверками вместо работы. Один проход, когда выходы стали известны, дальше — по кнопке. */
function useFacts(live: Live) {
    const [facts, setFacts] = useState<Record<string, Facts>>({})
    const [busy, setBusy] = useState(false)
    /* Мерить нечем: на роутере нет curl. Без этого признака пустые страна и отклик выглядели
     * так же, как молчащий выход (splify2#32). */
    const [noCurl, setNoCurl] = useState(false)
    const done = useRef('')
    /* Состояние читается через ссылку, а не из замыкания: проход по выходам живёт секунды —
     * шесть секунд таймаута на выход, — и за это время успевает приехать новый снимок. Взяв
     * `live` замыканием, проверка «этот выход сейчас перебирает узлы» смотрела бы на снимок
     * той минуты, когда её завели. */
    const now = useRef(live)
    now.current = live
    const outputs = live.status?.outputs || {}
    /* direct не меряется: он не уводит трафик никуда, отклик и страна у него — это отклик и
     * страна самого роутера, и ответ на другой вопрос. */
    const names = Object.keys(outputs).filter((n) => outputs[n].kind !== 'direct')
    /* В ключ входит УСТРОЙСТВО выхода, а не его состояние. При смене узла движок пересоздаёт
     * устройство туннеля, и прежнее измерение относится уже к другому месту — значит спросить
     * надо заново (с живого экрана: выбрали польский узел, а на экране осталась Эстония).
     *
     * А вот на «упал и поднялся» перемеривать нельзя: мигающий выход менял бы ключ каждые пять
     * секунд, и проверка запускалась бы по кругу — на экране «меряем…» не гасло вовсе. */
    const key = names.map((n) => `${n}:${outputs[n].device || ''}`).join(',')

    const measure = useCallback(async (list: string[], fresh: boolean) => {
        setBusy(true)
        try {
            /* Выход, который прямо сейчас перебирает узлы, не спрашиваем: устройства ещё нет,
             * мерить нечего. Неподнятый — тоже, и по другой причине: запрос уйдёт МИМО
             * туннеля и вернёт страну самого роутера, то есть неправду. */
            const alive = list.filter((n) => {
                const st = now.current.status?.outputs?.[n]
                return st?.probe?.state !== 'probing' && st?.up !== false
            })
            /* ОДИН вызов на выход, и он же приносит отклик: запрос идёт через устройство
             * выхода, а значит его собственное время ответа и есть задержка этого выхода.
             * Отдельная проверка отклика поднимала соединение второй раз, через движок, и
             * стоила на роутере девятнадцати секунд на выход — на четырёх выходах это минута
             * с надписью «меряем…» и пустыми строками. */
            await Promise.all(
                alive.map(async (n) => {
                    try {
                        const g = await deadline(rpc.outboundGeo(n, fresh), 25000)
                        setNoCurl(g.curl === false)
                        setFacts((f) => ({
                            ...f,
                            [n]: {
                                geo: g.cc || g.ip ? { cc: g.cc, ip: g.ip } : f[n]?.geo,
                                ping: g.ms ? { ms: g.ms, state: 'ok' } : f[n]?.ping,
                            },
                        }))
                    } catch { /* не знаем — молчим: выдуманная страна хуже пустой строки */ }
                }),
            )
        } finally {
            setBusy(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (!key || done.current === key) return
        done.current = key
        void measure(names, false)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, measure])

    return { facts, busy, noCurl, refresh: () => void measure(names, true) }
}

export default function Home({
    live, onSection, onAddRule,
}: {
    live: Live
    onSection: (s: SectionId) => void
    /** «Добавить правило» именно ЗАВОДИТ правило и открывает его — см. Console. */
    onAddRule?: () => void
}) {
    const v = verdictNow(live)
    const { spec } = usePending()
    const { facts, busy, noCurl, refresh } = useFacts(live)
    const outputs = Object.entries(live.status?.outputs || {})

    /* R-064: «движок стоит, а туннеля нет». Состояние, при котором интерфейс работает, правила
     * на месте, счётчики идут — а наружу не уходит ничего, потому что выхода нет ни одного
     * (splify2#5). До этой строки такая настройка выглядела исправной.
     *
     * Выходом считается всё, кроме `direct`: `direct` не уводит трафик, он оставляет пакет на
     * обычном пути, и роутер с одним таким выходом ровно так же никуда не маршрутизирует. */
    const routed = outputs.filter(([, o]) => o.kind !== 'direct')
    /* Устройство проверяется ТОЛЬКО у kind=interface: устройство vless-выхода создаёт сам
     * движок при подъёме, и его отсутствие значит «движок не поднялся» — про это говорят
     * предупреждения steer и проверки состояния, а не эта строка. */
    const named = outputs
        .filter(([, o]) => o.kind === 'interface')
        .map(([name, o]) => ({ name, want: o.devices?.length ? o.devices : o.device ? [o.device] : [] }))
    /* Список туннельных устройств системы. Спрашивается не по кругу, а когда меняется САМ
     * вопрос — набор устройств, названных выходами. */
    const wantKey = named.map((n) => `${n.name}:${n.want.join('|')}`).join(',')
    const [sysDevs, setSysDevs] = useState<Set<string> | null>(null)
    useEffect(() => {
        if (!wantKey) return
        let stop = false
        rpc.devices()
            .then((r) => { if (!stop) setSysDevs(new Set((r.devices || []).map((d) => d.name))) })
            /* Не знаем — молчим: предупреждение по неполученному ответу было бы тревогой на
             * исправном роутере, а это ровно то, чего в R-064 велено не делать. */
            .catch(() => { if (!stop) setSysDevs(null) })
        return () => { stop = true }
    }, [wantKey])
    /* Двумя источниками, и это не перестраховка. `rpc.devices()` отбирает ТУННЕЛЬНЫЕ устройства
     * (ARPHRD_NONE/TUNNEL), поэтому по нему одному мост или физический порт выглядел бы
     * «отсутствующим в системе» — а он в системе есть. `live.devs` — полный список интерфейсов
     * из общего опроса, он же и снимает устаревание. */
    const inSystem = (d: string) => (sysDevs?.has(d) ?? false) || d in (live.devs || {})
    /* Молчим, пока систему знаем не целиком, и пока состояние не пришло: пустой `outputs` до
     * первого ответа движка — это «ещё не знаем», а не «выходов нет». */
    const known = live.status !== null && !live.error && !live.phase
    const dead =
        known && sysDevs !== null && live.devs !== null
            ? named.filter((n) => n.want.length > 0 && n.want.every((d) => !inSystem(d)))
            : []
    /* Выход есть, а устройства ему не назначено вовсе — тот же результат и без списка
     * устройств: маршрутизировать нечем. */
    const noDevice = known ? named.filter((n) => n.want.length === 0) : []
    const nowhere = known && routed.length === 0

    /* Bode 26.10: раскладка по образцу главной приложения Splify2 для телефона.
     *
     * Первой стоит КАРТОЧКА СОСТОЯНИЯ: крупный вердикт с точкой, строка счётчиков под ним и
     * всё, что к вердикту прилагается, — находки, совет, отказ движка, «трафику некуда идти»,
     * предупреждения steer. В приложении предупреждения тоже живут внутри карточки состояния,
     * а не отдельными плашками над страницей: это части одного ответа на «работает ли», и
     * разнесённые по экрану они читались как три разных сообщения. Действие карточки — у её
     * нижнего края, за волосяной линией, как главный выключатель в приложении.
     *
     * Ниже — две карточки рядом на широком экране (правила слева, выходы справа) и друг под
     * другом на узком. Колонок две по той же причине, что и раньше (см. шапку файла), но
     * каждая теперь устроена как карточка приложения: строка «заголовок — подпись справа»,
     * под ней однородные строки через волосяную линию. */
    return (
        <div className="space-y-4">
            {specV2Unsupported(live.status) && (
                <Block className="border-destructive">
                    <CardHead title={S.home.yadroNeChitaetNovuyu} />
                    <p className="text-sm">
                        {S.home.etotInterfeysZapisyvaetNastroyki}</p>
                </Block>
            )}

            <Block>
                <div className="flex items-start gap-3">
                    {/* Кольцо вокруг точки — как в приложении: точка держит полный цвет, а
                        полупрозрачное кольцо того же тона видно и на тёмной карточке. */}
                    <span
                        className={`mt-2.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${DOT[v.tone]} ${RING[v.tone]}`}
                        aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                        <h1 className="sp-verdict">{v.text}</h1>
                        {/* Счётчики написаны подписью, двоеточием и числом — тогда не нужны
                            склонения после числительного, а перевод сводится к переводу подписи. */}
                        <p className="mt-1 text-[13px] text-muted-foreground">
                            {live.net && (
                                <>
                                    {S.home.ustroystvVSeti}{live.net.active_clients}
                                    {uptimeText(live.net.uptime) && (
                                        <> {S.home.vremyaRaboty}{uptimeText(live.net.uptime)}</>
                                    )}
                                </>
                            )}
                        </p>
                    </div>
                </div>

                {/* Находка — одной строкой и с дорогой к ней. Текст находки здесь НЕ печатается:
                    он принадлежит движку и живёт в диагностике целиком. */}
                {/* `> 0`, а не просто `&&`: нуль в JSX печатается как «0», и на исправном роутере
                    под вердиктом висела одинокая цифра — поймано на снимке живого роутера. */}
                {!live.phase && ((live.diag?.fail ?? 0) > 0 || (live.diag?.warn ?? 0) > 0) && (
                    <button
                        type="button"
                        onClick={() => onSection('diag')}
                        className={[
                            'flex w-full items-center gap-2 rounded-xl border p-3 text-left text-[13px] transition-colors',
                            live.diag?.fail
                                ? 'border-destructive/40 bg-destructive/10'
                                : 'border-warning/40 bg-warning/10',
                        ].join(' ')}
                    >
                        <TriangleAlert
                            className={`h-4 w-4 shrink-0 ${live.diag?.fail ? 'text-destructive' : 'text-warning-fg'}`}
                            aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">{v.why}</span>
                        <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                            {S.home.diagnostika}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                    </button>
                )}

                {/* R-030/I-039: «советов: N» было счётчиком без содержания и без дороги к нему.
                    Строка называет первый совет и ведёт туда, где лежат остальные. */}
                {v.tone === 'good' && v.notes.length > 0 && (
                    <button
                        type="button"
                        onClick={() => onSection('diag')}
                        className="block w-full text-left text-xs text-muted-foreground underline decoration-dotted"
                    >
                        {v.notes.length > 1 ? `${v.why}: ` : S.home.sovet}
                        {v.notes[0].what}
                    </button>
                )}

                {/* Движок не отвечает — причина названа заголовком выше, второй раз не пишем. */}
                {v.tone === 'bad' && live.error && (
                    <p className="text-[13px] text-destructive">{live.error}</p>
                )}

                {/* «Трафику некуда идти» — R-064. Условие узкое нарочно: либо выходов нет вовсе,
                    либо устройство, названное выходом, отсутствует в системе. */}
                {(nowhere || noDevice.length > 0 || dead.length > 0) && (
                    <div className="rounded-xl border border-warning/40 bg-warning/10 p-3">
                        <h2 className="sp-sub flex items-center gap-2 text-warning-fg">
                            <TriangleAlert className="h-4 w-4" aria-hidden="true" /> {S.home.trafikuNekudaIdti}</h2>
                        {nowhere ? (
                            <p className="mt-2 text-xs">
                                {S.home.vyhodovNetNiOdin}{' '}
                                <button
                                    type="button"
                                    onClick={() => onSection('vpn')}
                                    className="underline decoration-dotted"
                                >
                                    VPN
                                </button>
                                {S.home.aSamoTunnelnoeUstroystvo}</p>
                        ) : (
                            <ul className="mt-2 space-y-2 text-xs">
                                {noDevice.map((n) => (
                                    <li key={n.name}>
                                        {S.home.vyhod}<span className="font-medium">{n.name}</span> {S.home.nePodnyatUstroystvoEmu}</li>
                                ))}
                                {dead.map((n) => (
                                    <li key={n.name}>
                                        {S.home.vyhod}<span className="font-medium">{n.name}</span> {S.home.nePodnyat}{' '}
                                        {n.want.length > 1 ? S.home.ustroystv : S.home.ustroystva}{' '}
                                        <span className="font-mono">{n.want.join(', ')}</span> {S.home.netVSistemeTunnel}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {/* Предупреждения движка — дословно и с последствием. Это единственное место, где
                    текст приходит от steer как есть: сокращать его нельзя, там названа причина. */}
                {(live.status?.warnings?.length ?? 0) > 0 && (
                    <div className="rounded-xl border border-warning/40 bg-warning/10 p-3">
                        <h2 className="sp-sub flex items-center gap-2 text-warning-fg">
                            <TriangleAlert className="h-4 w-4" aria-hidden="true" /> {S.home.preduprezhdeniyaSteer}</h2>
                        <ul className="mt-2 space-y-2 text-xs">
                            {live.status!.warnings!.map((w, i) => (
                                <li key={i}>
                                    {w.channel && <span className="font-medium">{w.channel}: </span>}
                                    {w.text}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                <div className="flex justify-end border-t border-border pt-3">
                    <Button onClick={() => onAddRule?.()} className="w-full sm:w-auto">
                        <Plus className="h-4 w-4" aria-hidden="true" /> {S.home.dobavitPravilo}</Button>
                </div>
            </Block>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:items-start">
                <div className="min-w-0 space-y-4">
                    <RulesBoard
                        live={live}
                        channels={spec?.channels}
                        facts={facts}
                        onSection={onSection}
                    />
                    <ExplainCard />
                </div>
                <div className="min-w-0">
                    <OutputsColumn live={live} facts={facts} busy={busy} noCurl={noCurl} onRefresh={refresh} />
                </div>
            </div>
        </div>
    )
}

/** Правила: имя, нынешний выход, потраченный трафик и запас.
 *
 *  ПОРЯДОК — ЭТО ПРИОРИТЕТ, поэтому строки идут номерами и в том же порядке, что в спеке:
 *  адрес достаётся верхнему совпавшему правилу, и экран, который спрятал бы порядок, спрятал
 *  бы единственное, что человеку обязательно понимать.
 *
 *  СЧЁТЧИК ПРИНАДЛЕЖИТ НАБОРУ, А НЕ ПРАВИЛУ. Правила, совпадающие по выходу, виду списка и
 *  клиентам, движок сводит в ОДИН набор и одно правило ядра — на роутере с 64 МБ это разница
 *  между «работает» и «не влезло». Разделить их трафик нечем, и там, где счётчик общий, это
 *  сказано словом, а не поделено поровну выдумкой. */
function RulesBoard({
    live, channels, facts, onSection,
}: {
    live: Live
    channels?: Channel[]
    facts: Record<string, Facts>
    onSection: (s: SectionId) => void
}) {
    const sets = live.status?.channels || []
    /* Набор по имени правила: сначала тот, что назвал правило участником, иначе одноимённый —
     * движок старее перечня участников поля `channels` не печатает. */
    const setOf = (name: string): ChannelStatus | undefined =>
        sets.find((s) => (s.channels || []).includes(name)) || sets.find((s) => s.name === name)

    /* Строки берутся из СПЕКИ: в ней лежит порядок (он же приоритет) и выключенные правила,
     * которых движок не компилирует вовсе. Пока её нет — а её может не быть и потому, что
     * файл не прочитался, — показываем наборы движка: работающие правила важнее, чем ожидание
     * файла настройки. Пустая спека при живых наборах — это тот же случай, а не «правил нет»:
     * ядро маршрутизирует, и промолчать об этом значило бы соврать.
     *
     * НО ИМЕНА БЕРУТСЯ У ПРАВИЛ, А НЕ У НАБОРА. `name` набора — служебное имя цепочки nft
     * (`wg0_dom`, `wg0_ip_c0_p1`), которое человек не давал и нигде больше не видит; имена
     * его правил движок печатает рядом, полем `channels` (контракт steer §2, и там же сказано
     * показывать человеку именно их). Спека приезжает вторым вызовом, поэтому на первых
     * кадрах — при открытии и при каждом обновлении страницы — на месте правил на секунду
     * мелькали служебные имена, а потом подменялись человеческими. Набор из двух правил и
     * строк даёт две: у них общий счётчик, и об этом говорит сама строка (см. RuleRow).
     * Поля нет — движок старее перечня участников, и тогда служебное имя это всё, что есть. */
    const rows: { name: string; out: string; enabled: boolean }[] = channels?.length
        ? channels.map((c) => ({ name: c.name, out: c.out, enabled: c.enabled !== false }))
        : sets.flatMap((s) =>
              (s.channels?.length ? s.channels : [s.name]).map((name) => ({
                  name,
                  out: s.out,
                  enabled: true,
              })),
          )

    /* КАРТОЧКА С ЗАГОЛОВКОМ ВНУТРИ — как «Трафик по правилам» в приложении.
     *
     *  Раньше правила и выходы стояли разделами: заголовок над карточкой, а у правил ещё и
     *  карточка без шапки. Выровнять два столбца это помогло, но язык был свой, не приложения.
     *  Теперь у обоих столбцов одно и то же, и уже по образцу: карточка открывается строкой
     *  «заголовок слева — подпись справа» (CardHead), под ней строки через волосяную линию.
     *  Первые строки столбцов по-прежнему совпадают по высоте — у обеих карточек одна шапка.
     *
     *  Полоска под строкой — доля трафика правила относительно самого нагруженного, тоже из
     *  приложения: сравнить «куда ушло больше» глазами быстрее, чем прочитать шесть чисел. У
     *  правил с общим счётчиком полоски одинаковые, и это правда — счётчик у них один. */
    const load = (name: string) => {
        const st = setOf(name)
        return (st?.down_bytes ?? 0) + (st?.bytes ?? 0)
    }
    const peak = Math.max(0, ...rows.map((r) => load(r.name)))
    return (
        <Block>
            <CardHead title={S.home.pravila} meta={S.home.sZagruzkiRoutera} />
            {rows.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                    {S.home.pravilNetVesTrafik}</p>
            ) : (
                <ul className="divide-y divide-border">
                    {rows.map((r, i) => (
                        <RuleRow
                            phase={live.phase}
                            key={`${r.name}-${i}`}
                            n={i + 1}
                            row={r}
                            set={setOf(r.name)}
                            st={live.status?.outputs?.[r.out]}
                            facts={facts[r.out]}
                            share={peak > 0 ? load(r.name) / peak : 0}
                            onSection={onSection}
                        />
                    ))}
                </ul>
            )}
        </Block>
    )
}

function RuleRow({
    n, row, set, st, facts, phase, share, onSection,
}: {
    n: number
    row: { name: string; out: string; enabled: boolean }
    set?: ChannelStatus
    st?: OutputStatus
    facts?: Facts
    phase: Live['phase']
    /** Доля трафика относительно самого нагруженного правила, 0…1. */
    share: number
    onSection: (s: SectionId) => void
}) {
    /* Кандидаты выхода в порядке предпочтения: первый здоровый побеждает, поэтому нынешний —
     * это `device`, поставленный движком, а не первый в списке. */
    /* Группа (спека v2): кандидаты — её члены, а несёт трафик выбранный член, не устройство. */
    const grp = st?.group
    const cands = grp ? grp.members : st?.devices?.length ? st.devices : st?.device ? [st.device] : []
    const active = grp ? (grp.selected ?? undefined) : st?.device || (isTunnelKind(st?.kind) ? undefined : cands[0])
    /* Части пула зовутся подписками, а не «vpn-2»: имя части — служебное, человек его не давал. */
    const { spec } = usePending()
    const remembered = subsRemembered() ?? []
    const label = (d: string) => {
        const p = spec?.outputs?.[d]
        if (!p || !isPart(p)) return d
        const s = remembered.find((x) => x.path === p.sub_file)
        return s?.title || s?.name || S.home.podpiska
    }
    const spare = cands.filter((d) => d !== active).map(label)
    const place = country(facts?.geo?.cc)
    /* Выход читается слева направо: имя выхода → через что он идёт сейчас. Устройство
     * повторяет имя выхода чаще, чем нет (его так и заводят), и строка «vless vless» —
     * это одно и то же слово дважды. Показываем устройство, только когда оно другое. */
    const via = place || (active && active !== row.out ? active : '')

    const down = set?.down_bytes === undefined ? null : human(set.down_bytes)
    const up = set?.bytes === undefined ? null : human(set.bytes)
    const shared = (set?.channels?.length ?? 0) > 1
    const reserve = spare.length
        ? S.home.zapas(spare.join(', '))
        : st && st.kind !== 'direct'
          ? S.home.esliVseUpalo(ON_FAIL_TEXT[st.on_fail || 'drop'])
          : ''

    /* Строка устроена как строка «Трафика по правилам» приложения: имя слева, счётчики у
     * правого края той же строки, под ними — куда правило ведёт сейчас, полоска доли и
     * самой мелкой строкой запас. Номер стоит слева столбиком: порядок — это приоритет. */
    return (
        <li className={`flex gap-3 py-3 first:pt-1 last:pb-1 ${row.enabled ? '' : 'opacity-60'}`}>
            <span className="w-4 shrink-0 pt-px text-xs tabular-nums text-muted-foreground">{n}</span>
            <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-baseline gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">{row.name}</span>
                        {!row.enabled && (
                            <span className="shrink-0 text-[11px] text-muted-foreground">{S.home.vyklyucheno}</span>
                        )}
                        {/* Пока применяется — набор и должен отсутствовать: таблица пересобирается. */}
                        {row.enabled && set && !set.live && !phase && (
                            <span className="shrink-0 text-[11px] text-destructive">{S.home.netVYadreLinux}</span>
                        )}
                    </span>
                    {/* Счётчик принадлежит НАБОРУ. Там, где движок свёл несколько правил в один
                        набор, это сказано словом ниже, а не поделено поровну выдумкой. */}
                    <span className="flex shrink-0 gap-2 text-xs tabular-nums text-muted-foreground">
                        <span>↓ {down ?? '—'}</span>
                        <span>↑ {up ?? '—'}</span>
                    </span>
                </div>
                <button
                    type="button"
                    onClick={() => onSection('vpn')}
                    className="flex min-w-0 max-w-full items-baseline gap-1.5 text-left"
                >
                    <ArrowRight className="h-3 w-3 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
                    <Flag cc={facts?.geo?.cc} />
                    <span className="min-w-0 truncate text-[13px]">{row.out}</span>
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                        {st?.kind === 'direct'
                            ? S.home.napryamuyu
                            : [
                                  via,
                                  facts?.ping && facts.ping.ms >= 0 ? S.home.ms(facts.ping.ms) : null,
                                  grp && !grp.selected ? S.home.chlenyNeOtvechayut : null,
                                  outDownWord(st),
                              ]
                                  .filter(Boolean)
                                  .join(' · ') || S.home.nePodnyat2}
                    </span>
                </button>
                <Meter value={share} muted={st?.kind === 'direct'} />
                {(shared || reserve) && (
                    <div className="flex flex-wrap gap-x-3 text-[11px] text-subtle">
                        {shared && (
                            <span title={S.home.obschiySchetchik(set!.channels!.join(', '))}>
                                {S.home.schetchikObschiy}</span>
                        )}
                        {/* Запас — не украшение: пока он есть, падение туннеля не останавливает
                            трафик, а когда его нет, решает «если всё упало». */}
                        {reserve && <span>{reserve}</span>}
                    </div>
                )}
            </div>
        </li>
    )
}

/** Столбец выходов: по блоку на подписку и по блоку на свой туннель.
 *
 *  Порядок постоянный — подписка, затем туннели по имени: блоки, переставляющиеся местами при
 *  каждом опросе, человек перечитывает заново каждый раз. */
function OutputsColumn({
    live, facts, busy, noCurl, onRefresh,
}: {
    live: Live
    facts: Record<string, Facts>
    busy: boolean
    noCurl?: boolean
    onRefresh: () => void
}) {
    /* Какой выход к какой подписке относится — знает СПЕКА, а не состояние: `steer status`
     * поля `sub_file` не печатает вовсе. Пока группировка шла по состоянию, ни одна локация
     * не попадала ни в один блок — на экране оставался голый остаток. */
    const { spec } = usePending()
    const outputs = Object.entries(live.status?.outputs || {})
    const vless = outputs.filter(([, o]) => isTunnelKind(o.kind))
    const tunnels = outputs.filter(([, o]) => o.kind === 'interface')

    /** Подписки роутера. Их бывает несколько, и блок полагается КАЖДОЙ: остаток, срок и
     *  локации у них свои, а один блок на все смешал бы числа двух панелей.
     *
     *  null — бэкенд постарше, который про перечень не знает: тогда подписка одна и блок
     *  один, как было. */
    /* Начинается перечень С ЗАПОМНЕННОГО. Вызов `sub_list` уходит после того, как загрузятся
     * LuCI, загрузчик и бандл, и до его ответа блоков подписок нет вовсе — а появившись, они
     * разъезжают всё, что под ними, тем заметнее, чем подписок больше. Запомнены только
     * имена и пути; числа каждая подписка помнит сама (см. lib/subs.ts). */
    const [subs, setSubs] = useState<
        { name: string; title?: string; kind?: string; path: string; quota?: SubQuota; link?: string }[] | null
    >(() => subsRemembered())
    useEffect(() => {
        let stop = false
        /* Не в первом пакете: uhttpd исполняет вызовы пакета подряд, и перечень подписок
         * (треть секунды на роутере) стоял ПЕРЕД `live`, задерживая первый вердикт. Блоки
         * рисуются с запомненного, свежий перечень приезжает следующим пакетом. */
        const t = setTimeout(() => rpc.subList()
            .then((r) => {
                if (stop) return
                setSubs(r.subs || [])
                subsRemember(r.subs)
            })
            /* Бэкенд постарше перечня не знает — подписка одна, и блок ей рисуется прежним
             * способом. Запомненное при этом снимается: иначе страница рисовала бы блоки
             * подписок, о которых этот роутер рассказать уже не может. */
            .catch(() => { if (!stop) { setSubs(null); subsRemember([]) } }), 500)
        return () => { stop = true; clearTimeout(t) }
    }, [])
    /** Виды туннельных устройств (WireGuard, AmneziaWG) — бейджам своих туннелей. Тем же
     *  отложенным заходом, что перечень подписок: первый вердикт страницы его не ждёт. */
    const [devKinds, setDevKinds] = useState<Record<string, string>>({})
    useEffect(() => {
        let stop = false
        const t = setTimeout(() => rpc.devices()
            .then((d) => {
                const m = devKindsOf(d.devices)
                if (m && !stop) setDevKinds(m)
            })
            .catch(() => {}), 500)
        return () => { stop = true; clearTimeout(t) }
    }, [])

    /* Ни подписки, ни туннеля — столбца нет вовсе. Пустой столбец с заголовком «Выходы»
     * занимал бы место ради строки «ничего нет», а про отсутствие выходов уже сказано над
     * столбцами, и сказано с последствием («трафику некуда идти»). */
    if (vless.length === 0 && tunnels.length === 0 && !subs?.length) return null

    /* ОДНА КАРТОЧКА «ВЫХОДЫ», как на главной приложения: заголовок с действием справа, под
     * ним выходы строками через волосяную линию. Подписка внутри — своим участком (остаток,
     * срок и локации строками), свой туннель — одной строкой с точкой состояния. Прежде
     * каждая подписка и каждый туннель были отдельной карточкой, и три карточки подряд
     * читались как три разных раздела, хотя это один перечень «чем роутер выходит наружу». */
    return (
        <Block>
            <CardHead
                title={S.home.vyhody}
                action={
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={busy}
                        className="flex shrink-0 items-center gap-1 text-xs text-primary underline decoration-dotted disabled:opacity-60"
                    >
                        {busy ? (
                            <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
                        ) : null}
                        {busy ? S.home.meryaem : S.home.proverit}
                    </button>
                }
            />
            {noCurl && (
                <p className="text-xs text-warning-fg">
                    {S.home.neUstanovlenCurlStrana}</p>
            )}

            <div className="divide-y divide-border">
                {/* По участку на КАЖДУЮ ПОДПИСКУ: остаток и сроки у них свои, и один участок на
                    две панели смешал бы их числа. Локации — строками внутри своей подписки. */}
                {subs === null
                    ? vless.length > 0 && (
                          <SubBlock outs={vless.map(([name, st]) => ({ name, st, facts: facts[name], phase: live.phase, out: spec?.outputs?.[name] }))} />
                      )
                    : subs.map((s) => (
                          <SubBlock
                              key={s.name}
                              sub={s}
                              outs={vless
                                  .filter(([n, o]) => (spec?.outputs?.[n]?.sub_file || o.sub_file || '') === s.path)
                                  .map(([name, st]) => ({
                                      name, st, facts: facts[name], phase: live.phase,
                                      out: spec?.outputs?.[name],
                                      /* Локация, взятая в пул, так и подписана: иначе строка под
                                         подпиской и строка в блоке пула читались как два туннеля.
                                         Выключенная проверка сертификата — бейджем-предупреждением
                                         среди бейджей конфигурации (OutputCards, lib/badges.ts):
                                         это решение человека, и видно его там, где выход работает. */
                                      note: spec?.outputs?.[name]?.part_of ? S.home.vPule(spec.outputs[name].part_of) : undefined,
                                  }))}
                          />
                      ))}
                {tunnels.map(([name, st]) => {
                    /* Пул, собранный из локаций подписок, своей строки НЕ получает: его локации уже
                       стоят строками в участках своих подписок с приписью «в пуле …», а третья
                       запись с теми же местами владелец назвал лишней. Куда пул ведёт сейчас,
                       говорит строка правила слева. Свой туннель без частей — строкой, как прежде.

                       Прячется только пул, где частями подписок являются ВСЕ устройства. У
                       смешанного пула (свои awg1/awg2 плюс локация подписки) строка остаётся:
                       иначе состояние своих туннелей на обзоре не показано нигде (splify2#35). */
                    const o = spec?.outputs?.[name]
                    const devs = devList(o).length ? devList(o) : devList(st)
                    if (devs.length > 0 && devs.every((d) => isPart(spec?.outputs?.[d]))) return null
                    return (
                        <TunnelBlock
                            key={name} name={name} st={st} facts={facts[name]} phase={live.phase}
                            out={o} spec={spec} devKinds={devKinds}
                        />
                    )
                })}
            </div>
        </Block>
    )
}

/** «Куда пойдёт запрос» — единственный вопрос, который человек задаёт посреди работы, и
 *  отвечает на него ЖИВОЕ ядро, а не настройка. Поэтому поле здесь, на главной, а не в
 *  диагностике: спрашивают его до того, как решат, что что-то сломано. */
const SUGGESTED_DOMAINS = ['youtube.com', 'instagram.com', 'discord.com', 'rutracker.org']

function ExplainCard() {
    const [q, setQ] = useState('')
    const [answer, setAnswer] = useState<string | null>(null)
    const [asking, setAsking] = useState(false)

    async function ask(customQ?: string) {
        const address = (customQ !== undefined ? customQ : q).trim()
        if (!address) return
        if (customQ !== undefined) setQ(customQ)
        setAsking(true)
        try {
            const r = await rpc.explain(address)
            setAnswer(r.text)
        } catch (e) {
            setAnswer(String(e instanceof Error ? e.message : e))
        } finally {
            setAsking(false)
        }
    }

    const clear = () => {
        setQ('')
        setAnswer(null)
    }

    return (
        <Block>
            <CardHead title={S.home.kudaPoydetZapros} />
            <div className="flex flex-wrap gap-2">
                <div className="relative min-w-0 flex-1">
                    <input
                        value={q}
                        onChange={(e) => setQ(e.currentTarget.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void ask()}
                        placeholder={S.home.youtubeComKudaPoydet}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-8 font-mono text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    {(q || answer) && (
                        <button
                            type="button"
                            onClick={clear}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            aria-label={S.home.ochistit}
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>
                <Button onClick={() => void ask()} disabled={asking || !q.trim()}>
                    {asking ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                        <Search className="h-4 w-4" aria-hidden="true" />
                    )}
                    {asking ? S.home.sprashivaem : S.home.proverit2}
                </Button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>{S.home.primery}</span>
                {SUGGESTED_DOMAINS.map((domain) => (
                    <button
                        key={domain}
                        type="button"
                        onClick={() => void ask(domain)}
                        disabled={asking}
                        className="rounded-md border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] text-foreground hover:bg-muted transition-colors cursor-pointer"
                    >
                        {domain}
                    </button>
                ))}
            </div>

            {answer && (
                <pre className="overflow-x-auto rounded-xl border border-border bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                    {answer}
                </pre>
            )}
        </Block>
    )
}

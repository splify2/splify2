import { useCallback, useEffect, useState } from 'react'
import { LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Block, CardHead, DangerButton, FieldRow, KV } from '@/components/ui/layout'
import { notify } from '@/lib/notify'
import { rpc } from '@/lib/rpc'
import { human } from '@/lib/live'
import { isHttpUrl, isProxyLinks, isSubSource } from '@/lib/validate'
import { agoText } from '@/lib/quota'
import { subsRemember, subsRemembered } from '@/lib/subs'

import { S } from '@/copy'
/** «Подписки» (прежде «VLESS»): откуда берутся узлы — VLESS, hysteria2 и прокси steer-proxy.
 *
 *  ПОДПИСОК НЕСКОЛЬКО. Их и правда бывает несколько — у человека две панели, — и раньше это
 *  не выражалось ничем: файл узлов был один на роутер жёстко. Теперь у каждой своё имя, свой
 *  файл и свой остаток, а выход выбирает подписку, из которой берёт локацию.
 *
 *  Локации здесь НЕ выбираются: локация — свойство выхода, и выбирают её там, где выход
 *  собирают. Два места, назначающие узел, разошлись бы на первом же переключении.
 *
 *  Bode 26.10, раскладка по образцу экрана «Подписки» приложения Splify2: карточка подписки —
 *  название, ссылка, состояние, строка «Обновлять [как часто]», а внизу две кнопки в ряд:
 *  «Обновить» и обведённая красная «Удалить». Прежде обе стояли подчёркнутыми словами в строке
 *  заголовка, рядом с названием, и удаление читалось как ссылка. Новая подписка — своей
 *  карточкой с полями друг под другом и основной кнопкой во всю ширину. */

interface Sub {
    name: string
    title?: string
    url?: string
    kind?: 'url' | 'links' | 'none'
    path: string
    present: boolean
    bytes?: number
    mtime?: number
    used?: number
    /** Сколько ЛОКАЦИЙ подписки взято выходами: выход бывает пулом и берёт несколько. */
    used_nodes?: number
    /** Ссылка на продавца у опознанного источника. Опознаёт бэкенд (sub_brand в m-sub.sh),
     *  здесь она только рисуется. */
    link?: string
    /** Через сколько минут роутер обновляет подписку сам. 0 или нет поля — не обновляет. */
    auto?: number
    /** Когда роутер пытался обновить её в последний раз, секунды epoch. */
    auto_at?: number
}

/** Интервалы автообновления. Крайние — те же, что принимает бэкенд: полчаса и трое суток.
 *
 *  Списком, а не полем для числа: человек выбирает «как часто», а не «сколько минут», и
 *  свободное число здесь означало бы ещё и разбор ошибок ввода ради значения, которых
 *  осмысленных десяток. */
const AUTO_CHOICES: { min: number; label: string }[] = [
    { min: 0, label: S.vlessScreen.vruchnuyu },
    { min: 30, label: S.vlessScreen.kazhdye30Minut },
    { min: 60, label: S.vlessScreen.kazhdyyChas },
    { min: 120, label: S.vlessScreen.kazhdye2Chasa },
    { min: 180, label: S.vlessScreen.kazhdye3Chasa },
    { min: 360, label: S.vlessScreen.kazhdye6Chasov },
    { min: 720, label: S.vlessScreen.kazhdye12Chasov },
    { min: 1440, label: S.vlessScreen.razVSutki },
    { min: 2880, label: S.vlessScreen.razVDvoeSutok },
    { min: 4320, label: S.vlessScreen.razVTroeSutok },
]

/** Сколько осталось до следующего обновления. Роутер смотрит расписание раз в десять минут,
 *  поэтому «через 3 минуты» здесь честнее округлить вверх, чем обещать точную минуту. */
function nextText(auto: number, at: number | undefined): string | null {
    if (!auto || !at) return null
    const left = Math.round((at * 1000 + auto * 60000 - Date.now()) / 60000)
    if (left <= 0) return S.vlessScreen.obnovitsyaPriBlizhaysheyProverke
    if (left < 60) return S.vlessScreen.sleduyuscheeCherezMin(left)
    const h = Math.round(left / 60)
    if (h < 48) return S.vlessScreen.sleduyuscheeCherezCh(h)
    return S.vlessScreen.sleduyuscheeCherezD(Math.round(h / 24))
}

export default function VlessScreen() {
    /* Перечень рисуется С ЗАПОМНЕННОГО: пока `sub_list` идёт (а уходит он после загрузки
     * LuCI, загрузчика и бандла), экран показывал «Загрузка…» и затем разом выкладывал
     * карточки. Запомнены только имена и пути — числа у каждой подписки свои, см.
     * lib/subs.ts. */
    const [subs, setSubs] = useState<Sub[] | null>(() => subsRemembered())
    const [hwid, setHwid] = useState('')
    const [name, setName] = useState('')
    const [url, setUrl] = useState('')
    /** Ссылки прокси http(s):// — своим полем: в поле адреса подписки они скачивались бы как
     *  подписка (решение владельца). */
    const [proxy, setProxy] = useState('')
    const [busy, setBusy] = useState('')

    const load = useCallback(async () => {
        try {
            const r = await rpc.subList()
            setSubs(r.subs || [])
            setHwid(r.hwid || '')
            subsRemember(r.subs)
        } catch {
            /* Бэкенд постарше перечня не знает: тогда подписка одна, и спросить о ней можно
             * только прежним способом. */
            try {
                const one = await rpc.subInfo()
                const only = [
                    {
                        name: 'main',
                        url: one.url,
                        kind: one.kind,
                        path: one.path,
                        present: one.present,
                        bytes: one.bytes,
                        mtime: one.mtime,
                    },
                ]
                setSubs(only)
                setHwid(one.hwid || '')
                subsRemember(only)
            } catch {
                setSubs([])
                /* Роутер не ответил ни на перечень, ни на прежний вопрос об одной подписке.
                 * Запомненное снимается: рисовать по нему карточки, которых роутер не
                 * подтверждает, значит обещать кнопки «обновить» и «удалить» для того, чего
                 * может уже не быть. */
                subsRemember([])
            }
        }
    }, [])

    useEffect(() => { void load() }, [load])

    async function add() {
        const src = url.trim()
        const px = proxy.trim()
        if ((!src && !px) || !isSubSource(src)) {
            notify(S.vlessScreen.nuzhnaSsylkaPodpiskiHttp, 'warning')
            return
        }
        if (!isProxyLinks(px)) {
            notify(S.vlessScreen.nuzhnaSsylkaProksi, 'warning')
            return
        }
        if (px && src && isHttpUrl(src)) {
            notify(S.vlessScreen.podpiskaIProksiRaznymi, 'warning')
            return
        }
        /* Имя файла узлов — латиница и цифры, и придумывать его человек не обязан: название
         * подписки называет сама панель заголовком profile-title, а здесь достаточно
         * различить файлы. Занятое имя не переиспользуем — иначе новая подписка молча
         * затёрла бы старую (ровно это и случилось на стенде). */
        let n = (name.trim() || 'sub').replace(/[^A-Za-z0-9_-]/g, '') || 'sub'
        if (!name.trim() || subs?.some((x) => x.name === n)) {
            let i = subs?.length ? subs.length + 1 : 1
            const busyNames = new Set((subs || []).map((x) => x.name))
            while (busyNames.has(`sub${i}`)) i++
            n = `sub${i}`
        }
        if (!/^[A-Za-z0-9_-]{1,24}$/.test(n)) {
            notify(S.vlessScreen.imyaLatinitsaTsifryDefis, 'warning')
            return
        }
        setBusy('__adding__')
        try {
            const r = px ? await rpc.subSet(src, n, name.trim(), px) : await rpc.subSet(src, n, name.trim())
            if (!r.ok) { notify(r.error || S.vlessScreen.podpiskaNeSohranilas, 'error'); return }
            if (r.warn) notify(r.warn, 'warning')
            /* «Пригодных узлов нет» говорится СРАЗУ, а не выясняется потом по туннелю, который
             * «настроен и не работает»: подписка скачалась, файл на месте, а поднимется он
             * никогда. Число считает движок тем же кодом, которым читает подписку при подъёме,
             * поэтому это обещание, а не оценка. */
            else if (r.usable === 0) notify(S.vlessScreen.podpiskaSkachalasNoPrigodnyh, 'warning')
            setName('')
            setUrl('')
            setProxy('')
            await load()
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy('')
        }
    }

    async function refresh(s: Sub) {
        if (!s.url) return
        setBusy(s.name)
        try {
            const r = await rpc.subSet(s.url, s.name, s.title || '')
            if (!r.ok) notify(r.error || S.vlessScreen.podpiskaNeSkachalas, 'error')
            else if (r.warn) notify(r.warn, 'warning')
            else if (r.usable === 0) notify(S.vlessScreen.podpiskaObnovilasNoPrigodnyh, 'warning')
            await load()
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy('')
        }
    }

    async function setAuto(s: Sub, minutes: number) {
        setBusy(s.name)
        try {
            const r = await rpc.subAuto(s.name, minutes)
            if (!r.ok) { notify(r.error || S.vlessScreen.neVyshloZadatObnovlenie, 'error'); return }
            await load()
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy('')
        }
    }

    async function remove(s: Sub) {
        setBusy(s.name)
        try {
            const r = await rpc.subDel(s.name)
            if (!r.ok) { notify(r.error || S.vlessScreen.podpiskaNeUdalilas, 'warning'); return }
            await load()
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy('')
        }
    }

    if (subs === null) return <div className="p-5 text-sm text-muted-foreground">{S.vlessScreen.zagruzka}</div>

    return (
        <div className="space-y-4">
            {subs.map((s) => (
                <Block key={s.name}>
                    {/* Название опознанного источника ведёт к самому продавцу: из панели
                        человеку к нему всё равно идти — за продлением, за вопросом, —
                        и пусть идёт по нажатию, а не поиском в переписке.

                        Признак приходит с бэкенда полем `link` и разбирается ТАМ (sub_brand
                        в m-sub.sh). Здесь ссылка только рисуется: опознавать источник второй
                        раз по адресу подписки значило бы завести второй признак того же
                        самого, и однажды они разойдутся — молча, потому что и название, и
                        ссылка по отдельности выглядят исправными.

                        rel обязателен: target=_blank без noopener отдаёт открытой странице
                        доступ к window.opener, а ведёт ссылка наружу. */}
                    <div className="space-y-1">
                        <CardHead
                            title={
                                s.link ? (
                                    <a
                                        href={s.link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary underline decoration-dotted underline-offset-2"
                                    >
                                        {s.title || s.name}
                                    </a>
                                ) : (
                                    (s.title || s.name)
                                )
                            }
                        />
                        <div className="truncate font-mono text-xs text-subtle">
                            {s.kind === 'links' ? S.vlessScreen.ssylkiVless : s.url || '—'}
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {s.present ? (
                            <>
                                <span>{human(s.bytes || 0)}</span>
                                {s.mtime ? <span>{S.vlessScreen.obnovlena}{agoText(Date.now() - s.mtime * 1000)}</span> : null}
                            </>
                        ) : (
                            <span className="text-warning-fg">{S.vlessScreen.neSkachana}</span>
                        )}
                        {/* Число говорит, ЧЕМ ЗАНЯТА подписка, а не сколько в ней
                            узлов, и подпись обязана это называть. «выходов: 0» читалось
                            как «подписка ничего не даёт», хотя означало «её пока никто
                            не использует» — а это разные новости. Рядом стоит число
                            локаций: выход бывает пулом и берёт из подписки несколько
                            строк, и без него «выходов: 1» спорило с пулом, где человек
                            только что выбрал две. */}
                        <span>
                            {s.used
                                ? S.vlessScreen.vzyataVyhodami(s.used, s.used_nodes ? S.vlessScreen.nodesUsed(s.used_nodes) : '')
                                : S.vlessScreen.neIspolzuetsya}
                        </span>
                    </div>
                    {/* Обновление по часам есть только у подписки: вставленные руками
                        ссылки обновлять неоткуда. */}
                    {s.kind === 'url' && (
                        <div className="border-t border-border pt-1">
                            <FieldRow label={S.vlessScreen.obnovlyat} caption={nextText(s.auto || 0, s.auto_at) || undefined}>
                                <select
                                    id={`auto-${s.name}`}
                                    value={String(s.auto || 0)}
                                    disabled={busy === s.name}
                                    onChange={(e) => void setAuto(s, Number(e.currentTarget.value))}
                                    className="h-[38px] w-full rounded-lg border border-border bg-background px-3 text-sm disabled:opacity-60"
                                >
                                    {AUTO_CHOICES.map((c) => (
                                        <option key={c.min} value={String(c.min)}>
                                            {c.label}
                                        </option>
                                    ))}
                                </select>
                            </FieldRow>
                        </div>
                    )}
                    <div className={`grid gap-2 ${s.kind === 'url' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        {s.kind === 'url' && (
                            <Button
                                variant="outline"
                                className="h-10 w-full"
                                onClick={() => void refresh(s)}
                                disabled={busy === s.name}
                            >
                                {busy === s.name ? (
                                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                                ) : (
                                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                                )}
                                {busy === s.name ? S.vlessScreen.obnovlyaem : S.vlessScreen.obnovit}
                            </Button>
                        )}
                        <DangerButton
                            full
                            onClick={() => void remove(s)}
                            disabled={busy === s.name}
                            label={S.vlessScreen.udalit(s.title || s.name)}
                        >
                            {busy === s.name ? (
                                <LoaderCircle className="animate-spin" aria-hidden="true" />
                            ) : (
                                <Trash2 aria-hidden="true" />
                            )}
                            {busy === s.name ? S.vlessScreen.udalyaem : S.vlessScreen.udalit2}
                        </DangerButton>
                    </div>
                </Block>
            ))}

            <Block>
                <CardHead title={S.vlessScreen.dobavitPodpisku} />
                <div className="grid gap-2 sm:grid-cols-[10.5rem_minmax(0,1fr)]">
                    <input
                        value={name}
                        onChange={(e) => setName(e.currentTarget.value)}
                        placeholder={S.vlessScreen.imyaNeobyazatelno}
                        aria-label={S.vlessScreen.imyaPodpiski}
                        className="h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm"
                    />
                    <input
                        value={url}
                        onChange={(e) => setUrl(e.currentTarget.value)}
                        onKeyDown={(e) => e.key === 'Enter' && add()}
                        placeholder={S.vlessScreen.ssylkaPodpiskiIliVless}
                        aria-label={S.vlessScreen.ssylkaPodpiski}
                        className="h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3 font-mono text-[13px]"
                    />
                    <input
                        value={proxy}
                        onChange={(e) => setProxy(e.currentTarget.value)}
                        onKeyDown={(e) => e.key === 'Enter' && add()}
                        placeholder={S.vlessScreen.proksiHttpPlaceholder}
                        aria-label={S.vlessScreen.ssylkaProksi}
                        className="h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3 font-mono text-[13px] sm:col-start-2"
                    />
                </div>
                <Button className="h-10 w-full" onClick={add} disabled={!!busy}>
                    {busy === '__adding__' ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                        <Plus className="h-4 w-4" aria-hidden="true" />
                    )}
                    {busy === '__adding__' ? S.vlessScreen.dobavlyaem : S.vlessScreen.dobavit}
                </Button>
            </Block>

            {hwid && (
                <Block>
                    <KV k="HWID" v={<span className="select-all font-mono text-muted-foreground">{hwid}</span>} />
                </Block>
            )}
        </div>
    )
}

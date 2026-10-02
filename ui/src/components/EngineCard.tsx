import { useEffect, useRef, useState } from 'react'
import { Check, Download, Loader2 } from 'lucide-react'
import { Block, CardHead, KV } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { rpc } from '@/lib/rpc'
import { engineAction, engineTooOld, type Releases, releaseName } from '@/lib/engine'

import { S } from '@/copy'
// Установка движка из интерфейса.
//
// Зачем это здесь, а не в установочном скрипте (он тоже есть). Движок — отдельный пакет, и
// какой из двух вариантов нужен, зависит от того, поднимает ли туннель сам движок. Это выбор
// ЧЕЛОВЕКА, а не пакетного менеджера: зависимость apk умеет только «нужен steer», и угадав
// за него, мы либо кладём лишнее, либо не кладём нужное — и тогда человек получает «выход
// vless не работает» без всякого объяснения, уже настроив всё остальное.
//
// Поэтому объяснение стоит РЯДОМ с выбором, а не в документации: тот, кто открыл интерфейс,
// в документацию не пошёл.

interface Props {
    /** Что сейчас установлено. null — ещё не спросили. */
    engine: { present: boolean; vless: boolean; arch?: string; version?: string; min_version?: string } | null
    /** Что можно поставить. Приходит сверху, а не запрашивается здесь: тот же ответ нужен
     *  левой колонке, чтобы её кнопка не обещала обновление, которого нет (I-038). */
    releases: Releases | null
    onInstalled: () => void
}

export default function EngineCard({ engine, releases, onInstalled }: Props) {
    const versions = releases?.versions ?? null
    const [ver, setVer] = useState('')
    /* Вариант сборки — от ТОГО, ЧТО СТОИТ, а не «всегда расширенный».
     *
     * Здесь было `useState(true)`, и карточка рисовала намерение вместо состояния: у
     * человека с базовой сборкой галочка всё равно стояла на расширенной. Стоило это не
     * косметики — кнопка «Обновить» ставила ДРУГОЙ вариант, чем был, и базовая сборка молча
     * превращалась в расширенную (лишние 250 КБ на флеше там, где их берегут), а карточка до
     * этого момента показывала неправду.
     *
     * Выбор человека при этом главнее показаний: тронул радиокнопку — дальнейшие ответы
     * `engine` его выбор не двигают, иначе обновление состояния переставляло бы галочку
     * прямо под рукой. */
    const [ext, setExt] = useState(true)
    const extChosen = useRef(false)
    useEffect(() => {
        if (!extChosen.current && engine?.present) setExt(engine.vless)
    }, [engine?.present, engine?.vless])
    const [busy, setBusy] = useState(false)
    const action = engineAction(engine, releases)
    // Движок младше того, под который собран интерфейс, — см. engineTooOld.
    const tooOld = engineTooOld(engine)

    // Первая в списке — самая свежая: релизы отдаются от новых к старым.
    useEffect(() => {
        if (versions?.length) setVer((v) => v || versions[0])
    }, [versions])

    async function install() {
        if (!ver) { notify(S.engineCard.vyberiteVersiyu, 'warning'); return }
        setBusy(true)
        try {
            const r = await rpc.steerInstall(ver, ext)
            if (!r.ok) throw new Error(r.error || S.engineCard.neUstanovilos)
            // Пакет встал — это ещё не «работает». apk остановил сервис, а поднять его
            // обратно должен был restart, и rpcd отдельно сообщает, получилось ли. Пока
            // это поле не показывали, неподнявшийся движок отчитывался тем же зелёным
            // «Движок установлен» — при уже снесённой таблице nft (I-053).
            if (r.restarted === false) {
                notify(
                    `${S.engineCard.paketUstanovlen}: ${r.installed}. ${S.engineCard.yadroPriEtomNe}`,
                    'warning',
                )
            } else {
                // via — путь, которым приехал пакет, когда прямая ссылка релиза не
                // отдала (закрытый githubusercontent, splify2#15). Молчать нельзя:
                // установка в этом случае идёт заметно дольше.
                notify(`${S.engineCard.yadroUstanovleno}: ${r.installed}${r.via ? ` (${r.via})` : ''}`)
            }
            onInstalled()
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy(false)
        }
    }

    /** Заголовок говорит, что не так, ДО того как человек начнёт настраивать. Четыре разных
     *  случая, и путать их нельзя: нет движка вовсе, движок старее нужного этому интерфейсу,
     *  стоит базовый (а нужен расширенный), или всё на месте и это просто обновление.
     *  Устаревший — раньше базового: базовый нужного возраста работает, устаревший
     *  расширенный — нет. */
    const title = !engine?.present
        ? S.engineCard.yadroNeUstanovleno
        : tooOld
          ? S.engineCard.yadroUstarelo
          : !engine.vless
            ? S.engineCard.ustanovlenoBazovoeYadro
            : S.engineCard.yadro

    return (
        /* Bode: как экран «Движок» приложения — заголовок, затем факты полосами «подпись —
           значение», ниже выбор варианта и версии, кнопка во всю ширину. */
        <Block className={engine?.present && engine.vless && !tooOld ? '' : 'border-destructive'}>
            <CardHead title={title} />
                {engine?.present && (
                    <div className="space-y-1">
                        <KV k={S.engineCard.versiya} v={`steer ${engine.version || '?'}`} />
                        <KV k={S.engineCard.variant} v={engine.vless ? S.engineCard.rasshirennyy : S.engineCard.bazovyy} />
                        {engine.arch && <KV k={S.engineCard.arhitektura} v={<span className="font-mono">{engine.arch}</span>} />}
                    </div>
                )}
                {!engine?.present && (
                    <>
                        <p className="text-sm">
                            {/* Разделение ролей (splify2 показывает и настраивает, steer решает,
                                куда идёт трафик) — это про наше устройство. Человеку на этом
                                экране нужно одно: без движка ничего не заработает, ставить
                                отсюда. */}
                            {S.engineCard.bezNegoMarshrutizirovatNechem}
                        </p>
                        {/* Архитектура — именно здесь, где движка ещё нет. Это единственное
                            состояние, в котором её не показывает никто (у метода engine в
                            нём ранний выход без поля arch), и ровно то, где от неё зависит,
                            скачается ли пакет: релиз собран под шесть целей (I-051). */}
                        {releases?.arch && (
                            <p className="font-mono text-xs text-muted-foreground">
                                {S.engineCard.arhitekturaPaketov}: {releases.arch}
                            </p>
                        )}
                    </>
                )}
                {tooOld && (
                    // Что именно не заработает — перечислением, а не «обновите»: человек, который
                    // обновил интерфейс ради нового и не тронул движок, иначе узнаёт об этом по
                    // одному отказу за раз («подписка не скачалась» без причины).
                    <p className="text-sm">
                        {`${S.engineCard.etotInterfeysSobranPod} ${tooOld} ${S.engineCard.iNoveeSUstanovlennym}`}
                    </p>
                )}
                {engine?.present && !engine.vless && (
                    <p className="text-sm">
                        {S.engineCard.bazovyyUmeetVseKrome}
                    </p>
                )}

                {/* Вариант — двумя объяснёнными строками, а не выпадающим списком из двух
                    непонятных слов: выбор здесь содержательный, и человек должен видеть, чем
                    один отличается от другого, не уходя со страницы.

                    Вес назван у КАЖДОГО варианта, а не только у расширенного (R-044). Аудитория
                    проекта — роутеры со флешем в единицы мегабайт, и «больше на ~250 КБ» отвечает
                    только половину вопроса: сколько займёт то, что я выбираю. Числа замерены по
                    релизу steer 1.1.2, по всем шести архитектурам, распакованным пакетом (то есть
                    именно флеш, а не размер скачивания): базовый 220–295 КБ, расширенный
                    470–590 КБ. Округлено до четверти мегабайта, потому что различие между
                    архитектурами тут меньше, чем различие между вариантами, и выбор делается по
                    второму. Отсюда же и «вдвое»: соотношение 2,0–2,1, а не втрое. */}
                <div className="space-y-2">
                    {[
                        {
                            on: true,
                            name: S.engineCard.rasshirennyy2,
                            why: S.engineCard.podnimaetTunnelSamVstavili,
                        },
                        {
                            on: false,
                            name: S.engineCard.bazovyy2,
                            why: S.engineCard.tolkoMarshrutizatsiyaTunnelPodnimaete,
                        },
                    ].map((o) => (
                        <button
                            key={String(o.on)}
                            type="button"
                            aria-pressed={ext === o.on}
                            onClick={() => { extChosen.current = true; setExt(o.on) }}
                            className={[
                                'flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                                ext === o.on ? 'border-primary bg-primary/10' : 'border-border',
                            ].join(' ')}
                        >
                            <span
                                className={[
                                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                                    ext === o.on
                                        ? 'border-primary bg-primary text-primary-foreground'
                                        : 'border-border',
                                ].join(' ')}
                                aria-hidden="true"
                            >
                                {ext === o.on && <Check className="h-3 w-3" />}
                            </span>
                            <span>
                                <span className="font-medium">{o.name}</span>
                                <span className="block text-xs text-muted-foreground">{o.why}</span>
                            </span>
                        </button>
                    ))}
                </div>

                <div className="space-y-2">
                    <select
                        value={ver}
                        onChange={(e) => setVer(e.target.value)}
                        aria-label={S.engineCard.versiyaYadra}
                        className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                        {versions === null && <option value="">{S.engineCard.zagruzka}</option>}
                        {versions?.length === 0 && <option value="">{S.engineCard.relizovNeNaydeno}</option>}
                        {/* Показывается НАЗВАНИЕ выпуска, ставится ВЕРСИЯ: value — то, что
                            уедет в steer_install и попадёт в имя файла пакета, а подпись —
                            то, как выпуск подписан на странице релизов. */}
                        {versions?.map((v, i) => (
                            <option key={v} value={v}>
                                {releaseName(v, releases?.names)}
                                {i === 0 ? ` — ${S.engineCard.svezhaya}` : ''}
                            </option>
                        ))}
                    </select>
                    <Button onClick={install} disabled={busy || !ver} className="w-full">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        {action.label}
                    </Button>
                </div>

                {/* Почему версия одна и без названия выпуска. Приходит только с запасного
                    пути (splify2#15): перечень релизов живёт на api.github.com, и там, где
                    его закрыли, бэкенд откатывается на VERSION главной ветки. Молчание тут
                    означало бы, что у проекта один релиз. */}
                {!!releases?.note && versions?.length !== 0 && (
                    <p className="text-xs text-muted-foreground">{releases.note}</p>
                )}

                {versions?.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                        {S.engineCard.spisokVersiyNePrishel}{' '}
                        {/* Зеркало, а не github.com: у того, кто видит этот текст, закрыт
                            обычно именно GitHub, и ссылка туда бесполезна ровно для того,
                            кому адресована. В ветке dist лежат те же пакеты релиза, и
                            зеркалится она сама — в отличие от файлов релиза. */}
                        <a
                            href="https://gitlab.com/xyzmean/steer/-/tree/dist"
                            target="_blank"
                            rel="noreferrer"
                            className="underline decoration-dotted"
                        >
                            {S.engineCard.gitlabComXyzmeanSteer}</a>
                    </p>
                )}
        </Block>
    )
}

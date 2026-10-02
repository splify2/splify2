import { useEffect, useRef, useState } from 'react'
import { Check, Download, Loader2 } from 'lucide-react'
import { Block, CardHead, KV } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { rpc } from '@/lib/rpc'
import { cmpVersion, engineAction, engineTooOld, STEER_MODULES, DEFAULT_MODULES, type Releases, releaseName } from '@/lib/engine'
import { type Build } from '@/lib/live'

import { S } from '@/copy'
// Установка ядра из интерфейса.
//
// Ядро 2.0 — пакет steer-core и модули протоколов (steer-vless, steer-hysteria2, steer-proxy…),
// и ставятся они одной транзакцией: модуль зависит от ядра точной версией. Какие модули нужны,
// выбирает человек при первой установке (и при переходе с ядра 1.x); дальше обновление само
// берёт все стоящие и нужные спеке, а ставят и снимают модули по одному в карточке модулей.

interface Props {
    /** Что сейчас установлено. null — ещё не спросили. */
    engine: Pick<Build, 'present' | 'vless' | 'arch' | 'version' | 'min_version' | 'modules' | 'busy'> | null
    /** Что можно поставить. Приходит сверху, а не запрашивается здесь: тот же ответ нужен
     *  левой колонке, чтобы её кнопка не обещала обновление, которого нет (I-038). */
    releases: Releases | null
    onInstalled: () => void
}

/** Стоит ли ядро 2.0 (steer-core): тогда модули уже свои, и обновление берёт их само. */
function isCore2(engine: Props['engine']): boolean {
    return !!engine?.present && !!engine.version && cmpVersion(engine.version, '2') >= 0
}

export default function EngineCard({ engine, releases, onInstalled }: Props) {
    const versions = releases?.versions ?? null
    const [ver, setVer] = useState('')
    const core2 = isCore2(engine)
    /* Модули к первой установке — от ТОГО, ЧТО СТОИТ: у прежнего ядра с VLESS (steer-extended
     * 1.x) в нём были ещё xsteer, обфускатор и мост Telegram, и переход их не отнимает (бэкенд
     * добавит их и сам). Выбор человека главнее показаний: тронул галочку — ответы `engine`
     * его не двигают. */
    const [mods, setMods] = useState<string[]>(DEFAULT_MODULES)
    const touched = useRef(false)
    useEffect(() => {
        if (touched.current || !engine?.present || core2) return
        setMods(engine.vless ? [...new Set([...DEFAULT_MODULES, 'xsteer', 'obfs', 'tgws'])] : DEFAULT_MODULES)
    }, [engine?.present, engine?.vless, core2])
    const [busy, setBusy] = useState(false)
    const action = engineAction(engine, releases)
    // Ядро младше того, под которое собран интерфейс, — см. engineTooOld.
    const tooOld = engineTooOld(engine)

    // Первая в списке — самая свежая: релизы отдаются от новых к старым.
    useEffect(() => {
        if (versions?.length) setVer((v) => v || versions[0])
    }, [versions])

    function toggle(m: string) {
        touched.current = true
        setMods((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))
    }

    async function install() {
        if (!ver) { notify(S.engineCard.vyberiteVersiyu, 'warning'); return }
        setBusy(true)
        try {
            /* У ядра 2.0 стоящие модули бэкенд берёт сам; выбор — только при первой установке.
             * `extended` — для выпусков 1.x: VLESS там был вшит в steer-extended. */
            const want = core2 ? [] : STEER_MODULES.filter((m) => mods.includes(m))
            const r = await rpc.steerInstall(ver, want.includes('vless'), want.join(' '))
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
                notify(`${S.engineCard.ustanovleno(r.installed || ver, r.modules || [])}${r.via ? ` (${r.via})` : ''}`)
            }
            onInstalled()
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy(false)
        }
    }

    /** Заголовок говорит, что не так, ДО того как человек начнёт настраивать: нет ядра вовсе,
     *  ядро старее нужного этому интерфейсу, или всё на месте и это просто обновление. */
    const title = !engine?.present
        ? S.engineCard.yadroNeUstanovleno
        : tooOld
          ? S.engineCard.yadroUstarelo
          : S.engineCard.yadro

    return (
        /* Bode: как экран «Движок» приложения — заголовок, затем факты полосами «подпись —
           значение», ниже выбор варианта и версии, кнопка во всю ширину. */
        <Block className={engine?.present && !tooOld ? '' : 'border-destructive'}>
            <CardHead title={title} />
                {engine?.present && (
                    <div className="space-y-1">
                        <KV k={S.engineCard.versiya} v={`steer ${engine.version || '?'}`} />
                        {core2 && (
                            <KV
                                k={S.engineCard.moduli}
                                v={engine.modules?.length
                                    ? engine.modules.map((m) => S.modules.label[m] || m).join(', ')
                                    : S.engineCard.moduleyNet}
                            />
                        )}
                        {engine.arch && <KV k={S.engineCard.arhitektura} v={<span className="font-mono">{engine.arch}</span>} />}
                    </div>
                )}
                {!engine?.present && (
                    <>
                        <p className="text-sm">
                            {S.engineCard.bezNegoMarshrutizirovatNechem}
                        </p>
                        {/* Архитектура — именно здесь, где ядра ещё нет: от неё зависит, скачается
                            ли пакет (I-051). */}
                        {releases?.arch && (
                            <p className="font-mono text-xs text-muted-foreground">
                                {S.engineCard.arhitekturaPaketov}: {releases.arch}
                            </p>
                        )}
                    </>
                )}
                {tooOld && (
                    // Что с установленным ядром не так и что делать: человек, который обновил
                    // интерфейс и не тронул ядро, иначе узнаёт об этом по отказу «Применить».
                    <p className="text-sm">
                        {`${S.engineCard.etotInterfeysSobranPod} ${tooOld} ${S.engineCard.iNoveeSUstanovlennym}`}
                    </p>
                )}

                {/* Ядро ведёт steer-box-connector (podkop, forkop): его пакеты не трогаем. */}
                {engine?.busy ? (
                    <p className="text-sm">{S.engineCard.zanyato(engine.busy)}</p>
                ) : (<>
                {!core2 && (
                    /* Модули к первой установке — строками с галочкой: что выбрано, то и встанет. */
                    <div className="space-y-2" role="group" aria-label={S.engineCard.sModulyami}>
                        {STEER_MODULES.map((m) => {
                            const on = mods.includes(m)
                            return (
                                <button
                                    key={m}
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() => toggle(m)}
                                    className={[
                                        'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                                        on ? 'border-primary bg-primary/10' : 'border-border',
                                    ].join(' ')}
                                >
                                    <span
                                        className={[
                                            'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                                            on ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                                        ].join(' ')}
                                        aria-hidden="true"
                                    >
                                        {on && <Check className="h-3 w-3" />}
                                    </span>
                                    <span className="font-medium">{S.modules.label[m] || m}</span>
                                </button>
                            )
                        })}
                    </div>
                )}

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
                </>)}

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

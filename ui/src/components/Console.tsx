import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { useLive, type Live } from '@/lib/live'
import { pending, usePending } from '@/lib/pending'
import { isPart, type ServiceEntry } from '@/lib/model'
import { SECTION_TITLE, type SectionId } from '@/lib/sections'
import Rail from '@/components/Rail'
import FirstRun from '@/components/FirstRun'
import ApplyPill from '@/components/ApplyPill'
import { Button } from '@/components/ui/button'
import Home from '@/components/sections/Home'
import EngineToggle from '@/components/EngineToggle'

import { S } from '@/copy'
/** Пульт: рельс разделов слева, работа справа.
 *
 *  Прежде здесь была строка вкладок, и одна из четырёх («Логи steer») собрала всё, что не
 *  влезло в остальные. Дизайн Andromeda 26.9 заменил вкладки разделами: главная, правила,
 *  выходы, каталог, диагностика, система. Вложенных вкладок нет — у каждого раздела одна роль.
 *
 *  Что ещё изменилось вместе с этим. Закреплённая колонка состояния (StatusRail) разобрана:
 *  вердикт, предупреждения и счётчики трафика ушли на обзор, движок и «Остановить всё» — в
 *  подвал рельса, список выходов с откликом — в раздел выходов. Колонка повторяла половину
 *  каждой вкладки, и два числа об одном и том же расходились на глазах.
 *
 *  Живые данные читает ОДИН опрос на весь экран (lib/live.ts) — иначе рельс и раздел показывали
 *  бы два разных мгновения, и оба были бы правдой.
 *
 *  Сохранение автоматическое (lib/pending.ts): кнопок «Сохранить» в разделах нет, применение —
 *  одна плавающая пилюля (ApplyPill) на весь экран. */

const RulesTab = lazy(() => import('@/components/tabs/RulesTab'))
const Vpn = lazy(() => import('@/components/sections/Vpn'))
const Dns = lazy(() => import('@/components/sections/Dns'))
const Settings = lazy(() => import('@/components/sections/Settings'))
type SettingsScreen = Exclude<import('@/components/sections/Settings').Screen, 'root'>
const Diagnostics = lazy(() => import('@/components/sections/Diagnostics'))

/** Разделы, что читают и правят спеку: при отказе загрузки их место занимает «Повторить». */
const SPEC_SECTIONS: SectionId[] = ['rules', 'vpn', 'dns', 'settings']

const FALLBACK = <div className="p-5 text-sm text-muted-foreground">{S.console.zagruzka}</div>

/** Раздел, который приносит оболочка вне LuCI (приложение для компьютера): своё имя, значок и
 *  содержимое — в рельсе после разделов панели. Под LuCI их нет, и панель та же, что была. */
export interface ExtraSection {
    id: string
    label: string
    icon: typeof Check
    render: (live: Live) => ReactNode
}

/** `railHost` — узел оболочки, куда рисуется рельс разделов (порталом): в приложении для
 *  компьютера рельс — отдельная колонка окна вне прокрутки раздела. Нет — рельс рядом с
 *  разделом, как под LuCI. */
/** `board` — оболочка приложения для компьютера: главная «доской» (правила карточками), правила
 *  открываются с неё и вкладки в рельсе нет, а сохранённая правка применяется сама — без кнопки
 *  «Применить» (владелец). Под LuCI ничего этого нет. */
export default function Console({ extra, railHost, board = false, settingsHost, settingsScreen }: {
    extra?: ExtraSection[]
    railHost?: Element | null
    board?: boolean
    /** Узел оболочки для раздела «Настройки» (порталом): в приложении для компьютера настройки
     *  роутера живут в общем слое настроек приложения, а не вторым пунктом рельса. */
    settingsHost?: Element | null
    /** Какой экран настроек рисовать в settingsHost — по пункту слоя настроек оболочки. */
    settingsScreen?: SettingsScreen
} = {}) {
    const [section, setSection] = useState<SectionId | string>('home')
    const live = useLive()
    const { spec, savedFlash, loadFailed, retry } = usePending()
    /** Сервис, который попросили «в правило». Живёт здесь, а не в каталоге, потому что переход
     *  между разделами — дело оболочки; каталог только просит. Считывается разделом правил один
     *  раз и сбрасывается: иначе повторный заход снова открывал бы редактор, которого человек
     *  уже не просил. */
    const [wanted, setWanted] = useState<ServiceEntry | null>(null)
    /** Просьба «Добавить правило» с главной. Живёт здесь по той же причине, что и `wanted`:
     *  кнопка стоит в одном разделе, а заводит правило другой. Считывается разделом правил
     *  один раз и сбрасывается — иначе следующий заход в правила снова заводил бы пустое. */
    const [addRule, setAddRule] = useState(false)
    const [editRule, setEditRule] = useState<number | null>(null)
    const go = (s: SectionId | string) => setSection(s)
    const ext = extra?.find((e) => e.id === section)

    /* Спека нужна рельсу для счётчика правил, а он виден на всех разделах — значит загрузить её
     * обязана оболочка, а не раздел правил. Вызов идемпотентен: кто пришёл раньше, тот и
     * загрузил (lib/pending.ts). */
    useEffect(() => { pending.load().catch(() => {}) }, [])

    /* Без кнопки «Применить» (board): сохранённая правка применяется сама, через 0,8 с тишины —
     * подряд идущие правки уходят одним применением. Только свои: правки, сохранённые и не
     * применённые ДО открытия (например, в LuCI), молча не применяются — для них остаётся
     * пилюля. Неудачное применение не повторяется по кругу: следующая попытка — со следующей
     * правкой. */
    const autoBase = useRef<unknown>(null)
    const [, bump] = useState(0)
    useEffect(() => {
        if (!board) return
        let t: ReturnType<typeof setTimeout> | null = null
        const off = pending.subscribe(() => {
            const saved = pending.saved
            if (!saved) return
            if (autoBase.current === null) { autoBase.current = saved; bump((n) => n + 1); return }
            if (saved === autoBase.current || pending.hasUnsaved() || pending.applying) return
            if (pending.count() === 0) { autoBase.current = saved; bump((n) => n + 1); return }
            if (t) clearTimeout(t)
            t = setTimeout(() => {
                autoBase.current = pending.saved
                bump((n) => n + 1)
                void pending.apply()
            }, 800)
        })
        return () => { off(); if (t) clearTimeout(t) }
    }, [board])
    const leftovers = board && pending.count() > 0 && pending.saved === autoBase.current && !pending.applying

    /* Переход в раздел снаружи — событием `splify:section` (detail — имя раздела). Нужен
     * приложению для компьютера: щелчок по уведомлению «выход не отвечает» открывает VPN. Под
     * LuCI его никто не шлёт. */
    useEffect(() => {
        const on = (e: Event) => {
            const id = (e as CustomEvent<string>).detail
            if (typeof id === 'string' && id) setSection(id)
        }
        window.addEventListener('splify:section', on)
        return () => window.removeEventListener('splify:section', on)
    }, [])

    /* Движка нет — показываем установку ВМЕСТО разделов. Не «рядом»: без движка ни один из них
     * не может подействовать, и открывать их значило бы дать человеку заполнить настройку,
     * которая откажется применяться на последнем шаге.
     *
     * Пока не знаем (build === null) — разделы, а не установку: угадав неверно, мы покажем
     * «движка нет» тому, у кого он работает, и это худшая из двух ошибок. */
    if (live.build && !live.build.present) return <FirstRun live={live} />

    /* Пока применяется или поднимается — метки тревоги в рельсе нет: находки этих секунд
       описывают стройплощадку, а не роутер (см. Live.phase). */
    const warnings = live.phase ? 0 : (live.diag?.fail ?? 0) + (live.diag?.warn ?? 0)
    const counts = {
        rules: spec ? { text: String(spec.channels.length) } : undefined,
        /* Служебные части пулов — не выходы для человека (Output.part_of): пул из двух
           подписок в рельсе считается одним выходом, а не тремя. Постоянный выход `direct`
           не считается тоже: он есть у всех и всегда, и «VPN · 1» на роутере без единого
           туннеля означало бы ровно обратное тому, что есть. */
        vpn: live.status
            ? {
                  text: String(
                      Object.keys(live.status.outputs || {}).filter(
                          /* Только записанные в спеке: члены WARP (`<выход>.<n>`) заводит само ядро,
                             и «VPN · 3» на одном выходе WARP из двух туннелей был бы неправдой. */
                          (n) => live.status?.outputs?.[n]?.kind !== 'direct' && !isPart(spec?.outputs?.[n]) &&
                              (!spec || !!spec.outputs[n]),
                      ).length,
                  ),
              }
            : undefined,
        diag: warnings > 0 ? { text: String(warnings), alarm: true } : undefined,
    }

    return (
        <div className="sp-root an-backdrop text-foreground">
            {/* Ряд тянется на всю подложку (у неё своя нижняя граница высоты), иначе рельс
                кончается там, где кончился его список, и под ним видна ступенька другого
                фона. `min-h-full` работает от родителя с известной высотой — им и является
                .sp-root. */}
            <div className="flex min-h-full flex-col lg:flex-row">
                {railHost
                    ? createPortal(<Rail live={live} section={section} onSection={(s) => go(s)} counts={counts} extra={extra} hide={board ? ['rules', 'settings'] : undefined} />, railHost)
                    : <Rail live={live} section={section} onSection={(s) => go(s)} counts={counts} extra={extra} hide={board ? ['rules', 'settings'] : undefined} />}

                {/* Отступ снизу на узком экране — под нижнюю панель разделов: без него последняя
                    карточка уезжает под неё, и человек не видит, что страница кончилась. */}
                <main className="min-w-0 flex-1 px-3 pb-24 pt-3 lg:p-6">
                    {/* «Сохранено» — вспышка на полторы секунды после каждой УДАВШЕЙСЯ записи, а
                        не после правки: взамен кнопки эта галочка — единственное, по чему человек
                        судит, уехало ли что-нибудь на роутер. */}
                    {/* Вспышка «Сохранено» не занимает СВОЕЙ строки на узком экране: там это
                        были шестнадцать пустых пикселей над вердиктом на каждом разделе, и
                        читались они как незаполненная дырка. Место под неё резервируется только
                        на широком, где оно есть. */}
                    <div className="relative flex justify-end lg:mb-1 lg:h-4">
                        <span
                            aria-hidden={!savedFlash}
                            className={[
                                'absolute right-0 top-0 flex items-center gap-1.5 text-xs text-muted-foreground lg:static',
                                'transition-opacity duration-300',
                                savedFlash ? 'opacity-100' : 'opacity-0',
                            ].join(' ')}
                        >
                            <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> {S.console.sohraneno}</span>
                    </div>

                    {/* Имя раздела печатает ОБОЛОЧКА, а не сам раздел: оно обязано совпадать
                        с пунктом рельса дословно, а два места с одной строкой расходятся. У
                        обзора заголовок другой — им служит вердикт, и второго над ним не надо. */}
                    {/* Обёртка с ключом раздела: при смене раздела она новая, и оболочка вне LuCI может
                        показать смену движением (класс sp-section). Под LuCI у класса нет правил. */}
                    <div key={section} className="sp-section">
                    {section !== 'home' && (
                        <h1 className="sp-title mb-3">{SECTION_TITLE[section as SectionId] ?? ext?.label}</h1>
                    )}

                    {/* Спека не загрузилась — разделы, что её правят, не рисуются вовсе: пустой экран
                        читался бы как «настроек нет», а правка поверх него затёрла бы настоящие. */}
                    {loadFailed && SPEC_SECTIONS.includes(section as SectionId) && (
                        <div role="alert" className="rounded-lg border border-border p-5 text-sm">
                            <p className="font-medium">{S.console.specNeZagruzilas}</p>
                            <p className="mt-1 text-muted-foreground">{S.console.specNeZagruzilasPodpis}</p>
                            <Button className="mt-3" onClick={retry}>{S.console.povtorit}</Button>
                        </div>
                    )}
                    <Suspense fallback={FALLBACK}>
                        {section === 'home' && (
                            <Home
                                live={live}
                                onSection={go}
                                onAddRule={() => {
                                    setAddRule(true)
                                    setSection('rules')
                                }}
                                board={board}
                                onEditRule={(i) => {
                                    setEditRule(i)
                                    setSection('rules')
                                }}
                            />
                        )}
                        {section === 'rules' && !loadFailed && (
                            <RulesTab
                                live={live}
                                wanted={wanted}
                                onWantedUsed={() => setWanted(null)}
                                addNow={addRule}
                                onAddUsed={() => setAddRule(false)}
                                onGoOutbounds={() => go('vpn')}
                                editNow={editRule}
                                onEditUsed={() => setEditRule(null)}
                                onClosed={board ? () => go('home') : undefined}
                            />
                        )}
                        {section === 'vpn' && !loadFailed && <Vpn live={live} />}
                        {section === 'dns' && !loadFailed && <Dns live={live} />}
                        {section === 'diag' && <Diagnostics live={live} />}
                        {section === 'settings' && !loadFailed && (
                            <Settings
                                live={live}
                                onUseInRule={(l) => {
                                    setWanted(l)
                                    go('rules')
                                }}
                            />
                        )}
                        {ext?.render(live)}
                    </Suspense>
                    </div>
                    {settingsHost && createPortal(
                        <Suspense fallback={FALLBACK}>
                            {!loadFailed && (
                                <Settings
                                    live={live}
                                    only={settingsScreen}
                                    onUseInRule={(l) => {
                                        setWanted(l)
                                        go('rules')
                                        // Слой настроек оболочки закрывается: правило открыто под ним.
                                        window.dispatchEvent(new CustomEvent('splify:settings-close'))
                                    }}
                                />
                            )}
                        </Suspense>,
                        settingsHost,
                    )}

                    {/* «Остановить всё» на узком экране — здесь, а не в нижней панели: красной
                        кнопке на всю ширину там не место, а прятать её нельзя (R-017). Под
                        содержимым раздела, на любом из них — то же свойство «доступна всегда»,
                        что у подвала рельса на широком экране. Отступ вдвое больше обычного: в
                        редакторе правила над ней стоит «Удалить правило», и две красные кнопки
                        вплотную читались одной группой — промахнуться между ними пальцем легко. */}
                    <div className="mt-12 lg:hidden">
                        <EngineToggle live={live} variant="block" />
                    </div>

                    <div className="mt-6 border-t border-border pt-3 text-right text-xs text-muted-foreground">
                        powered by{' '}
                        {/* Зеркало, а не github.com: README называет домом steer именно его,
                            и по этой ссылке доходят те, кому закрыли GitHub (splify2#15). */}
                        <a
                            href="https://gitlab.com/xyzmean/steer"
                            target="_blank"
                            rel="noreferrer"
                            className="underline decoration-dotted hover:text-foreground"
                        >
                            steer
                        </a>
                    </div>
                </main>
            </div>

            {(!board || leftovers) && <ApplyPill />}
        </div>
    )
}

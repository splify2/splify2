import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import { rpc } from '@/lib/rpc'
import { pending } from '@/lib/pending'
import {
    toAllowDomainsServices,
    customServices,
    DIRECT,
    EMPTY_SPEC,
    toCatalog,
    isPart,
    routedOutputs,
    type Channel,
    type OutputStatus,
    type ServiceEntry,
    type Spec,
} from '@/lib/model'
import { type Live } from '@/lib/live'
import { Hint } from '@/components/ui/hint'
import { Block, Group } from '@/components/ui/layout'
import RuleEditor from '@/components/tabs/RuleEditor'
import { pathFor, ruleFiles, selectedIds, srsOf } from '@/lib/rulefiles'

/** Правила: единственное место, где что-то назначается.
 *
 *  Строка читается как предложение — что перенаправляем, кого касается, куда. Порядок задаёт
 *  приоритет: движок раздаёт метки по первому совпадению, и интерфейс, который спрятал бы это,
 *  спрятал бы единственное, что человеку обязательно понимать.
 *
 *  Кнопок «Сохранить» здесь больше нет: каждая правка уходит в spec_set сама (lib/pending.ts),
 *  а применяет одна плавающая пилюля. Скачивание выбранных, но отсутствующих списков переехало
 *  в бэкенд, в ветку apply: человек не обязан помнить, что движок читает файлы при компиляции.
 */

/** Строка под именем правила: что оно перенаправляет, словами человека. */
function describe(ch: Channel, services: ServiceEntry[]) {
    const ids = selectedIds(ch, services)
    const entries = services.filter((sv) => ids.includes(sv.id))
    if (!entries.length) {
        const files = ruleFiles(ch)
        if (ch.match.any) return 'весь трафик'
        if (!files.length) return 'сервис не выбран'
        return `свои списки: ${files.length}`
    }
    const total = entries.reduce((n, sv) => n + (sv.count || 0), 0)
    const what = entries.length <= 3
        ? entries.map((sv) => sv.name).join(', ')
        : `${entries.slice(0, 2).map((sv) => sv.name).join(', ')} и ещё ${entries.length - 2}`
    return total ? `${what} · ${total.toLocaleString('ru-RU')} записей` : what
}

/** Куда вести новое правило, пока человек не выбрал сам: первый туннельный выход, а не первый
 *  по алфавиту ключей — правило заводят ради туннеля, и «напрямую» по умолчанию читалось бы
 *  как правило, которое ничего не делает. Служебные части пулов не предлагаются вовсе. */
function defaultOut(spec: Spec): string | undefined {
    const names = Object.keys(spec.outputs).filter((n) => !isPart(spec.outputs[n]))
    return names.find((n) => spec.outputs[n].kind !== 'direct') ?? names[0]
}

/** Кого касается правило — в родительном падеже: правило читается фразой «для кого → что →
 *  куда», и «для все устройства» в ней — не мелочь, а место, где интерфейс перестаёт читаться
 *  как текст. (Именительная форма жила ради столбца таблицы на широком экране; таблицы с
 *  Bode 26.10 нет, фраза одна на любую ширину.)
 *
 *  Счётчик остаётся счётчиком — «устройств: 2», подпись с двоеточием и числом, — и склонения
 *  после числительного здесь не нужны по построению. */
function whoTextFor(ch: Channel) {
    if (!ch.from?.length) return 'всех устройств'
    if (ch.from.length === 1) return ch.from[0]
    return `адресов и подсетей: ${ch.from.length}`
}

/** Спорят ли два правила за одни и те же записи.
 *
 *  По путям файлов, а не по записям каталога: свой список каталогу неизвестен, а перекрыть
 *  исключение он может не хуже. `any` пересекается со всем — правило «весь трафик» забирает и
 *  то, что ниже названо по имени. Ограничение по устройствам (`from`) здесь СОЗНАТЕЛЬНО не
 *  учитывается: правило, накрывающее только телефон, перекрывает исключение именно для
 *  телефона, и «у меня на телефоне исключение не работает» — это тот же случай, а не другой. */
function overlaps(a: Channel, b: Channel) {
    if (a.match.any || b.match.any) return true
    const fa = new Set(ruleFiles(a))
    return ruleFiles(b).some((f) => fa.has(f))
}

interface Props {
    live: Live
    /** Запись каталога, которую попросили «в правило» с другой вкладки. */
    wanted?: ServiceEntry | null
    onWantedUsed?: () => void
    /** «Добавить правило» нажали на главной. Кнопка обязана ЗАВЕСТИ правило, а не просто
     *  открыть раздел: подпись обещает действие, и перевод в список без нового правила
     *  читается как несработавшая кнопка. */
    addNow?: boolean
    onAddUsed?: () => void
    /** Уйти туда, где собирают пул. Правилу некуда вести, пока пула нет, и оставлять
     *  человека с советом «соберите» без дороги туда — это тупик в один щелчок. */
    onGoOutbounds?: () => void
}

export default function RulesTab({
    live, wanted, onWantedUsed, addNow, onAddUsed, onGoOutbounds,
}: Props) {
    const [spec, setSpec] = useState<Spec | null>(null)
    const [catalogServices, setServices] = useState<ServiceEntry[]>([])
    const [local, setLocal] = useState<Record<string, { count: number; mtime: number }>>({})
    const services = useMemo(
        () => [...catalogServices, ...customServices(local)],
        [catalogServices, local],
    )
    const [open, setOpen] = useState<number | null>(null)
    const [search, setSearch] = useState('')

    useEffect(() => {
        /* Спека приходит из общего хранилища (pending), а не своим запросом: хранилище
         * помнит и несохранённые полсекунды, и снимок применённого — свой specGet здесь
         * вернул бы то, что вкладка Outbounds уже успела поменять. */
        pending.load().then(setSpec).catch(() => setSpec(EMPTY_SPEC))
        /* Каталог у выбора списков ТОТ ЖЕ, что на вкладке каталога, и это не экономия: два
         * источника означали бы, что человек видит в справке одно, а выбрать может другое.
         * Поэтому и способ добыть его тот же: сначала каталог выбранного источника, и только
         * если его нечем скачать — зашитая в пакет таблица издателя. Файлы прежнего каталога,
         * уже стоящие в правилах, отсюда не пропадают: `pick` трогает только файлы своей
         * записи, а незнакомые оставляет в спеке нетронутыми. */
        rpc.manifest()
            .then((m) => {
                const c = toCatalog(m)
                if (!c.services.length) throw new Error('пустой каталог')
                setServices(c.services)
            })
            .catch(() =>
                rpc.allowDomains()
                    .then((a) => setServices(toAllowDomainsServices(a)))
                    .catch(() => setServices([])),
            )
        rpc.localLists().then((d) => setLocal(d.files || {})).catch(() => setLocal({}))
    }, [])

    /** Правка: в свой стейт для мгновенной перерисовки и в хранилище для автосохранения. */
    function edit(next: Spec) {
        setSpec(next)
        pending.edit(next)
    }

    /** Уже исполненные просьбы извне.
     *
     *  ЗАЧЕМ ЭТО ВООБЩЕ НУЖНО. Оба эффекта ниже заканчиваются вызовом edit(), то есть
     *  setSpec, а spec стоит у них в зависимостях: эффект просыпается ещё раз на своей же
     *  записи. Единственное, что удерживало от второго правила, — гашение признака
     *  ОБОЛОЧКОЙ (onWantedUsed / onAddUsed возвращают наверх, и признак снимают там). То
     *  есть верность держалась на чужом и притом асинхронном шаге: попади перерисовка
     *  оболочки после нашей, просьба исполнялась бы дважды и больше. Замерено стендом:
     *  без гашения признака заводилось шесть одинаковых правил за пятьдесят миллисекунд.
     *
     *  Признак «исполнено» держится ЗДЕСЬ, потому что здесь и исполняется. */
    const doneWanted = useRef<ServiceEntry | null>(null)
    const doneAdd = useRef(false)

    /** Просьба из каталога: завести правило с этой записью и открыть его. */
    useEffect(() => {
        if (!wanted || !spec) return
        if (doneWanted.current === wanted) return
        doneWanted.current = wanted
        onWantedUsed?.()
        const out = defaultOut(spec)
        if (!out) {
            notify('Сначала настройте выход VPN — правилу некуда вести', 'warning')
            return
        }
        /* Набор каталога встаёт списками или файлом — как в редакторе (srsOf); пока роутер
         * отвечает, человек мог поправить спеку, поэтому дописываем к сохранённой. */
        const create = (cur: Spec, set?: string) => {
            const used = new Set(cur.channels.map((c) => c.name))
            let name = wanted.name
            let n = 2
            while (used.has(name)) name = `${wanted.name} ${n++}`
            const ch: Channel = {
                name,
                out,
                match: set
                    ? { srs_files: [set], mode: 'fakeip' as const }
                    : {
                          ...(wanted.prefixes.length
                              ? { prefixes_files: wanted.prefixes.map(pathFor) }
                              : {}),
                          ...(wanted.domains.length
                              ? { domains_files: wanted.domains.map(pathFor), mode: 'fakeip' as const }
                              : {}),
                      },
            }
            edit({ ...cur, channels: [...cur.channels, ch] })
            setOpen(cur.channels.length)
        }
        if (wanted.srs) void srsOf(wanted, local).then((set) => create(pending.saved ?? spec, set))
        else create(spec)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wanted, spec])

    /** Просьба с главной: «Добавить правило» обязано ЗАВЕСТИ правило и открыть его.
     *
     *  Отдельным эффектом, а не вызовом из оболочки: заводить умеет только этот раздел — он
     *  один знает, какие имена уже заняты и какой выход подставить, — а оболочка лишь
     *  передаёт просьбу. Признак гасится сразу, иначе следующий заход в раздел заводил бы
     *  ещё одно пустое правило. */
    useEffect(() => {
        if (!addNow) { doneAdd.current = false; return }
        if (!spec || doneAdd.current) return
        doneAdd.current = true
        onAddUsed?.()
        add()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addNow, spec])

    function move(i: number, delta: number) {
        if (!spec) return
        const j = i + delta
        if (j < 0 || j >= spec.channels.length) return
        const channels = spec.channels.slice()
        ;[channels[i], channels[j]] = [channels[j], channels[i]]
        edit({ ...spec, channels })
        setOpen(open === i ? j : open === j ? i : open)
    }

    function add() {
        if (!spec) return
        const out = defaultOut(spec)
        if (!out) {
            notify('Сначала настройте выход VPN — правилу некуда вести', 'warning')
            return
        }
        const used = new Set(spec.channels.map((c) => c.name))
        let n = spec.channels.length + 1
        while (used.has(`правило${n}`)) n++
        edit({ ...spec, channels: [...spec.channels, { name: `правило${n}`, match: {}, out }] })
        setOpen(spec.channels.length)
    }

    /** Исключение: «этот сервис — мимо туннеля».
     *
     *  Отдельной сущности в движке нет и не требуется — исключение это канал в выход `direct`,
     *  стоящий ВЫШЕ туннельных: метки раздаются по первому совпадению, поэтому верхнее правило
     *  забирает записи себе и оставляет их на обычном пути. Механизм был в продукте с самого
     *  начала, но нигде так не назывался, и человек с «у меня Spotify без VPN работает лучше»
     *  (splify2#3) его не находил — искал настройку, которой нет, потому что она есть в виде
     *  порядка строк. */
    function addException() {
        if (!spec) return
        /* Выход в direct нужен как АДРЕС НАЗНАЧЕНИЯ: канал, ведущий в выход, которого нет в
         * спеке, движок отвергает целиком. Обычно он уже здесь — постоянный (model.ts,
         * withDirect), — но спека могла прийти и мимо нормализации, поэтому недостающий
         * заводится тут же: у этого выхода нет ни одной настройки, и отправлять за ним на
         * другую вкладку значит превратить шаблон в инструкцию из двух шагов.
         *
         * Ищется он по ВИДУ, а не по имени: в спеках, написанных до постоянного выхода, он мог
         * называться как угодно, и второй такой же означал бы два «напрямую» в списке целей. */
        let outputs = spec.outputs
        let out = Object.keys(outputs).find((n) => outputs[n].kind === 'direct')
        if (!out) {
            out = DIRECT
            outputs = { ...outputs, [out]: { name: out, kind: 'direct' } }
        }
        const used = new Set(spec.channels.map((c) => c.name))
        let name = 'исключение'
        let n = 2
        while (used.has(name)) name = `исключение ${n++}`
        /* Место — перед первым туннельным правилом, а не в конец списка: исключение, попавшее
         * ниже туннельного канала с теми же записями, не срабатывает вовсе. Не в самое начало
         * тоже осознанно — так уже стоящие исключения сохраняют свой порядок между собой. */
        const at = spec.channels.findIndex((c) => outputs[c.out]?.kind !== 'direct')
        const idx = at < 0 ? spec.channels.length : at
        const channels = spec.channels.slice()
        channels.splice(idx, 0, { name, match: {}, out })
        edit({ ...spec, outputs, channels })
        setOpen(idx)
    }

    /** Переключить правило. Одно поле спеки — и порядок, и видимость движку сохраняются. */
    function toggle(i: number, on: boolean) {
        if (!spec) return
        edit({
            ...spec,
            channels: spec.channels.map((c, k) => (k === i ? { ...c, enabled: on } : c)),
        })
    }

    /** Отбор правил по строке поиска.
     *
     *  ВЫШЕ РАННИХ ВОЗВРАТОВ, и это не вкус: ниже стоят два выхода из функции — «спека ещё не
     *  загрузилась» и «открыт редактор правила», — а хук, до которого доходит не каждый
     *  отрисовочный проход, нарушает единственное правило хуков: их порядок обязан быть один и
     *  тот же. Пустую спеку хук разбирает сам, поэтому переезд наверх ничего не меняет в
     *  поведении. Preact к смене числа хуков терпим, пока этот стоит последним, — но ровно до
     *  первого хука, добавленного после него: тогда состояния разъедутся молча. */
    const filteredChannels = useMemo(() => {
        if (!spec) return []
        const q = search.trim().toLowerCase()
        if (!q) return spec.channels.map((ch, originalIndex) => ({ ch, originalIndex }))
        return spec.channels
            .map((ch, originalIndex) => ({ ch, originalIndex }))
            .filter(({ ch }) => {
                if (ch.name.toLowerCase().includes(q)) return true
                if (ch.out.toLowerCase().includes(q)) return true
                const desc = describe(ch, services).toLowerCase()
                if (desc.includes(q)) return true
                return false
            })
    }, [spec, search, services])

    if (!spec) return <div className="p-5 text-sm text-muted-foreground">Загрузка…</div>

    /** Выходы: спека плюс то, что о них знает движок.
     *
     *  Одних фактов движка мало — выход, заведённый минуту назад и ещё не применённый, в
     *  status отсутствует: правило на него читалось бы как «не найден», а в редакторе такого
     *  выхода не было бы в списке вовсе, то есть шаблон «Исключение» выглядел бы сломанным
     *  ровно в тот момент, когда им пользуются впервые. Факты кладутся сверху: `up`, метку и
     *  таблицу знает только движок. */
    const outputs: Record<string, OutputStatus> = {}
    for (const [n, o] of Object.entries({ ...spec.outputs, ...(live.status?.outputs || {}) }))
        /* Служебные части пулов — не цели для правила: их локации человек видит внутри пула. */
        if (!isPart(spec.outputs[n])) outputs[n] = o

    if (open !== null && spec.channels[open]) {
        const ch = spec.channels[open]
        const mine = new Set(selectedIds(ch, services))
        const clashing = spec.channels
            .map((o, k) => ({ o, k }))
            .filter(({ o, k }) => k !== open && selectedIds(o, services).some((id) => mine.has(id)))
        const above = clashing.filter(({ k }) => k < open)
        const clash = clashing.length
            ? `Общие записи с: ${clashing.map(({ o }) => o.name).join(', ')}. ` +
              (above.length
                  ? `Совпавшее заберёт «${above[above.length - 1].o.name}» — оно выше.`
                  : 'Совпавшее заберёт это правило — оно выше.')
            : null
        /* Перекрытие исключения — отдельно от `clash`: то говорит, кто заберёт общие записи,
         * а это отвечает на вопрос «сработает ли вообще». Считается только для канала в
         * direct и только по правилам ВЫШЕ, включённым и туннельным. */
        const coveredBy =
            outputs[ch.out]?.kind === 'direct'
                ? spec.channels
                      .filter(
                          (o, k) =>
                              k < open &&
                              o.enabled !== false &&
                              outputs[o.out]?.kind !== 'direct' &&
                              overlaps(o, ch),
                      )
                      .map((o) => o.name)
                : []
        return (
            <RuleEditor
                ch={ch}
                index={open}
                services={services}
                local={local}
                outputs={outputs}
                clash={clash}
                rulesTotal={spec.channels.length}
                coveredBy={coveredBy}
                onChange={(next) =>
                    edit({ ...spec, channels: spec.channels.map((c, k) => (k === open ? next : c)) })
                }
                onClose={() => setOpen(null)}
                onDelete={() => {
                    edit({ ...spec, channels: spec.channels.filter((_, k) => k !== open) })
                    setOpen(null)
                }}
            />
        )
    }

    /* Bode 26.10: список правил по образцу экрана «Правила» приложения Splify2.
     *
     *  РАСКЛАДКА ОДНА на любую ширину. Прежде их было две — таблица с шапкой столбцов на
     *  широком экране и карточка на правило на узком, — и каждая правка вёрстки делалась
     *  дважды. Теперь это одна карточка, в которой правила стоят строками через волосяную
     *  линию (Group), как однородные пункты в приложении: номер слева столбиком (порядок —
     *  это приоритет), имя и под ним фраза «для кого → что → куда», выключатель у правого
     *  края. Строка целиком открывает правило, как в приложении; кнопки порядка, правки и
     *  удаления остались, где были по смыслу, — рядом с выключателем на широком экране и
     *  второй строкой под фразой на узком: на 390 пикселях четыре кнопки и выключатель в
     *  одну строку оставили бы на имя правила треть ширины. */
    type Rule = Spec['channels'][number]

    const ruleOut = (ch: Rule) => {
        const o = outputs[ch.out]
        return (
            <span className="inline-flex min-w-0 items-center gap-1.5 align-baseline">
                <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                        !o
                            ? 'bg-destructive'
                            : o.kind === 'direct'
                              ? 'bg-muted-foreground'
                              : o.up
                                ? 'bg-success'
                                : 'bg-destructive'
                    }`}
                    aria-hidden="true"
                />
                <span className="truncate text-foreground">
                    {o ? (o.kind === 'direct' ? 'Напрямую' : ch.out) : `${ch.out} — не найден`}
                </span>
            </span>
        )
    }

    const isFiltering = search.trim().length > 0

    const ruleActions = (i: number) => (
        <div className="flex justify-end gap-0.5">
            <Button
                variant="ghost"
                size="icon"
                aria-label="Поднять приоритет"
                title={isFiltering ? 'Сбросьте поиск для изменения порядка' : undefined}
                disabled={i === 0 || isFiltering}
                onClick={() => move(i, -1)}
            >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
                variant="ghost"
                size="icon"
                aria-label="Опустить приоритет"
                title={isFiltering ? 'Сбросьте поиск для изменения порядка' : undefined}
                disabled={i === spec!.channels.length - 1 || isFiltering}
                onClick={() => move(i, 1)}
            >
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Изменить правило"
                    onClick={() => setOpen(i)}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Удалить правило"
                    className="hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => edit({ ...spec!, channels: spec!.channels.filter((_, k) => k !== i) })}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
        </div>
    )

    /* «Новое правило» и «Исключение» — под списком во всю ширину, как «Новое правило» в
       приложении: действие стоит там, где кончается перечень, к которому оно добавляет. */
    const addButtons = (
        <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={add} className="w-full sm:flex-1">
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Новое правило
            </Button>
            {/* Без иконки и вторичной кнопкой: исключение — частный случай правила, а
                не второй способ его завести. Название кнопки и есть вся новизна — сам
                механизм в движке тот же. */}
            <Button variant="ghost" onClick={addException} className="w-full sm:w-auto">
                Исключение
            </Button>
        </div>
    )

    return (
        <div className="space-y-3">
            {/* «Кого маршрутизируем» живёт в Настройках → Общее, и только там: карточка стояла
                и здесь, и человек видел одну и ту же настройку в двух разделах. Правила — про
                то, ЧТО и КУДА; откуда приходят клиенты — настройка роутера, а не правила. */}
            <p className="text-xs text-muted-foreground">
                Сверху вниз — побеждает{' '}
                {/* Под этим стоит раздача меток движком: метку ставит первое совпавшее сверху
                    правило, и именно поэтому «Напрямую» выше туннельного работает как
                    исключение. На экране остаётся само правило игры и действие — стрелки. */}
                <Hint tip="Адрес достаётся самому верхнему правилу, которое его назвало; остальное идёт напрямую. Порядок меняется стрелками.">
                    первое совпадение
                </Hint>
                . Изменения сохраняются сами. Правило «Напрямую» выше туннельных — это
                исключение: выбранное пойдёт мимо VPN.
            </p>

            {spec.channels.length > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 shadow-card">
                    <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.currentTarget.value)}
                        placeholder="Поиск правил по названию, сервису или выходу…"
                        className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
                    />
                    {search && (
                        <button
                            type="button"
                            onClick={() => setSearch('')}
                            aria-label="Очистить строку поиска"
                            className="text-muted-foreground transition-colors hover:text-foreground"
                        >
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                    )}
                    {search.trim() ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                            найдено {filteredChannels.length} из {spec.channels.length}
                        </span>
                    ) : null}
                </div>
            )}

            {spec.channels.length === 0 ? (
                <Block className="text-center">
                    <p className="text-sm font-medium">Правил нет — весь трафик идёт напрямую.</p>
                    <p className="text-xs text-muted-foreground">
                        Добавьте правила для сервисов (YouTube, Telegram, Discord...) или направьте нужный трафик через VPN.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2 pt-1">
                        <Button onClick={add}>
                            <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Новое правило
                        </Button>
                        <Button variant="ghost" onClick={addException}>
                            Исключение
                        </Button>
                    </div>
                    {routedOutputs(outputs).length === 0 && (
                        <div className="text-xs">
                            <button
                                type="button"
                                onClick={onGoOutbounds}
                                className="text-primary underline decoration-dotted"
                            >
                                Настроить выход VPN
                            </button>
                        </div>
                    )}
                </Block>
            ) : filteredChannels.length === 0 ? (
                <Block className="text-center text-sm text-muted-foreground">
                    <div>По запросу «{search}» ничего не нашлось.</div>
                    <div>
                        <Button variant="outline" size="sm" onClick={() => setSearch('')}>
                            Сбросить поиск
                        </Button>
                    </div>
                </Block>
            ) : (
                <>
                    <Group>
                        <ul className="divide-y divide-border">
                            {filteredChannels.map(({ ch, originalIndex }) => {
                                const on = ch.enabled !== false
                                return (
                                    <li
                                        key={`rule-${originalIndex}`}
                                        /* Кнопки стоят в разметке ОДИН раз, а место меняют
                                           порядком: на узком — отдельной строкой под фразой,
                                           на широком — между фразой и выключателем. Второй
                                           экземпляр кнопок, спрятанный классом, читался бы
                                           экранным чтецом дважды. */
                                        className="flex flex-wrap items-start gap-x-2 py-2.5"
                                    >
                                        {/* Выключенное приглушено, но НА ВИДУ и на своём месте:
                                            спрятанное правило человек считает удалённым и
                                            заводит второе такое же, а уехавшее вниз меняет
                                            порядок, то есть приоритет. Приглушается текст, а
                                            не выключатель: им правило и включают обратно. */}
                                        <button
                                            type="button"
                                            onClick={() => setOpen(originalIndex)}
                                            className={`order-1 flex min-w-0 flex-1 items-start gap-3 rounded-lg bg-transparent py-1 pr-1 text-left transition-colors duration-200 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? '' : 'opacity-50'}`}
                                        >
                                            <span className="w-5 shrink-0 pt-px text-center text-xs tabular-nums text-muted-foreground">
                                                {originalIndex + 1}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-semibold">{ch.name}</span>
                                                <span className="mt-0.5 block text-[13px] leading-snug text-subtle">
                                                    <span>для {whoTextFor(ch)}</span>
                                                    <span aria-hidden="true"> → </span>
                                                    <span>{describe(ch, services)}</span>
                                                    <span aria-hidden="true"> → </span>
                                                    {ruleOut(ch)}
                                                    {!on && ' · выключено'}
                                                </span>
                                            </span>
                                        </button>
                                        <div className={`order-3 w-full md:order-2 md:w-auto md:self-center ${on ? '' : 'opacity-50'}`}>
                                            {ruleActions(originalIndex)}
                                        </div>
                                        <div className="order-2 flex min-h-[44px] shrink-0 items-center md:order-3">
                                            <Switch
                                                on={on}
                                                label={on ? `Выключить правило ${ch.name}` : `Включить правило ${ch.name}`}
                                                onClick={() => toggle(originalIndex, !on)}
                                            />
                                        </div>
                                    </li>
                                )
                            })}
                        </ul>
                    </Group>
                    {addButtons}
                </>
            )}
        </div>
    )
}

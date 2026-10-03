import { useEffect, useState } from 'react'
import { notify } from '@/lib/notify'
import { rpc } from '@/lib/rpc'
import type { Channel, Spec } from '@/lib/model'
import { encodeSpec, wasV1 } from '@/lib/specv2'
import { cmpVersion } from '@/lib/engine'

import { S } from '@/copy'
/** Автосохранение и счётчик неприменённого — одно место на весь экран.
 *
 *  Правка уходит в spec_set сама, через полсекунды тишины: кнопок «Сохранить» больше
 *  нет. Применение остаётся отдельным шагом (перекомпиляция наборов), и его единственная
 *  кнопка — плавающая пилюля «Применить · N», где N — сколько правил и выходов
 *  ОТЛИЧАЕТСЯ от применённого. Не счётчик кликов: изменил и вернул обратно — ноль.
 *
 *  «Применённое» приходит от бэкенда (applied_get — снимок спеки в момент apply), а не
 *  запоминается интерфейсом: перезагрузка страницы не должна обнулять счётчик.
 *
 *  ПУСТОЕ ПРАВИЛО — ЧЕРНОВИК И НА РОУТЕР НЕ ЕДЕТ. Правило заводится пустым и заполняется
 *  по одному действию: имя, сервис, кому, куда. Каждое из них — правка, каждая правка — запись,
 *  а спеку с правилом без единого сервиса движок отвергает ЦЕЛИКОМ («matches nothing»): не
 *  сохранялось ничего, в том числе правки в других правилах и выходах, и на каждые полсекунды
 *  набора текста внизу вставала новая красная полоса с английской фразой компилятора (снято
 *  владельцем с экрана). Поэтому правило без сервисов остаётся в памяти страницы, а на роутер
 *  уезжает спека без него; как только сервис выбран — правило едет как все. Пока черновик
 *  есть, «Сохранено» не вспыхивает и страховка на выгрузку спрашивает: он действительно не
 *  сохранён, и перезагрузка страницы его потеряет — как теряла и раньше, только теперь об этом
 *  честно сказано, а остальное сохранено.
 *
 *  ПОСЛЕ ПРИМЕНЕНИЯ СПЕКА ПЕРЕЧИТЫВАЕТСЯ С РОУТЕРА. apply там не только применяет, но и может
 *  переписать сам файл: самолечение (spec_heal_ipv6) вставляет `ipv6: nat|off` выходам без ключа.
 *  Память страницы об этом не знала, и первая же записанная сама правка отправляла на роутер прежнюю
 *  спеку — вылеченные ключи пропадали до следующего apply, а после перезагрузки страницы пилюля
 *  «Применить · N» горела от разницы со снимком, которой человек не делал. Теперь после ответа
 *  apply страница читает spec_get и applied_get и берёт то, что лежит на роутере. Ответ apply спеку
 *  не несёт нарочно: читать файл отдельным вызовом дешевле, чем вшивать его в ответ оболочкой, а
 *  судья — диск, и если файл за это время поменял кто-то ещё, верна его версия.
 *
 *  ПРАВКИ ЗА ВРЕМЯ ПРИМЕНЕНИЯ НЕ ТЕРЯЮТСЯ И НЕ УЕЗЖАЮТ НАПЕРЁД. Пока apply идёт, спека на роутер не
 *  пишется (flush ждёт конца; исключение — уход со страницы, после него писать некому): запись
 *  посреди apply либо стёрла бы вылеченное, либо потерялась бы под самолечением, либо попала бы в
 *  снимок применённого, хотя ядро этой правки не видело, — и пилюля сказала бы «всё применено» про
 *  то, чего ядро не исполняет. Правка остаётся в памяти и ложится поверх свежей спеки трёхсторонним
 *  слиянием (mergeSpec: что роутер хранил до применения, что в памяти сейчас, что на нём лежит
 *  после), а потом уезжает как обычно и считается неприменённой. Раздел, который держит свою копию
 *  спеки (speccopy.ts), подмену получает через onReplaced. */

/** Правило без единого сервиса: движку такое не отдаётся. */
export function isDraft(c: Channel): boolean {
    const m = c.match || {}
    return !m.any && !(m.prefixes_files?.length) && !(m.domains_files?.length) && !(m.srs_files?.length)
}

/** Спека без черновиков — то, что едет на роутер. */
export function writable(spec: Spec): { spec: Spec; drafts: number } {
    const channels = spec.channels || []
    const kept = channels.filter((c) => !isDraft(c))
    return { spec: kept.length === channels.length ? spec : { ...spec, channels: kept }, drafts: channels.length - kept.length }
}

/** Строки самолечения в ответе apply: «splify2: выходам без ключа ipv6 записан ipv6: nat (…): wg0».
 *  Бэкенд пишет их тому, кто смотрит в ssh и журнал (rpcd/m-spec.sh, heal_report), а человеку на
 *  экране они ни к чему: ключ — внутренность настройки, а как выход ходит в IPv6, видно в самом
 *  выходе, который после применения перечитан с роутера. Поэтому в тосте их нет. Начало строки то
 *  же, что в бэкенде; сверка с его исходником — в tests/apply-refetch.test.ts. */
const HEAL_LINE = /^splify2: выходам без ключа ipv6 записан /

/** Текст тоста по ответу apply: слова ядра и зон фаервола — без строк самолечения. */
export function applyText(output: string | undefined): string {
    return (output ?? '')
        .split('\n')
        .filter((l) => !HEAL_LINE.test(l))
        .join('\n')
        .trim()
}

type Listener = () => void

class PendingStore {
    saved: Spec | null = null
    applied: Spec | null = null
    /** Что лежит на роутере, по нашим сведениям: прочитанное при загрузке, записанное последним
     *  удавшимся spec_set, перечитанное после применения. Без черновиков — они туда не едут.
     *  Опора трёхстороннего слияния (mergeSpec): по разнице между ним и `saved` видно, что человек
     *  успел поправить, а по разнице между ним и перечитанным — что сделал за это время роутер. */
    private written: Spec | null = null
    applying = false
    /** Закрывается, когда применение кончилось (любым исходом). Записи, пришедшие за время
     *  применения, ждут его — см. flush. */
    private applyDone: Promise<void> = Promise.resolve()
    /** Разделы со своей копией спеки (speccopy.ts): им говорят, что хранилище подменило спеку. */
    private replaced = new Set<(spec: Spec) => void>()
    /** Полторы секунды зелёной галочки после успешного apply. */
    justApplied = false
    /** Когда закончилось последнее применение (любым исходом). По нему опрос знает, что
     *  движок сейчас перестраивает правила и перезапускает клиентов туннелей: ответы этих
     *  секунд — не приговор, а стройплощадка. */
    appliedAt = 0
    /** Короткая вспышка «Сохранено» у вкладок. */
    savedFlash = false
    /** Последнее предупреждение записи — чтобы одно и то же не всплывало на каждое
     *  автосохранение. Список, который «нам пока не подходит», не подходит и через
     *  полсекунды, когда человек допечатал имя правила: предупреждение то же, и вторая
     *  полоса о нём ничего не добавляет. Новый текст — новая полоса. */
    private lastWarn = ''

    private listeners = new Set<Listener>()
    private timer: ReturnType<typeof setTimeout> | null = null
    private writing: Promise<void> = Promise.resolve()
    dirty = false
    /** Запись НА ЛЕТУ. Отдельно от dirty потому, что flush снимает dirty ещё до ответа
     *  роутера: без этого признака страховка на выгрузку считала бы уехавшим то, что как раз
     *  сейчас в полёте, и браузер имел бы полное право оборвать запрос молча. */
    inflight = false
    private flashTimer: ReturnType<typeof setTimeout> | null = null

    subscribe(fn: Listener) {
        this.listeners.add(fn)
        return () => { this.listeners.delete(fn) }
    }
    private emit() { for (const fn of this.listeners) fn() }

    /** Хранилище подменило спеку НЕ по правке человека, а по тому, что лежит на роутере (после
     *  применения). Нужна разделам, которые правят спеку на месте со своей копией в состоянии:
     *  без подмены их следующая правка выросла бы из прежней копии и записала её поверх свежей. */
    onReplaced(fn: (spec: Spec) => void) {
        this.replaced.add(fn)
        return () => { this.replaced.delete(fn) }
    }

    /** Спека не загрузилась: роутер не ответил или ответил не спекой. Экран показывает это как
     *  отказ с кнопкой «Повторить», а НЕ как пустую настройку: пустая спека на экране выглядела
     *  бы точной записью («выходов нет, правил нет»), и первая же правка записала бы её поверх
     *  настоящей. Пока признак стоит, `saved` пуст — писать нечего и нечем. */
    loadFailed = false
    private loading: Promise<Spec> | null = null

    /** Первая загрузка. Кто пришёл раньше — тот и загрузил; остальные получают то же. Отказ
     *  отказом и остаётся (после нескольких попыток с паузами: ubus после перезапуска rpcd
     *  отвечает «объект не найден» секунду-другую, сессия LuCI может истечь) — подменять его
     *  пустой спекой нельзя. Следующий вызов начнёт загрузку заново. */
    load(): Promise<Spec> {
        if (this.saved) return Promise.resolve(this.saved)
        if (!this.loading) {
            this.loading = this.fetchSpec().finally(() => { this.loading = null })
        }
        return this.loading
    }

    /** «Повторить» с экрана отказа. */
    retry() {
        this.loadFailed = false
        this.emit()
        void this.load().catch(() => {})
    }

    /** Прочитать спеку с роутера; `pauses` — паузы между попытками, мс. */
    private async readSpec(pauses: number[]): Promise<Spec> {
        let lastErr: unknown
        for (let i = 0; i <= pauses.length; i++) {
            if (i > 0) await new Promise((r) => setTimeout(r, pauses[i - 1]))
            try {
                const got = await rpc.specGet()
                /* Ответ без выходов — не спека: у настоящей `direct` есть всегда (SPEC_EMPTY
                 * бэкенда, uci-defaults). Пустой ответ rpcd, обрубок, не-объект — отказ. */
                if (!got || typeof got !== 'object' || !got.outputs || typeof got.outputs !== 'object')
                    throw new Error(S.pending.otvetNeSpeka)
                return got
            } catch (e) {
                lastErr = e
            }
        }
        throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
    }

    private async fetchSpec(): Promise<Spec> {
        let saved: Spec
        try {
            saved = await this.readSpec(LOAD_RETRY_MS)
        } catch (e) {
            this.loadFailed = true
            this.emit()
            throw e
        }
        /* Старый бэкенд метода не знает — тогда считаем применённым сохранённое:
         * счётчик стартует с нуля, что не хуже прежнего поведения. */
        const applied = await rpc.appliedGet().catch(() => null)
        if (!this.saved) {
            /* Спека прежнего формата (v1) переписывается в v2 сразу, без участия человека:
             * движок 2.0 v1 больше не читает. Смысл правил не меняется, поэтому счётчик
             * «Применить · N» остаётся нулём (сравнение идёт по модели, а не по записи), а
             * бэкенд перед заменой оставляет копию прежнего файла рядом. */
            const migrate = wasV1(saved)
            this.saved = migrate ? { ...saved, schema: undefined } : saved
            this.written = this.saved
            this.applied = applied ?? this.saved
            this.loadFailed = false
            this.emit()
            if (migrate && !(await this.coreTooOld())) this.edit(this.saved)
        }
        return this.saved as Spec
    }

    /** Ядро младше минимума (переход с 26.9: интерфейс уже 26.10, ядро ещё 1.5.x) — спеку v2 оно
     *  отвергает при проверке, и перенос v1 → v2 на открытии кончался красным тостом с отказом
     *  ядра и вечной несохранённой правкой. Тогда переноса нет: ядро 1.x работает со своей
     *  спекой, экран зовёт обновить ядро, а перенос случится на первом открытии после
     *  обновления. Бэкенд не ответил или минимума не назвал — переносим, как прежде. */
    private async coreTooOld(): Promise<boolean> {
        const e = await rpc.engine().catch(() => null)
        if (!e?.present || !e.version || !e.min_version) return false
        return cmpVersion(e.version, e.min_version) < 0
    }

    /** Правка: сразу в память (и всем подписчикам), на диск — через 500 мс тишины.
     *  Дебаунс не косметика: набор имени правила — это десяток onChange, и каждый
     *  spec_set гоняет dry-run компилятора на роутере с 64 МБ. */
    edit(next: Spec) {
        /* Спека не загружена — писать нечего: запись «поверх» затёрла бы настоящую спеку
         * тем, что набрано без неё. Экран отказа правок и не предлагает; это страховка. */
        if (!this.saved) { notify(S.pending.specNeZagruzhena, 'error'); return }
        this.saved = next
        this.dirty = true
        this.emit()
        this.arm()
    }

    /** Взвести отправку: через 500 мс тишины. */
    private arm() {
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => void this.flush(), 500)
    }

    /** Галочка «Сохранено» — на полторы секунды и только по факту записи.
     *
     *  Прежде она вспыхивала прямо в edit(), то есть за 500 мс до того, как запрос
     *  вообще отправлялся. Отказ здесь не редкость, а штатная ветка: spec_set отвергает
     *  спеку целиком, если её не принял dry-run компилятора. Порядок событий получался
     *  обратный смыслу — сначала «✓ Сохранено», потом тост с причиной, — а взамен
     *  кнопки «Сохранить» эта галочка единственная, по чему человек судит, уехала
     *  правка или нет. */
    private flash() {
        if (this.flashTimer) clearTimeout(this.flashTimer)
        this.savedFlash = true
        this.flashTimer = setTimeout(() => { this.savedFlash = false; this.emit() }, 1800)
        this.emit()
    }

    /** Дописать на роутер всё, что ещё не уехало. Последовательно: два spec_set
     *  вперегонки — это гонка, в которой побеждает случайный.
     *
     *  `force` — писать, даже пока идёт применение. Нужен двум: самому apply (он дописывает всё до
     *  вызова бэкенда) и уходу со страницы (после него писать будет некому). */
    async flush(force = false) {
        /* ПОКА ИДЁТ ПРИМЕНЕНИЕ, ЗАПИСЬ ЖДЁТ. Бэкенд в apply сам правит файл спеки (самолечение
         * ipv6) и в конце снимает с него копию «применённого»; spec_set посреди этого либо стёр бы
         * вылеченное (замена файла его старой копией), либо попал бы в снимок, хотя ядро спеку уже
         * прочитало, — и «Применить · N» сказало бы «всё применено» про правку, которой ядро не
         * исполняет. Правка за это время остаётся в памяти (dirty) и уезжает после ответа, поверх
         * перечитанной спеки (apply → refresh). Спека к записи берётся ПОСЛЕ ожидания: не та, что
         * была в момент вызова, а слитая с роутерной. */
        while (this.applying && !force) await this.applyDone
        /* Писать нечего — но запись, начатая раньше, может ещё лететь: dirty снимается в НАЧАЛЕ
         * записи. Ждём её, иначе apply() шёл в rpc.apply, пока spec_set на роутере ещё
         * проверял спеку, и зона фаервола приводилась к прежней спеке (tests/apply-waits-save). */
        if (!this.dirty || !this.saved) { await this.writing; return }
        this.dirty = false
        if (this.timer) { clearTimeout(this.timer); this.timer = null }
        const { spec, drafts } = writable(this.saved)
        this.inflight = true
        this.writing = this.writing.then(async () => {
            try {
                /* В форме движка (спека v2, specv2.ts): правила с сужением подсетей разворачиваются
                 * в правило и его спутника, пулы — в группы. В памяти и в `applied` остаётся форма
                 * интерфейса — иначе счётчик «Применить · N» сравнивал бы разные формы. */
                const r = await rpc.specSet(JSON.stringify(encodeSpec(spec)))
                    .catch((e) => ({ ok: false, error: String(e instanceof Error ? e.message : e) }))
                /* Что теперь на роутере — опора слияния после применения. Только при удаче: отказ
                 * ничего там не поменял. */
                if (r.ok) this.written = spec
                if (!r.ok) {
                    /* Отказ dry-run — это не «потеряно»: спека осталась в памяти, человек
                     * видит причину и правит дальше; следующая правка попробует снова. */
                    notify(('error' in r && r.error) || S.pending.neUdalosSohranit, 'error')
                    this.dirty = true
                    this.emit()
                } else if (drafts) {
                    /* Уехало всё, кроме черновика — он и остаётся несохранённым: без галочки
                     * (она обещала бы то, чего не случилось) и с признаком «есть несохранённое»
                     * для страховки на выгрузку. */
                    this.dirty = true
                    this.emit()
                } else {
                    /* Записано — теперь и только теперь галочка. */
                    this.flash()
                    const warn = 'warn' in r && r.warn ? String(r.warn) : ''
                    if (warn && warn !== this.lastWarn)
                        /* Сохранение прошло, но список не скачался или не годится — значит его
                         * канал не поднимется. Молчать нельзя: человек выбрал сервис, интерфейс
                         * мигнул «Сохранено», а работать оно не будет, и связь между этими
                         * событиями восстановить нечем. Жёлтым, а не красным: запись удалась,
                         * это предупреждение, а не отказ. */
                        notify(warn, 'warning')
                    this.lastWarn = warn
                }
            } finally {
                /* В finally, а не в трёх ветках: признак «в полёте» обязан сниматься при любом
                 * исходе, включая исключение, — иначе страховка на выгрузку начнёт спрашивать
                 * про несохранённое там, где всё давно записано. */
                this.inflight = false
            }
        })
        await this.writing
    }

    /** Есть ли правка, которая ещё НЕ уехала на роутер: либо ждёт своих 500 мс, либо
     *  прошлая запись отказала. Нужен снаружи — по нему страховка на выгрузку решает,
     *  спрашивать ли человека. */
    hasUnsaved(): boolean {
        return this.dirty || this.inflight
    }

    /** Сколько правил и выходов отличается от применённого. Позиционно по каналам:
     *  порядок — это приоритет, перестановка тоже изменение. */
    count(): number {
        const a = this.applied
        const s = this.saved
        if (!a || !s) return 0
        let n = 0
        const names = new Set([...Object.keys(a.outputs || {}), ...Object.keys(s.outputs || {})])
        const changed = [...names].filter((name) => same(a.outputs?.[name], s.outputs?.[name]) === false)
        for (const name of changed) {
            /* Служебная часть пула считается вместе со своим пулом, если тот тоже изменился:
             * человек собрал ОДИН выход, и «Применить · 3» на нём читалось бы как три правки,
             * которых он не делал. Изменилась одна часть при прежнем пуле — это правка, и она
             * считается. */
            const pool = (s.outputs?.[name] ?? a.outputs?.[name])?.part_of
            if (pool && changed.includes(pool)) continue
            n++
        }
        /* Каналов может не быть вовсе: спека приезжает от бэкенда и из архива, а поле
         * необязательное. Считать длину у отсутствующего массива значило бы уронить весь
         * экран на разборе чужого файла. */
        const ac = a.channels || []
        const sc = s.channels || []
        const len = Math.max(ac.length, sc.length)
        for (let i = 0; i < len; i++)
            if (same(ac[i], sc[i]) === false) n++
        /* Всё остальное в спеке — устройства клиентов (lan_devices), подсети (from_default),
         * режим доменов — одна правка, если отличается. Пока считались только выходы и правила,
         * человек добавлял tailscale0 в «Кого маршрутизируем», правка уезжала на роутер сама, а
         * пилюли «Применить» не появлялось: нажать было нечего, снимок применённого не
         * обновлялся, движок правила не перечитывал, и диагностика (она считает по снимку)
         * продолжала говорить «трафик забирается с br-lan» (обращение из Telegram, Андромеда).
         * Одной правкой, а не по ключу: это одна карточка настроек, и «Применить · 1» на ней
         * читается верно. */
        if (same(rest(a), rest(s)) === false) n++
        return n
    }

    /** Идёт ли применение или его хвост. ОКНО ДЛИННЕЕ САМОГО ВЫЗОВА: apply на роутере — это
     *  `steer apply`, перезапуск клиентов vless сигналом, подъём обработчиков обхода и ещё
     *  до четырёх секунд ожидания их старта; клиент туннеля после сигнала перечитывает узлы и
     *  поднимается секунды. Пока это идёт, `status` честно отвечает «выход не поднят», а
     *  `diag` — «правил в ядре нет», и показывать это как поломку значило бы пугать человека
     *  каждым нажатием «Применить» (владелец: «пока применяет — пишет про ошибки, так не
     *  должно быть»). Пятнадцать секунд — с запасом к худшему замеру; окно закрывается само,
     *  и дальше опрос судит как обычно. */
    settling(): boolean {
        return this.applying || Date.now() - this.appliedAt < SETTLE_MS
    }

    async apply() {
        if (this.applying) return
        this.applying = true
        let release!: () => void
        this.applyDone = new Promise<void>((r) => { release = r })
        this.emit()
        try {
            /* Всё, что ещё не уехало, — ДО вызова и мимо ожидания записи (оно для чужих правок). */
            await this.flush(true)
            /* Опора слияния — что на роутере сейчас. Берётся до вызова: после него правки за время
             * применения от записанного уже не отличить. Не загруженное через load() (стенд, прямая
             * подстановка) — то, что в памяти: правки, сделанные позже, всё равно от него отличны. */
            const base = this.written ?? (this.saved ? writable(this.saved).spec : null)
            let ok = false
            try {
                const r = await rpc.apply()
                ok = r.ok
                notify(applyText(r.output) || (r.ok ? S.pending.primeneno : S.pending.sboyPrimeneniya), r.ok ? 'info' : 'error')
            } catch (e) {
                notify(String(e instanceof Error ? e.message : e), 'error')
            }
            /* Сверка с роутером — при любом исходе вызова, а не только при удаче: apply правит файл
             * (самолечение) ДО того, как ядро примет или отвергнет спеку, а оборванный ответ (таймаут
             * ubus при ещё идущем apply) не значит, что на роутере ничего не изменилось. */
            await this.refresh(base, ok)
            if (ok) {
                this.justApplied = true
                this.emit()
                setTimeout(() => { this.justApplied = false; this.emit() }, 1800)
            }
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            this.applying = false
            this.appliedAt = Date.now()
            release()
            this.emit()
        }
    }

    /** Сверить память страницы с роутером после применения.
     *
     *  «Применённое» берётся у бэкенда (applied_get) — это снимок, который он снял сам, уже с
     *  вылеченными ключами. Прежде оно бралось из памяти: `writable(saved)` после ответа, то есть
     *  вместе с правками, сделанными за время применения, — они выглядели применёнными, хотя ядро
     *  их не видело. Снимок не отдан, а применение удалось, — это то, что лежит на роутере (снимок
     *  снимается с того же файла), а если не отдан и он, то то, что мы отправили до вызова.
     *
     *  Сохранённое — то, что лежит на роутере, слитое с тем, что человек успел поправить за это
     *  время (mergeSpec). Ничего не поправлял — просто то, что лежит там. Не ответил — остаётся
     *  прежняя память: применение удалось, и отказом его делать незачем; хуже от этого только то,
     *  что вылеченные ключи пропадут при первой правке и вернутся при следующем apply, как и было.
     *
     *  Исключений наружу нет: сверка не должна превращать удавшееся применение в красный тост. */
    private async refresh(base: Spec | null, applied: boolean) {
        let replaced = false
        try {
            /* Своя запись, ещё летящая (уход со страницы пишет мимо ожидания), дописывается до
             * чтения: иначе прочитанное оказалось бы на её полшага раньше, и сверка пересылала бы то
             * же второй раз. */
            await this.writing.catch(() => {})
            /* Одна повторная попытка, а не все паузы первой загрузки: rpcd apply не перезапускает,
             * так что отказ здесь — не «объект ещё не поднялся», а роутер, которому не до нас. */
            const [disk, snap] = await Promise.all([
                this.readSpec(LOAD_RETRY_MS.slice(0, 1)).catch(() => null),
                Promise.resolve().then(() => rpc.appliedGet()).catch(() => null),
            ])
            /* Спека прежнего формата, не переписанная при загрузке (ядро старше минимума), в памяти
             * живёт без `schema` — так же, как при первой загрузке. */
            const fresh = disk && (wasV1(disk) ? { ...disk, schema: undefined } : disk)
            if (snap) this.applied = snap
            else if (applied) this.applied = fresh || base || this.applied
            const mine = this.saved
            if (fresh && mine) {
                this.written = fresh
                const merged = mergeSpec(base ?? writable(mine).spec, mine, fresh)
                if (!same(merged, mine)) { this.saved = merged; replaced = true }
                /* Есть то, чего на роутере нет, — правка за время применения. Черновики не в счёт:
                 * они туда не ездят, и записывать ради них то же самое незачем. */
                if (!same(writable(merged).spec, fresh)) { this.dirty = true; this.arm() }
            }
        } catch {
            /* см. выше: сверка — не отказ применения */
        }
        this.emit()
        if (replaced && this.saved) for (const fn of this.replaced) fn(this.saved)
    }
}

/** Паузы между попытками первой загрузки спеки, мс. Меняется только в стенде. */
export let LOAD_RETRY_MS: number[] = [700, 2000]
export function setLoadRetry(ms: number[]) { LOAD_RETRY_MS = ms }

/** Хвост применения: сколько после ответа apply ответы опроса считаются переходными. */
export const SETTLE_MS = 15000

export const pending = new PendingStore()

/* СТРАХОВКА НА УХОД СО СТРАНИЦЫ. Правка живёт в браузере до 500 мс — столько ждёт дебаунс, —
 * и этого хватает, чтобы её потерять: человек создаёт правило и сразу обновляет страницу.
 * Именно так и пришло сообщение об ошибке (splify2#11: «после создания правила и перезагрузки
 * страницы пропадает правило»). С прежней кнопкой «Сохранить» такого случиться не могло:
 * человек знал, отправил он что-нибудь или нет.
 *
 * Два крюка, и они делают разное. `visibilitychange`/`pagehide` — попытка ДОПИСАТЬ: браузер
 * ещё разрешает начатый запрос, и в большинстве случаев этого достаточно. `beforeunload` —
 * последняя черта: если правка всё ещё не уехала, человека СПРАШИВАЮТ, а не теряют её молча.
 * Спрашивается только при действительно несохранённом (окно дебаунса или отказ прошлой
 * записи), поэтому в обычной работе диалога не видно. */
if (typeof window !== 'undefined') {
    /* Мимо ожидания записи на время применения (flush(true)): после ухода писать будет некому, а
     * потерять правку хуже, чем разойтись с самолечением бэкенда, которое при следующем apply
     * вернётся. */
    const flushNow = () => {
        if (pending.hasUnsaved()) void pending.flush(true)
    }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushNow()
    })
    window.addEventListener('pagehide', flushNow)
    window.addEventListener('beforeunload', (e) => {
        if (!pending.hasUnsaved()) return
        /* Текст сообщения браузеры давно не показывают — важен сам факт отмены события. */
        e.preventDefault()
        e.returnValue = ''
    })
}

/** Подписка для компонентов: пилюли, вкладок, индикатора «Сохранено». */
export function usePending() {
    const [, force] = useState(0)
    useEffect(() => pending.subscribe(() => force((n) => n + 1)), [])
    return {
        /** Сохранённая спека — та же, что видят разделы. Нужна рельсу для счётчика «Правила N»:
         *  спрашивать её отдельным вызовом значило бы показать в рельсе одно число, а в
         *  разделе рядом другое. null, пока не загружена. */
        spec: pending.saved,
        loadFailed: pending.loadFailed,
        retry: () => pending.retry(),
        count: pending.count(),
        applying: pending.applying,
        justApplied: pending.justApplied,
        savedFlash: pending.savedFlash,
        applied: pending.applied,
        apply: () => void pending.apply(),
    }
}

/** Поля, отсутствие которых значит РОВНО ТО ЖЕ, что записанное значение.
 *
 *  Взято из контракта движка (steer/docs/contract-v1.md): поля нет — действует умолчание.
 *  Имена не пересекаются между каналом и выходом в этой схеме (`enabled` и `mode` бывают
 *  только у канала, `on_fail` и `node` — только у выхода), поэтому таблица одна на оба.
 *
 *  ЗАЧЕМ. Интерфейс пишет умолчания ЯВНО, а движок и архивы — как получилось. Пока сравнение
 *  шло по JSON.stringify, выключить правило и включить обратно означало вечное «Применить · 1»
 *  на правке, которая ничего не меняет: в спеке появлялось `"enabled": true`, которого в
 *  снимке применённого не было. Поймано живым проходом по интерфейсу — пилюля висела над
 *  списком и перехватывала клики по строкам под собой. */
const DEFAULTS: Record<string, unknown> = {
    enabled: true,
    on_fail: 'drop',
    mode: 'fakeip',
    /** −1 и пустой список означают одно: «первый рабочий среди всех пригодных». */
    node: -1,
}

/** Канонический вид для СРАВНЕНИЯ (не для записи): ключи по алфавиту, поля с умолчанием и
 *  пустые списки выброшены.
 *
 *  Порядок ключей тоже выброшен нарочно: он ничего не значит ни для движка, ни для человека,
 *  а JSON.stringify считал его различием — то есть спека, пересобранная другим порядком
 *  полей, показывала бы «не применено» на всех правилах сразу. */
function canon(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canon)
    if (!v || typeof v !== 'object') return v
    const src = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(src).sort()) {
        const val = src[k]
        if (val === undefined) continue
        if (k in DEFAULTS && val === DEFAULTS[k]) continue
        if (Array.isArray(val) && val.length === 0) continue
        out[k] = canon(val)
    }
    return out
}

/** Спека без выходов и правил — то, что счётчик сравнивает целиком, одной правкой. `schema`
 *  и `lan_device` сюда не входят: первое — номер формы записи, а не настройка (движку уезжает
 *  свой, см. expandNarrow), второе normalizeSpec уже привёл к `lan_devices`. */
function rest(spec: Spec): Record<string, unknown> {
    const { outputs: _o, channels: _c, schema: _s, lan_device, lan_devices, ...r } =
        spec as Spec & { lan_device?: string }
    /* Устройства клиентов — к одной форме: одиночная запись `lan_device` (спека времён 1.2.5)
     * и отсутствие поля значат «br-lan», и снимок применённого в такой форме против списка
     * из одного элемента в сохранённом давал бы вечное «Применить · 1» — ровно та беда, ради
     * которой этот стенд заведён. Умолчание то же, что у движка и у карточки. */
    const devs = lan_devices?.length ? lan_devices : lan_device ? [lan_device] : ['br-lan']
    return { ...r, lan_devices: devs }
}

/** Одно и то же ли это по смыслу. Отдельной функцией, чтобы сравнение стояло в одном месте:
 *  каналы и выходы сравниваются по одному правилу, и разойтись они не должны. */
function same(a: unknown, b: unknown): boolean {
    return JSON.stringify(canon(a)) === JSON.stringify(canon(b))
}

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Трёхстороннее слияние спеки: `base` — что роутер хранил до применения, `mine` — что в памяти
 *  сейчас (с правками человека за это время), `theirs` — что он хранит после (бэкенд мог дописать
 *  вылеченные ключи).
 *
 *  Правило одно, по каждому месту спеки: человек его не трогал — берётся роутерное; роутер его не
 *  менял — берётся память; тронули оба — объекты сливаются по ключам вглубь, а на листе и в
 *  списке побеждает память: правка человека свежее, а у списков (правила, перечни устройств) своей
 *  правки у бэкенда нет и склеивать их поэлементно было бы гаданием. Порядок ключей — как в
 *  памяти: порядок выходов человек видит на экране, а спека пишется в нём же.
 *
 *  Исключение — когда роутер сменил ВИД записи, которую человек тоже правил (у пула членов с
 *  разным ipv6 лечение делает из пула группу, а члены становятся выходами): ключи двух видов в
 *  одну запись не складываются, а осиротевшие соседние записи рассыпали бы пул. Тогда вся спека
 *  берётся из памяти: лечение вернётся при следующем apply, а правка человека не пропадёт.
 *
 *  «Не трогал» — по смыслу (same), а не по тексту: явное умолчание не правка. */
export function mergeSpec(base: Spec, mine: Spec, theirs: Spec): Spec {
    try {
        return merge3(base, mine, theirs) as Spec
    } catch (e) {
        if (e instanceof Unmergeable) return mine
        throw e
    }
}

/** Слияние невозможно: роутер сменил вид записи, которую человек правил. */
class Unmergeable extends Error {}

function merge3(base: unknown, mine: unknown, theirs: unknown): unknown {
    if (same(mine, base)) return theirs
    if (same(theirs, base)) return mine
    if (isPlain(base) && isPlain(mine) && isPlain(theirs)) {
        if (theirs.kind !== base.kind) throw new Unmergeable()
        const out: Record<string, unknown> = {}
        for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
            const v = merge3(base[k], mine[k], theirs[k])
            if (v !== undefined) out[k] = v
        }
        return out
    }
    return mine
}

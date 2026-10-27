import { useEffect, useState } from 'react'
import { notify } from '@/lib/notify'
import { rpc, revOf } from '@/lib/rpc'
import { cacheGet, cacheSet } from '@/lib/cache'
import type { Channel, Spec } from '@/lib/model'
import { decodeSpec, encodeSpec, wasV1 } from '@/lib/specv2'
import { cmpVersion } from '@/lib/engine'
import { engineErrorText } from '@/lib/engineerr'
import { missingText } from '@/lib/outrefs'
import { same, rest, describeChanges, revertChanges, type Change } from '@/lib/specdiff'

import { S } from '@/copy'
/** Автосохранение и счётчик неприменённого — одно место на весь экран.
 *
 *  Правка уходит в spec_set сама, через полсекунды тишины: кнопок «Сохранить» и «Применить»
 *  нет. Записанное применяет lib/autoapply.ts (через 0,8 с тишины после записи), а count() —
 *  сколько правил и выходов ОТЛИЧАЕТСЯ от применённого: по нему решается, есть ли что применять.
 *  Не счётчик кликов: изменил и вернул обратно — ноль.
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
 *  спеки (speccopy.ts), подмену получает через onReplaced.
 *
 *  ПРИМЕНЕНИЕ ПОСЛЕ ОТКАЗАННОЙ ЗАПИСИ УСПЕХОМ НЕ ЗВУЧИТ. spec_set отвергает спеку ЦЕЛИКОМ, если ядро
 *  её не приняло («выхода «wg1» нет в outputs», список не годится), — правка остаётся в памяти
 *  страницы, а на роутере лежит прежняя спека. Раньше «Применить» после этого шло в apply как ни в
 *  чём не бывало: бэкенд применяет ФАЙЛ, то есть прежнюю спеку, а страница говорила «Применено» и
 *  зажигала зелёную пилюлю — про то, чего на роутере нет (интерфейс рапортовал об успехе там, где
 *  ничего не произошло). Теперь apply() сначала пробует дописать несохранённое, и если запись
 *  отказала (`saveError`), применения нет: тост называет состояние и действие вместе с причиной, а
 *  пилюля стоит с «Не записано» вместо числа, пока запись не удастся. Удавшаяся запись снимает отказ,
 *  и применение идёт как обычно. Черновик правила отказом не считается: на роутер он не едет нарочно,
 *  а всё остальное записано. */

/** Правило без единого сервиса или в режиме «только эти устройства» без единого устройства:
 *  движку такое не отдаётся. Второе редактор хранит как from:[""] — пока человек не отметил
 *  первое устройство; в спеку такое значение (`addr: [""]`) не пишется, ядро считает его ошибкой. */
function isDraft(c: Channel): boolean {
    const m = c.match || {}
    if (c.from?.length && c.from.every((x) => !x.trim())) return true
    return !m.any && !(m.prefixes_files?.length) && !(m.domains_files?.length) && !(m.srs_files?.length)
}

/** Спека в том виде, в каком её увидит страница, прочитав записанное: без черновиков (на роутер
 *  они не едут) и после круга encodeSpec → decodeSpec. Счётчик «Применить · N» обязан сравнивать
 *  ЭТО, а не память: «применённое» приходит с роутера уже прочитанным, а в памяти правило без
 *  единого списка (черновик, или последний список убрали) на роутер не записывается вовсе, и
 *  файлы при сужении портов меняют порядок — разницы нет, а пилюля висела «Применить · 1» после
 *  успешного применения. Спека, которую не удалось пройти кругом, сравнивается как есть. */
const written = new WeakMap<object, Spec>()
function asWritten(spec: Spec): Spec {
    const hit = written.get(spec)
    if (hit) return hit
    let out: Spec
    try { out = decodeSpec(JSON.parse(JSON.stringify(encodeSpec(writable(spec).spec)))) } catch { out = writable(spec).spec }
    written.set(spec, out)
    return out
}

/** Спека без черновиков — то, что едет на роутер. */
export function writable(spec: Spec): { spec: Spec; drafts: number } {
    const channels = spec.channels || []
    const kept = channels.filter((c) => !isDraft(c))
    return { spec: kept.length === channels.length ? spec : { ...spec, channels: kept }, drafts: channels.length - kept.length }
}

/** Строки самолечения в ответе apply: «splify2: outputs without an ipv6 key got ipv6: nat (…): wg0».
 *  Бэкенд пишет их тому, кто смотрит в ssh и журнал (rpcd/m-spec.sh, heal_report), а человеку на
 *  экране они ни к чему (это строки журнала, они всегда английские и не переводятся): ключ — внутренность настройки, а как выход ходит в IPv6, видно в самом
 *  выходе, который после применения перечитан с роутера. Поэтому в тосте их нет. Начало строки то
 *  же, что в бэкенде; сверка с его исходником — в tests/apply-refetch.test.ts. */
const HEAL_LINE = /^splify2: outputs without an ipv6 key got /

/** Текст тоста по ответу apply: слова ядра и зон фаервола — без строк самолечения. */
export function applyText(output: string | undefined): string {
    return engineErrorText((output ?? '')
        .split('\n')
        .filter((l) => !HEAL_LINE.test(l))
        .join('\n')
        .trim())
}

type Listener = () => void

/** Ключ памяти спеки — то, что лежит на роутере, по последним сведениям. */
const SPEC_MEMORY = 'spec'

class PendingStore {
    saved: Spec | null = null
    /** Спека из памяти прошлого открытия (lib/cache.ts) — только чтобы показать сразу, пока роутер не
     *  ответил: правки до настоящей загрузки не принимаются (edit), а после неё она не нужна. */
    remembered: Spec | null = cacheGet<Spec>(SPEC_MEMORY)
    applied: Spec | null = null
    /** Что лежит на роутере, по нашим сведениям: прочитанное при загрузке, записанное последним
     *  удавшимся spec_set, перечитанное после применения. Без черновиков — они туда не едут.
     *  Опора трёхстороннего слияния (mergeSpec): по разнице между ним и `saved` видно, что человек
     *  успел поправить, а по разнице между ним и перечитанным — что сделал за это время роутер. */
    private written: Spec | null = null
    /** Ревизия файла на роутере, от которой начата наша правка (D-P2.7): с spec_get, после удавшегося
     *  spec_set, после сверки с роутером. Уходит в spec_set — роутер отказывает, если файл с тех пор
     *  переписали (вторая вкладка, ssh, подписка), и страница сливает правки (reconcile), а не затирает
     *  чужое. Нет — бэкенд ревизий не отдаёт, пишем без сверки, как прежде. */
    private rev: string | undefined
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
    /** Последнее применение не удалось: на роутере прежнее, а не то, что на экране. Снимается
     *  удавшимся применением. Нужен страховке на уход со страницы (unfinished). */
    applyFailed = false
    /** Пачка правок в работе (hold): автоприменение ждёт её конца и применяет один раз. */
    private holds = 0
    /** Сколько правок сделано с открытия страницы (edit). Автоприменение откликается на правки
     *  человека, а не на подмену спеки при сверке после apply: иначе отказавшее применение
     *  повторялось бы по кругу. */
    editSeq = 0
    private lastWarn = ''

    private listeners = new Set<Listener>()
    private timer: ReturnType<typeof setTimeout> | null = null
    private writing: Promise<void> = Promise.resolve()
    dirty = false
    /** Почему последняя запись на роутер отказала — словами для человека; `null` — не отказывала
     *  (или после отказа записалось). Отдельно от `dirty`: тот же признак стоит и у черновика, который
     *  на роутер не едет нарочно, а применять при нём можно — всё остальное записано. Отказ же
     *  значит, что на роутере прежняя спека, и применение показало бы чужой успех (см. apply). */
    saveError: string | null = null
    /** Запись НА ЛЕТУ. Отдельно от dirty потому, что flush снимает dirty ещё до ответа
     *  роутера: без этого признака страховка на выгрузку считала бы уехавшим то, что как раз
     *  сейчас в полёте, и браузер имел бы полное право оборвать запрос молча. */
    inflight = false
    private flashTimer: ReturnType<typeof setTimeout> | null = null

    subscribe(fn: Listener) {
        this.listeners.add(fn)
        return () => { this.listeners.delete(fn) }
    }
    private emit() {
        /* Что лежит на роутере — в память, чтобы следующее открытие показало это сразу. */
        if (this.written && this.written !== this.rememberedWritten) {
            this.rememberedWritten = this.written
            cacheSet(SPEC_MEMORY, this.written)
        }
        for (const fn of this.listeners) fn()
    }
    private rememberedWritten: Spec | null = null

    /** Хранилище подменило спеку НЕ по правке человека, а по тому, что лежит на роутере (после
     *  применения). Нужна разделам, которые правят спеку на месте со своей копией в состоянии:
     *  без подмены их следующая правка выросла бы из прежней копии и записала её поверх свежей. */
    get held(): boolean {
        return this.holds > 0
    }

    /** Остановить автоприменение на время пачки (восстановление из копии, подписка с выходом):
     *  правки пачки записываются как обычно, но роутер не трогается, пока не отпущены все hold.
     *  Отпускание шлёт оповещение, и автоприменение применяет накопленное ОДНИМ применением.
     *  Возвращает функцию отпускания (повторный вызов безвреден). */
    hold(): () => void {
        this.holds++
        let done = false
        return () => {
            if (done) return
            done = true
            this.holds--
            this.emit()
        }
    }

    /** Пачка: hold на время fn, отпускание — даже при исключении. */
    async batch<T>(fn: () => Promise<T>): Promise<T> {
        const release = this.hold()
        try { return await fn() } finally { release() }
    }

    /** Есть то, что на роутер ещё не легло: идёт применение, правка не записана, или записанное
     *  отличается от применённого (ждёт автоприменения либо оно не удалось). */
    unfinished(): boolean {
        return this.applying || this.hasUnsaved() || this.applyFailed || this.count() > 0
    }

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
        /* Снимка применённого нет (ещё ни разу не применяли) — считаем применённым сохранённое:
         * счётчик стартует с нуля. */
        const applied = await rpc.appliedGet().catch(() => null)
        if (!this.saved) {
            /* Спека прежнего формата (v1) переписывается в v2 сразу, без участия человека:
             * движок 2.0 v1 больше не читает. Смысл правил не меняется, поэтому счётчик
             * «Применить · N» остаётся нулём (сравнение идёт по модели, а не по записи), а
             * бэкенд перед заменой оставляет копию прежнего файла рядом. */
            const migrate = wasV1(saved)
            this.saved = migrate ? { ...saved, schema: undefined } : saved
            this.written = this.saved
            this.rev = revOf(saved)
            this.applied = applied ?? this.saved
            this.saveError = null
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
        const prev = this.saved
        this.saved = next
        this.dirty = true
        this.editSeq++
        this.emit()
        this.arm()
        this.offerUndo(prev, next)
    }

    /** Удалённое правило или выход возвращается кнопкой в сообщении, а не вопросом «вы уверены?»
     *  заранее (D-P2.4). Удалением считается правка, где что-то ушло и ничего не пришло: переименование
     *  правила при наборе имени — это «ушло и пришло», его не показываем. Дешёвая проверка длин
     *  стоит перед полным сравнением: правок набора текста — десятки в секунду, а удалений — единицы. */
    private offerUndo(prev: Spec, next: Spec) {
        try {
            const shrank = (next.channels?.length ?? 0) < (prev.channels?.length ?? 0) ||
                Object.keys(next.outputs || {}).length < Object.keys(prev.outputs || {}).length
            if (!shrank) return
            const all = describeChanges(prev, next)
            if (all.some((c) => c.kind === 'added' && (c.subject === 'rule' || c.subject === 'output'))) return
            const gone = all.filter((c) => c.kind === 'removed')
            if (!gone.length) return
            const rules = gone.filter((c) => c.subject === 'rule')
            const outs = gone.filter((c) => c.subject === 'output')
            const text = gone.length === 1
                ? (rules.length ? S.changes.udalenoPravilo(rules[0].name) : S.changes.udalenVyhod(outs[0].name))
                : S.changes.udaleno(rules.length, outs.length)
            notify(text, 'info', { label: S.changes.vernut, run: () => this.revert(gone) })
        } catch {
            /* Подсказка об удалении не должна ронять правку. */
        }
    }

    /** Отменить перечисленные изменения поверх текущей спеки — обычной правкой: запишется и
     *  применится само, как любая другая. */
    revert(changes: Change[]) {
        if (!this.saved || !changes.length) return
        this.edit(revertChanges(this.saved, changes))
    }

    /** Что записано, но не применено: строки «Что изменится». Считается по тому, что увидит роутер
     *  (asWritten): черновик правила и порядок файлов разницей не считаются, как и в count(). */
    private pendingMemo: { a: Spec; s: Spec; list: Change[] } | null = null
    changes(): Change[] {
        if (!this.applied || !this.saved) return []
        const m = this.pendingMemo
        if (m && m.a === this.applied && m.s === this.saved) return m.list
        const list = describeChanges(asWritten(this.applied), asWritten(this.saved))
        this.pendingMemo = { a: this.applied, s: this.saved, list }
        return list
    }

    /** Последнее удавшееся применение: что в нём поменялось — строки «Что изменилось» с отменой.
     *  Нет изменений (применение без правок) — не запоминается. */
    lastApplied: { at: number; changes: Change[] } | null = null

    /** Строки «Что изменилось» убраны с экрана: отменены или скрыты. */
    dismissApplied(ids?: string[]) {
        const la = this.lastApplied
        if (!la) return
        const left = ids ? la.changes.filter((c) => !ids.includes(c.id)) : []
        this.lastApplied = left.length ? { ...la, changes: left } : null
        this.emit()
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
     *  вызова бэкенда) и уходу со страницы (после него писать будет некому).
     *
     *  `quiet` — отказ записи тостом не говорить: его скажет вызывающий. Нужен apply: он отвечает на
     *  отказ отменой применения и называет причину в том же сообщении, а две красные полосы про одно и
     *  то же заслоняют друг друга. Итог записи — в `saveError`, тихо или нет. */
    async flush(force = false, quiet = false) {
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
        let { spec, drafts } = writable(this.saved)
        this.inflight = true
        this.writing = this.writing.then(async () => {
            try {
                /* В форме движка (спека v2, specv2.ts): правила с сужением подсетей разворачиваются
                 * в правило и его спутника, пулы — в группы. В памяти и в `applied` остаётся форма
                 * интерфейса — иначе счётчик «Применить · N» сравнивал бы разные формы. */
                const send = () => rpc.specSet(JSON.stringify(encodeSpec(spec)), this.rev)
                    .catch((e) => ({ ok: false, error: String(e instanceof Error ? e.message : e) } as Awaited<ReturnType<typeof rpc.specSet>>))
                let r = await send()
                /* РОУТЕР ОТКАЗАЛ: СПЕКУ ПЕРЕПИСАЛИ ЗА СПИНОЙ (conflict). Читаем, что там лежит, сливаем
                 * с правкой (reconcile) и пишем слитое от свежей ревизии. Несколько кругов, а не один:
                 * кто-то мог успеть и между чтением и записью; предел — защита от вечного спора двух
                 * страниц, не ограничение ради памяти. */
                for (let n = 0; !r.ok && r.conflict && n < 5; n++) {
                    if (!(await this.reconcile())) break
                    if (!this.saved) break
                    ;({ spec, drafts } = writable(this.saved))
                    r = await send()
                }
                /* Что теперь на роутере — опора слияния после применения. Только при удаче: отказ
                 * ничего там не поменял. */
                if (r.ok) { this.written = spec; this.saveError = null; this.rev = r.rev || undefined }
                if (!r.ok) {
                    /* Отказ dry-run — это не «потеряно»: спека осталась в памяти, человек
                     * видит причину и правит дальше; следующая правка попробует снова.
                     *
                     * Причина — не слова ядра, если дело в выходе, которого нет: «dns.upstreams.cf.out:
                     * выхода «wg1» нет в outputs» с путём временного файла человеку ничего не говорит.
                     * Он видит, кто на этот выход ссылается и что с этим делать (lib/outrefs.ts).
                     *
                     * Отказ ещё и ЗАПОМИНАЕТСЯ (saveError): на роутере теперь прежняя спека, и пока
                     * запись не удастся, «Применить» применять не должно (apply), а пилюля — говорить
                     * «Не записано». */
                    const why = missingText(spec) ?? engineErrorText(('error' in r && r.error) || S.pending.neUdalosSohranit)
                    this.saveError = why
                    if (!quiet) notify(S.pending.nastroykiNeZapisany(why), 'error')
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
                this.emit()
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
        if (!this.applied || !this.saved) return 0
        const a = asWritten(this.applied)
        const s = asWritten(this.saved)
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
        /* Отказанное применение ничего не перестраивало, и окна «применяется» (settling) оно не открывает. */
        let refused = false
        try {
            /* Всё, что ещё не уехало, — ДО вызова и мимо ожидания записи (оно для чужих правок). */
            await this.flush(true, true)
            /* ЗАПИСЬ ОТКАЗАЛА — ПРИМЕНЯТЬ НЕЧЕГО. Бэкенд применяет файл на роутере, а там прежняя спека:
             * вызов прошёл бы «успешно», тост сказал бы «Применено», пилюля позеленела бы — про то, чего
             * на роутере нет. Флаг dirty для этого не годится: он стоит и у черновика правила, который
             * на роутер не едет нарочно, а применять при нём можно. Вызова нет, сверки нет (снимок
             * применённого тот же, что был), галочки «Применено» нет, правка остаётся в памяти; человек
             * получает состояние и действие, а повторное нажатие снова начнёт с записи. */
            if (this.saveError !== null) {
                refused = true
                this.applyFailed = true
                notify(S.pending.nastroykiNeZapisany(this.saveError), 'error')
                return
            }
            /* Опора слияния — что на роутере сейчас. Берётся до вызова: после него правки за время
             * применения от записанного уже не отличить. Не загруженное через load() (стенд, прямая
             * подстановка) — то, что в памяти: правки, сделанные позже, всё равно от него отличны. */
            const base = this.written ?? (this.saved ? writable(this.saved).spec : null)
            let ok = false
            const appliedBefore = this.applied
            try {
                const r = await rpc.apply()
                ok = r.ok
                notify(r.ok ? (applyText(r.output) || S.pending.primeneno) : S.pending.neprimeneno(applyText(r.output) || S.pending.sboyPrimeneniya), r.ok ? 'info' : 'error')
            } catch (e) {
                notify(S.pending.neprimeneno(String(e instanceof Error ? e.message : e)), 'error')
            }
            this.applyFailed = !ok
            /* Сверка с роутером — при любом исходе вызова, а не только при удаче: apply правит файл
             * (самолечение) ДО того, как ядро примет или отвергнет спеку, а оборванный ответ (таймаут
             * ubus при ещё идущем apply) не значит, что на роутере ничего не изменилось. */
            await this.refresh(base, ok)
            if (ok) {
                if (appliedBefore && base) {
                    const changes = describeChanges(asWritten(appliedBefore), asWritten(base))
                    this.lastApplied = changes.length ? { at: Date.now(), changes } : null
                }
                this.justApplied = true
                this.emit()
                setTimeout(() => { this.justApplied = false; this.emit() }, 1800)
            }
        } catch (e) {
            this.applyFailed = true
            notify(S.pending.neprimeneno(String(e instanceof Error ? e.message : e)), 'error')
        } finally {
            this.applying = false
            if (!refused) this.appliedAt = Date.now()
            release()
            this.emit()
        }
    }

    /** Спеку на роутере переписали после нашего чтения (spec_set вернул conflict): прочитать её и
     *  слить с правкой тем же трёхсторонним слиянием, что после применения — основа то, что мы о
     *  роутере знали (`written`), «моё» — память, «их» — то, что лежит. Если из чужого что-то
     *  вошло, человеку об этом говорится: правка не потеряна, но экран только что изменился. Код
     *  `false` — прочитать не удалось: запись отказывает, как при любой другой ошибке. */
    private async reconcile(): Promise<boolean> {
        const mine = this.saved
        if (!mine) return false
        let disk: Spec
        try { disk = await this.readSpec([]) } catch { return false }
        const fresh = wasV1(disk) ? { ...disk, schema: undefined } : disk
        const merged = mergeSpec(this.written ?? writable(mine).spec, mine, fresh)
        this.written = fresh
        this.rev = revOf(disk)
        if (!same(merged, mine)) {
            this.saved = merged
            notify(S.pending.nastroykiIzmenilis, 'info')
            this.emit()
            for (const fn of this.replaced) fn(merged)
        }
        return true
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
                this.rev = disk ? revOf(disk) : undefined
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
let LOAD_RETRY_MS: number[] = [700, 2000]
export function setLoadRetry(ms: number[]) { LOAD_RETRY_MS = ms }

/** Хвост применения: сколько после ответа apply ответы опроса считаются переходными. */
const SETTLE_MS = 15000

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
 * Спрашивается только пока что-то не дошло до роутера (pending.unfinished): правка не записана
 * (окно дебаунса или отказ записи), записанное ещё ждёт автоприменения (0,8 с тишины), применение
 * идёт или не удалось. Автоприменение живёт в странице, поэтому уход посреди него оставил бы
 * роутер на прежних настройках; в обычной работе диалога не видно. */
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
        if (!pending.unfinished()) return
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
        /** Спека для показа: загруженная, а до её прихода — из памяти прошлого открытия. Писать по
         *  ней нельзя — для правок есть `spec`. */
        shown: pending.saved ?? pending.remembered,
        loadFailed: pending.loadFailed,
        retry: () => pending.retry(),
        count: pending.count(),
        /** Почему последняя запись отказала (текст для человека) — пилюля «Применить» говорит об
         *  этом вместо числа; `null` — не отказывала. */
        saveError: pending.saveError,
        applying: pending.applying,
        justApplied: pending.justApplied,
        savedFlash: pending.savedFlash,
        applied: pending.applied,
        apply: () => void pending.apply(),
    }
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
 *  Исключение — когда роутер сменил ВИД записи, которую человек тоже правил (пул стал группой с
 *  членами-выходами или наоборот — файл поправили мимо страницы): ключи двух видов в одну запись не
 *  складываются, а осиротевшие соседние записи рассыпали бы пул. Тогда вся спека берётся из памяти:
 *  чужая правка вернётся при следующем apply, а правка человека не пропадёт. Самолечение сюда не
 *  относится: пул с разным ipv6 у членов читается пулом (`ipv6_by_device`), и лечение дописывает
 *  ключи, не меняя вида.
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
            /* Правила — по именам, а не целым списком (D-P2.7): две вкладки добавили по правилу —
             * в спеке должны остаться оба, а не победитель по времени записи. */
            const byName = k === 'channels' ? mergeNamed(base[k], mine[k], theirs[k]) : null
            if (byName) { out[k] = byName; continue }
            const v = merge3(base[k], mine[k], theirs[k])
            if (v !== undefined) out[k] = v
        }
        return out
    }
    return mine
}

/** Слияние списка правил по именам: порядок — как у человека (приоритет задаёт он), каждая запись
 *  сливается с одноимённой (merge3), добавленное и изменённое чужой стороной не теряется, а удалённое
 *  одной стороной уходит, если вторая его не правила. Правила чужой стороны, которых у нас нет и не
 *  было, встают после своей предшественницы из её порядка. `null` — слить по именам нельзя (имена
 *  повторяются или это не списки правил): вызывающий возьмёт прежнее решение. */
function mergeNamed(base: unknown, mine: unknown, theirs: unknown): unknown[] | null {
    const lists = [base ?? [], mine ?? [], theirs ?? []]
    if (!lists.every((l) => Array.isArray(l))) return null
    const [b, m, t] = lists as Record<string, unknown>[][]
    const key = (l: Record<string, unknown>[]) => {
        const names = l.map((c) => (isPlain(c) && typeof c.name === 'string' ? c.name : null))
        return names.includes(null) || new Set(names).size !== names.length ? null : (names as string[])
    }
    const bn = key(b), mn = key(m), tn = key(t)
    if (!bn || !mn || !tn) return null
    const at = (l: Record<string, unknown>[], names: string[], n: string) => l[names.indexOf(n)]
    const out: unknown[] = []
    for (const n of mn) {
        const mine1 = at(m, mn, n)
        const base1 = bn.includes(n) ? at(b, bn, n) : undefined
        if (!tn.includes(n)) {
            /* Роутер правило убрал: уходит, если мы его не трогали. */
            if (base1 !== undefined && same(mine1, base1)) continue
            out.push(mine1)
        } else if (base1 === undefined) out.push(mine1)
        else {
            try { out.push(merge3(base1, mine1, at(t, tn, n))) } catch (e) {
                if (e instanceof Unmergeable) out.push(mine1); else throw e
            }
        }
    }
    /* Мы убрали правило, а роутер его поправил — правка роутера дороже нашего удаления. */
    for (const n of bn) {
        if (mn.includes(n) || !tn.includes(n)) continue
        if (!same(at(t, tn, n), at(b, bn, n))) out.push(at(t, tn, n))
    }
    /* Новое на роутере — после предшественницы из его же порядка. */
    tn.forEach((n, i) => {
        if (bn.includes(n) || mn.includes(n)) return
        const idx = (x: string) => out.findIndex((c) => isPlain(c) && c.name === x)
        let pos = -1
        for (let j = i - 1; j >= 0 && pos < 0; j--) if (idx(tn[j]) >= 0) pos = idx(tn[j]) + 1
        /* Предшественниц нет — перед ближайшей последующей, а нет и их — в конец. */
        for (let j = i + 1; j < tn.length && pos < 0; j++) if (idx(tn[j]) >= 0) pos = idx(tn[j])
        out.splice(pos < 0 ? out.length : pos, 0, at(t, tn, n))
    })
    return out
}

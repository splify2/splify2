import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, Spec } from '@/lib/model'

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

import ApplyPill from '@/components/ApplyPill'
import { notify } from '@/lib/notify'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { decodeSpec } from '@/lib/specv2'

// «ПРИМЕНИТЬ» ПОСЛЕ ОТКАЗАННОЙ ЗАПИСИ НЕ РАПОРТУЕТ УСПЕХ.
//
// Правка уезжает на роутер сама (edit → flush → spec_set), а spec_set отвергает спеку ЦЕЛИКОМ, если
// ядро её не приняло: «dns.upstreams.cf.out: выхода «wg1» нет в outputs». Для автосохранения это
// штатная ветка — правка остаётся в памяти (dirty), внизу красный тост. Но если после этого нажать
// «Применить», apply() звал rpc.apply, а тот применяет ФАЙЛ на роутере, то есть прежнюю спеку, а не
// ту, что на экране, — и поверх неё вставал тост «Применено» и зелёная галочка. Интерфейс рапортовал
// об успехе там, где ничего не произошло (замечание проверки по обращению из Telegram: «когда
// удаляешь выход, настройки не применяются, если через него идёт DNS»).
//
// Теперь apply() сначала пробует дописать всё, что не уехало: отказала запись — применения нет, тост
// говорит состояние и действие («Настройки не записаны — исправьте и примените снова» и причина),
// пилюля — «Не записано» вместо числа. Записалось — применение идёт как обычно.
//
// Бэкенд и ядро здесь — маленькая модель: ядро отвергает ссылку сервера DNS на выход, которого нет
// (слова — дословно те, что снял настоящий `steer apply --dry-run`, см. output-refs.test.ts), apply
// применяет файл на диске и снимает с него снимок.

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const CF = { url: 'https://cloudflare-dns.com/dns-query', ips: ['1.1.1.1'] }

/** Что на роутере: два туннеля, правило и сервер DNS, который ходит через wg1. */
const GOOD: Spec = {
    outputs: {
        direct: { name: 'direct', kind: 'direct' },
        wg0: { name: 'wg0', kind: 'interface', device: 'wg0', ipv6: 'off' },
        wg1: { name: 'wg1', kind: 'interface', device: 'wg1', ipv6: 'off' },
    },
    channels: [{ name: 'Новости', out: 'wg0', match: { any: true } }],
    dns: { upstream: 'cf', upstreams: { cf: { ...CF, out: 'wg1' } } },
}

/** Выход wg1 убран, а сервер DNS «cf» всё ещё идёт через него: ядро такую спеку отвергает. */
function dangling(): Spec {
    const s = clone(GOOD)
    delete s.outputs.wg1
    return s
}

/** Тот же убранный выход, но серверу DNS выбран другой: спека целая. */
function fixed(): Spec {
    const s = dangling()
    s.dns = { upstream: 'cf', upstreams: { cf: { ...CF, out: 'wg0' } } }
    return s
}

/** Правило без единого сервиса — черновик: на роутер он не едет. */
const DRAFT: Channel = { name: 'Новое', out: 'wg0', match: {} }

/** Слова ядра на висячую ссылку: путь временного файла, строка и столбец — как есть. */
function coreWords(spec: Spec): string | null {
    const have = new Set(Object.keys(spec.outputs))
    for (const [n, u] of Object.entries(spec.dns?.upstreams ?? {}))
        if (u.out && u.out !== 'direct' && !have.has(u.out))
            return `steer: /etc/steer/spec.json.new.5321:1:303: dns.upstreams.${n}.out: выхода «${u.out}» нет в outputs (или слово direct — напрямую)`
    return null
}

/** То, что говорит об отказе автосохранение: причина словами панели, без действия. */
const REASON = 'Выхода «wg1» нет, но он выбран: серверы DNS — cf. Выберите там другой выход'
/** То, что человек читает, нажав «Применить» при отказанной записи: состояние, действие и причина. */
const REFUSED = `Настройки не записаны — исправьте и примените снова\n${REASON}`

let disk: Spec
let snapshot: Spec
let set: ReturnType<typeof vi.spyOn>
let apply: ReturnType<typeof vi.spyOn>

/** Тосты, как их видел человек: пары (текст, вид). */
const said = () => vi.mocked(notify).mock.calls.map(([t, k]) => [t, k])

async function open() {
    vi.restoreAllMocks()
    vi.mocked(notify).mockClear()
    disk = clone(GOOD)
    snapshot = clone(GOOD)
    vi.spyOn(rpc, 'specGet').mockImplementation(async () => clone(disk))
    vi.spyOn(rpc, 'appliedGet').mockImplementation(async () => clone(snapshot))
    // Файл спеки лежит в форме движка, а страница читает его через decodeSpec — как в rpc.specGet.
    set = vi.spyOn(rpc, 'specSet').mockImplementation((async (json: string) => {
        const spec = decodeSpec(JSON.parse(json))
        const why = coreWords(spec)
        if (why) return { ok: false, error: why }
        disk = spec
        return { ok: true }
    }) as never)
    // apply бэкенда: применяет файл на диске и снимает снимок с него.
    apply = vi.spyOn(rpc, 'apply').mockImplementation((async () => {
        snapshot = clone(disk)
        return { ok: true, output: '' }
    }) as never)
    // Сброс внутреннего состояния между проверками.
    pending.saved = null; pending.applied = null; pending.dirty = false; pending.applying = false
    pending.justApplied = false; pending.savedFlash = false; pending.appliedAt = 0
    pending.saveError = null
    await pending.load()
}

/** Правка, которую ядро отвергает, и запись её автосохранением (таймер на 500 мс заменён прямым вызовом). */
async function breakIt() {
    pending.edit(dangling())
    await pending.flush()
}

// Таймеры поддельные: «Применено» и «Сохранено» гаснут через 1800 мс, и настоящий таймер прошлой
// проверки погасил бы их посреди следующей, а дебаунс автосохранения — те самые 500 мс.
beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await open()
})
afterEach(() => { vi.useRealTimers() })

describe('«Применить» после отказанной записи', () => {
    it('ядро отвергло спеку: rpc.apply не зовётся, «Применено» не звучит, тост — состояние и действие', async () => {
        await breakIt()
        expect(set).toHaveBeenCalledTimes(1)
        // Автосохранение уже сказало причину — как говорило всегда.
        expect(said()).toEqual([[REASON, 'error']])
        expect(pending.hasUnsaved()).toBe(true)
        vi.mocked(notify).mockClear()

        await pending.apply()

        // На роутере прежняя спека: применять её под видом экранной нельзя.
        expect(apply).not.toHaveBeenCalled()
        expect(said()).toEqual([[REFUSED, 'error']])
        expect(said().flat()).not.toContain('Применено')
        expect(pending.justApplied).toBe(false)
        expect(pending.applying).toBe(false)
        // Правка осталась в памяти, ждёт исправления.
        expect(pending.saved?.dns?.upstreams?.cf.out).toBe('wg1')
        expect(pending.saved?.outputs.wg1).toBeUndefined()
        expect(pending.hasUnsaved()).toBe(true)
    })

    it('отказ не трогает ни применённое, ни «Сохранено», ни окно «применяется»', async () => {
        await breakIt()
        const was = pending.applied
        pending.savedFlash = false
        await pending.apply()
        // Снимок применённого — тот же объект, а не перечитанный и не подставленный.
        expect(pending.applied).toBe(was)
        expect(snapshot).toEqual(GOOD)
        // Галочка «Сохранено» — только по факту записи, а записи не было.
        expect(pending.savedFlash).toBe(false)
        // Ядро ничего не перестраивало: опрос не должен считать эти секунды стройплощадкой.
        expect(pending.appliedAt).toBe(0)
        expect(pending.settling()).toBe(false)
        // Спеку с роутера apply не перечитывал: перечитывать после применения нечего.
        expect(rpc.specGet).toHaveBeenCalledTimes(1) // только первая загрузка
    })

    it('нажатие пробует записать снова — отказ тот же, применения нет; полоса от самого apply одна', async () => {
        await breakIt()
        vi.mocked(notify).mockClear()
        await pending.apply()
        await pending.apply()
        expect(set).toHaveBeenCalledTimes(3) // запись автосохранения и по одной попытке на нажатие
        expect(apply).not.toHaveBeenCalled()
        // Причину apply говорит один раз за нажатие — без второй полосы от самой записи.
        expect(said()).toEqual([[REFUSED, 'error'], [REFUSED, 'error']])
    })

    it('исправили спеку — запись проходит и применение идёт как обычно', async () => {
        await breakIt()
        await pending.apply()
        expect(apply).not.toHaveBeenCalled()
        vi.mocked(notify).mockClear()

        pending.edit(fixed())
        await pending.apply()

        expect(apply).toHaveBeenCalledTimes(1)
        expect(said()).toEqual([['Применено', 'info']])
        expect(pending.saveError).toBeNull()
        expect(pending.justApplied).toBe(true)
        // Ядро применило то, что на экране: выход убран, сервер DNS идёт через wg0.
        expect(snapshot).toEqual(fixed())
        expect(pending.applied?.dns?.upstreams?.cf.out).toBe('wg0')
        expect(pending.count()).toBe(0)
        expect(pending.hasUnsaved()).toBe(false)
    })

    it('отказанное применение не держит запись: автосохранение после него уезжает', async () => {
        await breakIt()
        await pending.apply()
        set.mockClear()
        pending.edit(fixed())
        await vi.advanceTimersByTimeAsync(600) // дебаунс
        expect(set).toHaveBeenCalledTimes(1)
        expect(pending.saveError).toBeNull()
        expect(disk).toEqual(fixed())
    })

    it('временный отказ переживается: apply сам повторяет запись и применяет', async () => {
        // rpcd после перезапуска секунду отвечает «объект не найден» — это не отказ ядра.
        set.mockImplementationOnce((async () => { throw new Error('Object not found') }) as never)
        pending.edit(fixed())
        await pending.flush()
        expect(pending.saveError).toBe('Object not found')
        vi.mocked(notify).mockClear()

        await pending.apply()

        expect(set).toHaveBeenCalledTimes(2)
        expect(apply).toHaveBeenCalledTimes(1)
        expect(said()).toEqual([['Применено', 'info']])
        expect(pending.saveError).toBeNull()
        expect(snapshot).toEqual(fixed())
    })

    it('отказ без слов — «не удалось сохранить»: причина не теряется и не выдумывается', async () => {
        set.mockImplementation((async () => ({ ok: false })) as never)
        pending.edit(fixed())
        await pending.flush()
        vi.mocked(notify).mockClear()
        await pending.apply()
        expect(apply).not.toHaveBeenCalled()
        expect(said()).toEqual([['Настройки не записаны — исправьте и примените снова\nне удалось сохранить', 'error']])
    })

    it('причина не в выходе — слова ядра как были, внутри того же сообщения', async () => {
        const words = 'steer: /etc/steer/spec.json.new.5321:1:9: неизвестный ключ «опечатка»'
        set.mockImplementation((async () => ({ ok: false, error: words })) as never)
        pending.edit(fixed())
        await pending.flush()
        vi.mocked(notify).mockClear()
        await pending.apply()
        expect(apply).not.toHaveBeenCalled()
        expect(said()).toEqual([[`Настройки не записаны — исправьте и примените снова\n${words}`, 'error']])
    })

    it('запись, летящая в момент нажатия, отказала — применения нет', async () => {
        // Как в apply-waits-save, только запись кончается отказом: apply ждёт её и смотрит на итог.
        let answer!: (r: { ok: boolean; error?: string }) => void
        set.mockImplementationOnce((() => new Promise((r) => { answer = r })) as never)
        pending.edit(dangling())
        void pending.flush() // то, что сделал бы таймер через 500 мс
        await Promise.resolve()
        const run = pending.apply() // человек нажал, пока запись летит
        await vi.advanceTimersByTimeAsync(20)
        expect(apply).not.toHaveBeenCalled()
        answer({ ok: false, error: coreWords(dangling())! })
        await run
        expect(apply).not.toHaveBeenCalled()
        expect(said().at(-1)).toEqual([REFUSED, 'error'])
        expect(pending.justApplied).toBe(false)
        expect(pending.applying).toBe(false)
    })

    it('черновик правила — не отказ: всё остальное записано, применение идёт, как прежде', async () => {
        pending.edit({ ...clone(GOOD), channels: [...GOOD.channels, DRAFT] })
        await pending.flush()
        expect(pending.saveError).toBeNull()
        expect(pending.hasUnsaved()).toBe(true) // черновик ещё не на роутере
        vi.mocked(notify).mockClear()
        await pending.apply()
        expect(apply).toHaveBeenCalledTimes(1)
        expect(said()).toEqual([['Применено', 'info']])
    })
})

describe('отказ записи запоминается', () => {
    it('автосохранение по таймеру: тост с причиной, как прежде, и признак; следующая удавшаяся запись его снимает', async () => {
        pending.edit(dangling())
        await vi.advanceTimersByTimeAsync(600)
        expect(set).toHaveBeenCalledTimes(1)
        expect(said()).toEqual([[REASON, 'error']])
        expect(pending.saveError).toBe(REASON)
        expect(pending.hasUnsaved()).toBe(true)

        pending.edit(fixed())
        await vi.advanceTimersByTimeAsync(600)
        expect(pending.saveError).toBeNull()
        expect(pending.hasUnsaved()).toBe(false)
        // Запись удалась — уже можно применять, и отказа нет.
        vi.mocked(notify).mockClear()
        await pending.apply()
        expect(apply).toHaveBeenCalledTimes(1)
        expect(said()).toEqual([['Применено', 'info']])
    })

    it('заново загруженная спека — без отказа', async () => {
        await breakIt()
        expect(pending.saveError).toBe(REASON)
        // Страница открылась заново: прошлой записи, которая отказала, у неё нет.
        pending.saved = null
        await pending.load()
        expect(pending.saveError).toBeNull()
    })
})

describe('пилюля «Применить» при отказанной записи', () => {
    const button = () => screen.getByRole('button')

    it('без отказа — «Применить» и число, как всегда', async () => {
        pending.edit(fixed())
        await pending.flush()
        render(<ApplyPill />)
        expect(button()).toHaveTextContent(/Применить\s*\d/)
        expect(button()).not.toHaveTextContent('Не записано')
        expect(button().getAttribute('title')).toContain('Изменения уже сохранены')
    })

    it('запись отказана — «Не записано» вместо числа, а в подсказке состояние, действие и причина', async () => {
        render(<ApplyPill />)
        expect(screen.queryByRole('button')).toBeNull() // правок нет — пилюли нет
        await breakIt()
        await waitFor(() => expect(button()).toHaveTextContent('Не записано'))
        expect(button()).not.toHaveTextContent('Применить')
        expect(button()).not.toHaveTextContent(/\d/)
        // «Изменения уже сохранены» — ровно то, что здесь неправда.
        expect(button().getAttribute('title')).toBe(REFUSED)
        expect(button()).not.toBeDisabled()
    })

    it('отказ без числа правок: пилюля всё равно стоит — состояние важнее счёта', async () => {
        // Правку сделали и вернули: в памяти то же, что применено (число 0), а запись отвергнута —
        // человек должен видеть, что на роутере не то, что на экране.
        set.mockImplementation((async () => ({ ok: false, error: 'не удалось заменить спецификацию' })) as never)
        pending.edit(clone(GOOD))
        await pending.flush()
        expect(pending.count()).toBe(0)
        render(<ApplyPill />)
        expect(button()).toHaveTextContent('Не записано')
    })

    it('нажатие при отказе не применяет и говорит словами; после исправления пилюля снова «Применить»', async () => {
        render(<ApplyPill />)
        await breakIt()
        await waitFor(() => expect(button()).toHaveTextContent('Не записано'))
        vi.mocked(notify).mockClear()

        fireEvent.click(button())
        await waitFor(() => expect(said()).toEqual([[REFUSED, 'error']]))
        await waitFor(() => expect(button()).toHaveTextContent('Не записано'))
        expect(apply).not.toHaveBeenCalled()

        // Человек выбрал серверу DNS другой выход — автосохранение записало, пилюля вернулась.
        pending.edit(fixed())
        await pending.flush()
        await waitFor(() => expect(button()).toHaveTextContent(/Применить\s*\d/))
        expect(button()).not.toHaveTextContent('Не записано')

        vi.mocked(notify).mockClear()
        fireEvent.click(button())
        await waitFor(() => expect(apply).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(button()).toHaveTextContent('Применено'))
        expect(said()).toEqual([['Применено', 'info']])
    })
})

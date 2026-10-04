import { render, screen } from '@testing-library/preact'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

import PoolEditor from '@/components/PoolEditor'
import PoolList from '@/components/PoolList'
import { outExtras } from '@/lib/outstate'
import { mergeSpec, pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { decodeSpec, encodeSpec } from '@/lib/specv2'
import { S } from '@/copy'
import type { OutputStatus, Spec } from '@/lib/model'
import { live } from './fixtures'

// ПУЛ ИЗ УСТРОЙСТВ С РАЗНЫМ IPv6 ОСТАЁТСЯ ПУЛОМ. Снято на QEMU-стенде: пул «любой из этих
// туннелей» из wg_v4 (только IPv4) и wg0 (адрес IPv6 есть) до «Применить» — одна строка
// «poolmix: wg_v4 → wg0», «Выходы 1»; после — группа «poolmix · первый живой · членов: 2» и две
// строки poolmix.wg_v4 и poolmix.wg0, «Выходы 3»: пул менял форму на глазах.
//
// Причина — в чтении спеки. Самолечение при apply (m-spec.sh, spec_heal_ipv6) пишет `ipv6` каждому
// члену группы-пула по его устройству — `off` у wg_v4, `nat` у wg0, и ядру это верно: режим оно
// берёт у члена (out_ipv6_mode_dev). Кодек же собирал членов обратно в пул, только когда ключ у всех
// одинаков, а разный читал группой с членами-выходами. Теперь пул несёт режим по устройствам
// (`ipv6_by_device`): общий `ipv6` остаётся, пока у всех одно и то же, а разное читается пулом, и
// пишется каждому члену свой ключ.

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
type J = Record<string, unknown>

/** Спека на диске в форме движка (v2): выходы по именам. */
type DiskSpec = { version: number; outputs: Record<string, J> }

/** Пул poolmix, как его пишет панель: два устройства, ключей ipv6 нет — их допишет самолечение. */
const KEYLESS: DiskSpec = {
    version: 2,
    outputs: {
        direct: { kind: 'direct' },
        poolmix: { kind: 'group', pick: 'order', members: ['poolmix.wg_v4', 'poolmix.wg0'], on_fail: 'drop' },
        'poolmix.wg_v4': { kind: 'interface', device: 'wg_v4' },
        'poolmix.wg0': { kind: 'interface', device: 'wg0' },
    },
}
/** Он же после самолечения: каждому члену — по адресу IPv6 у его устройства. */
const HEALED: DiskSpec = {
    ...KEYLESS,
    outputs: {
        ...KEYLESS.outputs,
        'poolmix.wg_v4': { kind: 'interface', device: 'wg_v4', ipv6: 'off' },
        'poolmix.wg0': { kind: 'interface', device: 'wg0', ipv6: 'nat' },
    },
}
const MODES = { wg_v4: 'off', wg0: 'nat' } as const

/** Что делает самолечение бэкенда над записанной спекой: члену-интерфейсу без ключа — режим по его
 *  устройству (устройства, о которых оно не знает, остаются без ключа). */
function heal(doc: DiskSpec) {
    for (const o of Object.values(doc.outputs)) {
        const dev = o.device as keyof typeof MODES
        if (o.kind === 'interface' && !o.ipv6 && MODES[dev]) o.ipv6 = MODES[dev]
    }
}

type Doc = { outputs: Record<string, { ipv6?: string; kind: string; device?: string; members?: string[] }> }
const members = (doc: Doc) => Object.entries(doc.outputs).filter(([n]) => n.startsWith('poolmix.'))

describe('чтение: члены с разным ipv6 — всё равно пул', () => {
    it('nat у одного, off у другого — один пул с режимом по устройствам, членов-выходов нет', () => {
        const back = decodeSpec(HEALED)
        expect(Object.keys(back.outputs)).toEqual(['direct', 'poolmix'])
        const pool = back.outputs.poolmix
        expect(pool.kind).toBe('interface')
        expect(pool.devices).toEqual(['wg_v4', 'wg0'])
        expect(pool.ipv6_by_device).toEqual({ wg_v4: 'off', wg0: 'nat' })
        // Общего ключа нет: у пула он бывает, только когда у всех одинаковый.
        expect(pool.ipv6).toBeUndefined()
    })

    it('ключ у одного члена из двух — тоже пул, режим только у того, у кого он есть', () => {
        const doc = clone(KEYLESS)
        ;(doc.outputs['poolmix.wg0'] as J).ipv6 = 'nat'
        const pool = decodeSpec(doc).outputs.poolmix
        expect(pool.kind).toBe('interface')
        expect(pool.ipv6_by_device).toEqual({ wg0: 'nat' })
        expect(pool.ipv6).toBeUndefined()
    })

    it('у всех одно и то же — по-прежнему общий ключ пула, без режима по устройствам', () => {
        for (const mode of ['nat', 'off']) {
            const doc = clone(KEYLESS)
            for (const m of ['poolmix.wg_v4', 'poolmix.wg0']) (doc.outputs[m] as J).ipv6 = mode
            const pool = decodeSpec(doc).outputs.poolmix
            expect(pool.ipv6).toBe(mode)
            expect(pool.ipv6_by_device).toBeUndefined()
        }
        // Ни у кого — пул без ключа, и поля тоже нет (пустой набор счёт «Применить» считал бы правкой).
        const none = decodeSpec(KEYLESS).outputs.poolmix
        expect(none.kind).toBe('interface')
        expect('ipv6' in none).toBe(false)
        expect('ipv6_by_device' in none).toBe(false)
    })

    it('часть по подписке и два члена-интерфейса с разным ключом: пул, ключи только у интерфейсов', () => {
        const back = decodeSpec({
            version: 2,
            outputs: {
                direct: { kind: 'direct' },
                poolmix: { kind: 'group', pick: 'order', members: ['poolmix.p-1', 'poolmix.wg_v4', 'poolmix.wg0'] },
                'poolmix.p-1': { kind: 'interface', device: 'p-1' },
                'poolmix.wg_v4': { kind: 'interface', device: 'wg_v4', ipv6: 'off' },
                'poolmix.wg0': { kind: 'interface', device: 'wg0', ipv6: 'nat' },
                'p-1': { kind: 'tunnel', protocol: 'vless', subscription: '/etc/steer/sub.txt', nodes: [0], on_fail: 'drop' },
            },
        })
        const pool = back.outputs.poolmix
        expect(pool.kind).toBe('interface')
        expect(pool.devices).toEqual(['p-1', 'wg_v4', 'wg0'])
        expect(pool.ipv6_by_device).toEqual({ wg_v4: 'off', wg0: 'nat' })
        expect(back.outputs['p-1'].part_of).toBe('poolmix')
    })

    it('routed у члена — по-прежнему не пул: такой ключ пулу не принадлежит и не теряется', () => {
        const doc = clone(HEALED)
        ;(doc.outputs['poolmix.wg0'] as J).ipv6 = 'routed'
        const back = decodeSpec(doc)
        expect(back.outputs.poolmix.kind).toBe('group')
        expect(back.outputs['poolmix.wg0'].ipv6).toBe('routed')
    })
})

describe('запись: каждому члену — свой ключ', () => {
    it('пул с режимом по устройствам пишет члену его режим, у группы ключа нет', () => {
        const spec = decodeSpec(HEALED)
        const doc = encodeSpec(spec) as Doc
        expect(doc.outputs['poolmix.wg_v4'].ipv6).toBe('off')
        expect(doc.outputs['poolmix.wg0'].ipv6).toBe('nat')
        expect(doc.outputs.poolmix.ipv6).toBeUndefined()
        expect(doc.outputs.poolmix.members).toEqual(['poolmix.wg_v4', 'poolmix.wg0'])
    })

    it('читается и пишется туда и обратно байт в байт: ключи членов те же, второй круг не меняет ничего', () => {
        const first = encodeSpec(decodeSpec(HEALED))
        // Ключи членов — как их записало самолечение.
        for (const [n, m] of members(first as unknown as Doc)) expect(m.ipv6).toBe(HEALED.outputs[n].ipv6)
        // Целиком — как её пишет кодек: порядок выходов, ключи, члены в конце.
        expect(JSON.stringify(first)).toBe(JSON.stringify(HEALED))
        const second = encodeSpec(decodeSpec(first))
        expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    })

    it('ключ не у всех: устройству без записи ключ не пишется', () => {
        const doc = clone(KEYLESS)
        ;(doc.outputs['poolmix.wg0'] as J).ipv6 = 'nat'
        const out = encodeSpec(decodeSpec(doc)) as Doc
        expect(out.outputs['poolmix.wg0'].ipv6).toBe('nat')
        expect('ipv6' in out.outputs['poolmix.wg_v4']).toBe(false)
        expect(JSON.stringify(out)).toBe(JSON.stringify(doc))
    })

    it('запись по устройству сильнее общего ключа; записи об устройствах вне пула не пишутся', () => {
        const spec: Spec = {
            outputs: {
                p: {
                    name: 'p', kind: 'interface', devices: ['wg0', 'wg1'], device: 'wg0',
                    ipv6: 'nat', ipv6_by_device: { wg1: 'off', gone: 'off' },
                },
            },
            channels: [],
        }
        const doc = encodeSpec(spec) as Doc
        expect(doc.outputs['p.wg0'].ipv6).toBe('nat')
        expect(doc.outputs['p.wg1'].ipv6).toBe('off')
        expect(Object.keys(doc.outputs).filter((n) => n.startsWith('p.'))).toEqual(['p.wg0', 'p.wg1'])
    })

    it('часть пула по подписке ключа не получает, даже если запись о её устройстве затесалась', () => {
        const spec: Spec = {
            outputs: {
                p: {
                    name: 'p', kind: 'interface', devices: ['p-1', 'wg0'], device: 'p-1',
                    ipv6_by_device: { 'p-1': 'nat', wg0: 'off' },
                },
                'p-1': { name: 'p-1', kind: 'vless', sub_file: '/etc/steer/sub.txt', nodes: [0], on_fail: 'drop', part_of: 'p' },
            },
            channels: [],
        }
        const doc = encodeSpec(spec) as Doc
        expect('ipv6' in doc.outputs['p.p-1']).toBe(false)
        expect(doc.outputs['p.wg0'].ipv6).toBe('off')
    })
})

describe('после «Применить» пул остаётся одной строкой', () => {
    let disk: DiskSpec
    let snapshot: DiskSpec
    let flow: string[]

    beforeEach(async () => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        disk = clone(KEYLESS)
        snapshot = clone(KEYLESS)
        flow = []
        // Файл спеки на «роутере» лежит в форме движка, страница читает его через decodeSpec — как rpc.specGet.
        vi.spyOn(rpc, 'specGet').mockImplementation(async () => decodeSpec(clone(disk)))
        vi.spyOn(rpc, 'appliedGet').mockImplementation(async () => decodeSpec(clone(snapshot)))
        vi.spyOn(rpc, 'specSet').mockImplementation((async (json: string) => {
            flow.push('spec_set')
            disk = JSON.parse(json)
            return { ok: true }
        }) as never)
        // apply бэкенда: самолечение вписывает ключи ЧЛЕНАМ по их устройствам и снимает снимок с вылеченного.
        vi.spyOn(rpc, 'apply').mockImplementation((async () => {
            flow.push('apply')
            heal(disk)
            snapshot = clone(disk)
            return { ok: true, output: '' }
        }) as never)
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] })
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
        vi.spyOn(rpc, 'outboundGeo').mockResolvedValue({} as never)
        // Сброс внутреннего состояния между проверками.
        pending.saved = null; pending.applied = null; pending.dirty = false; pending.applying = false; pending.justApplied = false
        await pending.load()
    })

    const status = {
        schema: 1,
        outputs: {
            poolmix: { name: 'poolmix', kind: 'interface', device: 'wg0', devices: ['wg_v4', 'wg0'], up: true },
        },
        channels: [],
    } as never

    /** Список «Выходы» глазами человека: шапка с числом и строка пула. */
    async function list() {
        render(<PoolList live={live({ status })} />)
        const row = (await screen.findByText('poolmix')).closest('button')!
        const head = screen.getByRole('heading', { name: S.poolList.vyhody }).parentElement!
        return { row, count: head.textContent }
    }

    it('до применения — одна строка пула, «Выходы 1»', async () => {
        expect(pending.saved!.outputs.poolmix.kind).toBe('interface')
        const { row, count } = await list()
        expect(row.textContent).toContain('wg_v4 → wg0')
        expect(count).toBe(`${S.poolList.vyhody}1`)
    })

    it('после применения самолечение вписало разные ключи — пул тот же, строка одна, «Выходы 1»', async () => {
        await pending.apply()
        // Самолечение отработало: на «роутере» у каждого члена свой ключ.
        expect((disk.outputs['poolmix.wg_v4'] as J).ipv6).toBe('off')
        expect((disk.outputs['poolmix.wg0'] as J).ipv6).toBe('nat')
        // …а страница, перечитав его, видит тот же пул, только с режимом по устройствам.
        const pool = pending.saved!.outputs.poolmix
        expect(Object.keys(pending.saved!.outputs)).toEqual(['direct', 'poolmix'])
        expect(pool.kind).toBe('interface')
        expect(pool.devices).toEqual(['wg_v4', 'wg0'])
        expect(pool.ipv6_by_device).toEqual({ wg_v4: 'off', wg0: 'nat' })
        expect(pending.count()).toBe(0)
        const { row, count } = await list()
        expect(row.textContent).toContain('wg_v4 → wg0')
        expect(count).toBe(`${S.poolList.vyhody}1`)
        expect(screen.queryByText(/членов: /)).toBeNull()
        expect(screen.queryByText('poolmix.wg0')).toBeNull()
        expect(screen.queryByText('poolmix.wg_v4')).toBeNull()
    })

    it('первая правка после применения не стирает вылеченные ключи членов', async () => {
        await pending.apply()
        flow.length = 0
        pending.edit({ ...pending.saved!, channels: [{ name: 'всё', out: 'poolmix', match: { any: true } }] })
        await pending.flush()
        expect(flow).toEqual(['spec_set'])
        expect((disk.outputs['poolmix.wg_v4'] as J).ipv6).toBe('off')
        expect((disk.outputs['poolmix.wg0'] as J).ipv6).toBe('nat')
        expect(pending.count()).toBe(1)
    })

    it('правка пула за время применения (добавлено устройство) ложится поверх вылеченных ключей, а не заменяет спеку', () => {
        // Пул остаётся пулом, поэтому слияние идёт по ключам, а не «вся спека из памяти»: роутерные
        // ключи членов не пропадают, добавленное устройство — без ключа, по нему решит следующий apply.
        const base = decodeSpec(KEYLESS)
        const mine = clone(base)
        mine.outputs.poolmix.devices = ['wg_v4', 'wg0', 'wg1']
        const merged = mergeSpec(base, mine, decodeSpec(HEALED))
        expect(Object.keys(merged.outputs)).toEqual(['direct', 'poolmix'])
        expect(merged.outputs.poolmix.devices).toEqual(['wg_v4', 'wg0', 'wg1'])
        expect(merged.outputs.poolmix.ipv6_by_device).toEqual({ wg_v4: 'off', wg0: 'nat' })
        const doc = encodeSpec(merged) as Doc
        expect(doc.outputs['poolmix.wg_v4'].ipv6).toBe('off')
        expect(doc.outputs['poolmix.wg0'].ipv6).toBe('nat')
        expect('ipv6' in doc.outputs['poolmix.wg1']).toBe(false)
    })
})

describe('строка пула: слова об IPv6 — по устройству, которое несёт трафик', () => {
    const pool = () => decodeSpec(HEALED).outputs.poolmix
    const at = (device: string, nat6?: boolean) => ({ name: 'poolmix', kind: 'interface', device, up: true, nat6 }) as OutputStatus

    it('активно устройство с nat — «IPv6 адресом хоста», а если подмены нет — беда', () => {
        expect(outExtras(pool(), at('wg0', true))).toEqual({ words: [S.outState.ipv6AdresomHosta], alarm: false })
        expect(outExtras(pool(), at('wg0', false))).toEqual({ words: [S.outState.ipv6NePodmenyaetsya], alarm: true })
    })

    it('активно устройство с off — об IPv6 молчим, как у выхода без подмены', () => {
        expect(outExtras(pool(), at('wg_v4', false))).toEqual({ words: [], alarm: false })
    })

    it('общий ключ пула читается по-прежнему: у всех nat — слова у любого активного устройства', () => {
        const uniform = { ...pool(), ipv6: 'nat' as const, ipv6_by_device: undefined }
        expect(outExtras(uniform, at('wg_v4', true)).words).toEqual([S.outState.ipv6AdresomHosta])
    })
})

describe('редактор выхода: IPv6 по устройствам', () => {
    const WITH_POOLS = live({
        status: { schema: 1, features: ['lan_devices', 'nodes', 'pool'], outputs: {}, channels: [] },
    })
    const dev = (name: string, ipv6?: 'nat' | 'off') => ({ name, up: true, kind: 'wireguard', ...(ipv6 ? { ipv6 } : {}) })
    const MIXED = (): Spec => decodeSpec(HEALED)

    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [dev('wg_v4', 'off'), dev('wg0', 'nat'), dev('wg1', 'nat')] })
    })

    function open(spec: Spec, name = 'poolmix') {
        let saved: Spec | null = null
        render(<PoolEditor spec={spec} name={name} live={WITH_POOLS} onCancel={() => {}} onSave={(next) => { saved = next }} />)
        return () => saved!.outputs[name]
    }
    const save = async (out: () => Spec['outputs'][string]) => {
        await userEvent.click(screen.getByRole('button', { name: /Сохранить выход/ }))
        return out()
    }
    const select = (name: string) => screen.getByLabelText(name) as HTMLSelectElement

    it('у пула с разным IPv6 в «Дополнительно» — выбор по каждому устройству, показаны их режимы', async () => {
        open(MIXED())
        await screen.findByLabelText('wg_v4')
        expect(screen.getByText(S.outputAdvanced.ipv6OtHosta)).toBeInTheDocument()
        expect(select('wg_v4').value).toBe('off')
        expect(select('wg0').value).toBe('nat')
        expect([...select('wg0').options].map((o) => o.textContent)).toEqual([
            S.outputAdvanced.poUmolchaniyu, S.outputAdvanced.odinAdresHosta, S.outputAdvanced.nePropuskatIpv6,
        ])
    })

    it('сохранение без правок оставляет режимы по устройствам как были', async () => {
        const out = await save(open(MIXED()))
        expect(out.devices).toEqual(['wg_v4', 'wg0'])
        expect(out.ipv6_by_device).toEqual({ wg_v4: 'off', wg0: 'nat' })
        expect(out.ipv6).toBeUndefined()
        const doc = encodeSpec({ ...MIXED(), outputs: { ...MIXED().outputs, poolmix: out } }) as Doc
        expect(doc.outputs['poolmix.wg_v4'].ipv6).toBe('off')
        expect(doc.outputs['poolmix.wg0'].ipv6).toBe('nat')
    })

    it('выбрано одно и то же у всех — режимы сворачиваются в общий ключ пула', async () => {
        const out = open(MIXED())
        await userEvent.selectOptions(await screen.findByLabelText('wg_v4'), 'nat')
        const saved = await save(out)
        expect(saved.ipv6).toBe('nat')
        expect(saved.ipv6_by_device).toBeUndefined()
    })

    it('«по умолчанию» снимает ключ у устройства — по нему решит самолечение', async () => {
        const out = open(MIXED())
        await userEvent.selectOptions(await screen.findByLabelText('wg_v4'), '')
        const saved = await save(out)
        expect(saved.ipv6_by_device).toEqual({ wg0: 'nat' })
        expect(saved.ipv6).toBeUndefined()
        const doc = encodeSpec({ ...MIXED(), outputs: { ...MIXED().outputs, poolmix: saved } }) as Doc
        expect('ipv6' in doc.outputs['poolmix.wg_v4']).toBe(false)
        expect(doc.outputs['poolmix.wg0'].ipv6).toBe('nat')
    })

    it('устройство, убранное из состава, уносит свой режим; оставшемуся — его режим общим ключом', async () => {
        const out = open(MIXED())
        await userEvent.click(await screen.findByRole('button', { name: 'убрать строку 1' }))
        const saved = await save(out)
        expect(saved.devices).toEqual(['wg0'])
        expect(saved.ipv6).toBe('nat')
        expect(saved.ipv6_by_device).toBeUndefined()
    })

    it('добавленное устройство — без ключа, у прежних режимы на месте', async () => {
        const out = open(MIXED())
        await userEvent.click(await screen.findByRole('button', { name: /^wg1/ }))
        expect(select('wg1').value).toBe('')
        const saved = await save(out)
        expect(saved.devices).toEqual(['wg_v4', 'wg0', 'wg1'])
        expect(saved.ipv6_by_device).toEqual({ wg_v4: 'off', wg0: 'nat' })
        expect(saved.ipv6).toBeUndefined()
    })

    it('у пула с общим ключом или без него выбора по устройствам нет, ключ сохраняется как был', async () => {
        for (const mode of [undefined, 'nat'] as const) {
            document.body.innerHTML = ''
            const spec = MIXED()
            spec.outputs.poolmix = { ...spec.outputs.poolmix, ipv6_by_device: undefined, ...(mode ? { ipv6: mode } : {}) }
            const out = open(spec)
            await screen.findByRole('button', { name: /Сохранить выход/ })
            expect(screen.queryByText(S.outputAdvanced.ipv6OtHosta)).toBeNull()
            expect(screen.queryByLabelText('wg_v4')).toBeNull()
            const saved = await save(out)
            expect(saved.ipv6).toBe(mode)
            expect(saved.ipv6_by_device).toBeUndefined()
        }
    })

    it('новый пул из устройств с разными подсказками — по-прежнему без ключа, решит самолечение', async () => {
        let saved: Spec | null = null
        render(<PoolEditor spec={{ outputs: {}, channels: [] }} live={WITH_POOLS} onCancel={() => {}} onSave={(n) => { saved = n }} />)
        const title = screen.getByLabelText('имя выхода') as HTMLInputElement
        title.value = 'vpn'
        title.dispatchEvent(new Event('input', { bubbles: true }))
        await userEvent.click(await screen.findByRole('button', { name: /^wg_v4/ }))
        await userEvent.click(await screen.findByRole('button', { name: /^wg0/ }))
        // Выбора по устройствам нет: записанных режимов у пула ещё нет.
        expect(screen.queryByText(S.outputAdvanced.ipv6OtHosta)).toBeNull()
        await userEvent.click(screen.getByRole('button', { name: /Сохранить выход/ }))
        const out = saved!.outputs.vpn
        expect(out.devices).toEqual(['wg_v4', 'wg0'])
        expect(out.ipv6).toBeUndefined()
        expect(out.ipv6_by_device).toBeUndefined()
    })
})

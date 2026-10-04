import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

import GroupEditor from '@/components/GroupEditor'
import IfacesPanel from '@/components/IfacesPanel'
import PoolEditor from '@/components/PoolEditor'
import PoolList from '@/components/PoolList'
import { notify } from '@/lib/notify'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { type Output, type Spec } from '@/lib/model'
import { missingText } from '@/lib/outrefs'
import { decodeSpec } from '@/lib/specv2'
import { live } from './fixtures'

// «КОГДА УДАЛЯЕШЬ ВЫХОД, НАСТРОЙКИ НЕ ПРИМЕНЯЮТСЯ, ЕСЛИ ЧЕРЕЗ НЕГО ИДЁТ DNS; ЛЕЧИТСЯ РУКАМИ»
// (обращение из Telegram). Редакторы выхода смотрели при удалении только на правила: выход, через
// который ходит сервер DNS (dns.upstreams.<имя>.out), туннель поверх него (over) или группа с ним
// членом убирался без возражений, а ядро отвергало спеку с висячей ссылкой («выхода «nl» нет в
// outputs») — на этой правке и на каждой следующей, пока человек не находил сервер DNS и не менял
// ему выход. Теперь занятый выход не убирается, а отказ называет, кто его держит; переименование
// уводит все ссылки за новым именем. Сверка с настоящим ядром — в ui/tests/output-refs.test.ts.

const DOH = { url: 'https://cloudflare-dns.com/dns-query', ips: ['1.1.1.1'] }

/** nl — выход через wg1; сервер DNS cf ходит через него. */
function base(): Spec {
    return {
        outputs: {
            direct: { name: 'direct', kind: 'direct' },
            wg0: { name: 'wg0', kind: 'interface', device: 'wg0', devices: ['wg0'], on_fail: 'drop' },
            nl: { name: 'nl', kind: 'interface', device: 'wg1', devices: ['wg1'], on_fail: 'drop' },
        },
        channels: [],
        dns: { upstream: 'cf', upstreams: { cf: { ...DOH, out: 'nl' } } },
    }
}

/** Выход nl свободен: DNS ходит напрямую. */
function free(): Spec {
    const s = base()
    s.dns = { upstream: 'cf', upstreams: { cf: { ...DOH } } }
    return s
}

const withPools = live({ status: { schema: 1, features: ['lan_devices', 'nodes', 'pool', 'groups'], outputs: {}, channels: [] } })

const said = () => vi.mocked(notify).mock.calls.map((c) => String(c[0]))

beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(notify).mockClear()
    window.localStorage.clear()
    document.body.innerHTML = ''
    vi.spyOn(rpc, 'devices').mockResolvedValue({
        devices: [{ name: 'wg0', up: true, kind: 'wireguard' }, { name: 'wg1', up: true, kind: 'wireguard' }],
    })
    vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
})

function pool(spec: Spec, name: string) {
    const onSave = vi.fn()
    render(<PoolEditor spec={spec} name={name} live={withPools} onCancel={() => {}} onSave={onSave} />)
    return onSave
}
const del = async () => fireEvent.click(await screen.findByRole('button', { name: /Удалить/ }))

describe('редактор выхода: занятый выход не удаляется', () => {
    it('через выход ходит сервер DNS — отказ называет сервер, спека не меняется', async () => {
        const onSave = pool(base(), 'nl')
        await del()
        expect(onSave).not.toHaveBeenCalled()
        expect(said()).toEqual(['Выход «nl» используется: серверы DNS — cf. Сначала уберите его оттуда'])
        expect(vi.mocked(notify).mock.calls[0][1]).toBe('warning')
    })

    it('отказ называет всех: правила, свой сервер DNS в правиле, серверы DNS, туннель поверх, группу', async () => {
        const s = base()
        s.outputs.eu = { name: 'eu', kind: 'group', pick: 'order', members: ['wg0', 'nl'] }
        s.outputs.xs = { name: 'xs', kind: 'interface', device: 'wg2', obfs: { server: '203.0.113.7:1', listen: '127.0.0.1:2' }, over: 'nl' } as Output
        s.channels = [
            { name: 'Новости', out: 'nl', match: { domains_files: ['/l/a.lst'] } },
            { name: 'Видео', out: 'wg0', match: { domains_files: ['/l/b.lst'] }, dns: { ...DOH, out: 'nl' } },
        ]
        const onSave = pool(s, 'nl')
        await del()
        expect(onSave).not.toHaveBeenCalled()
        expect(said()).toEqual([
            'Выход «nl» используется: правила — Новости; серверы DNS — cf; ' +
            'свой сервер DNS в правилах — Видео; группы — eu; туннели через него — xs. Сначала уберите его оттуда',
        ])
    })

    it('одни правила — как и прежде отказ, только с тем, что делать', async () => {
        const s = free()
        s.channels = [{ name: 'Новости', out: 'nl', match: { domains_files: ['/l/a.lst'] } }]
        const onSave = pool(s, 'nl')
        await del()
        expect(onSave).not.toHaveBeenCalled()
        expect(said()).toEqual(['Выход «nl» используется: правила — Новости. Сначала уберите его оттуда'])
    })

    it('никто не держит выход — удаляется, и в спеке не остаётся ссылок на него', async () => {
        const onSave = pool(free(), 'nl')
        await del()
        expect(said()).toEqual([])
        const next = onSave.mock.calls[0][0] as Spec
        expect(Object.keys(next.outputs)).toEqual(['direct', 'wg0'])
        expect(next.dns!.upstreams!.cf.out).toBeUndefined()
    })

    it('DNS «напрямую» выход не держит, а DNS через другой выход — держит другой', async () => {
        const s = base()
        s.dns = { upstreams: { cf: { ...DOH, out: 'wg0' }, direct: { ...DOH, out: 'direct' } } }
        const onSave = pool(s, 'nl')
        await del()
        expect(said()).toEqual([])
        expect(onSave).toHaveBeenCalledTimes(1)
    })

    it('пул из подписок: части уходят вместе с пулом, а туннель поверх части держит пул', async () => {
        const s = base()
        s.outputs.vpn = { name: 'vpn', kind: 'interface', devices: ['vpn-1', 'wg0'], device: 'vpn-1', on_fail: 'drop' }
        s.outputs['vpn-1'] = { name: 'vpn-1', kind: 'vless', sub_file: '/etc/steer/sub.txt', node: 0, on_fail: 'drop', part_of: 'vpn' }
        s.outputs.t2 = { name: 't2', kind: 'vless', sub_file: '/etc/steer/sub.txt', node: 1, on_fail: 'drop', over: 'vpn' }
        s.dns = { upstreams: { cf: { ...DOH, out: 'vpn' } } }
        const onSave = pool(s, 'vpn')
        await del()
        expect(onSave).not.toHaveBeenCalled()
        expect(said()).toEqual(['Выход «vpn» используется: серверы DNS — cf; туннели через него — t2. Сначала уберите его оттуда'])

        // Освободили — уходит вместе с частью.
        vi.mocked(notify).mockClear()
        document.body.innerHTML = ''
        const s2 = { ...s, dns: undefined, outputs: { ...s.outputs, t2: { ...s.outputs.t2, over: undefined } } } as Spec
        const onSave2 = pool(s2, 'vpn')
        await del()
        expect(said()).toEqual([])
        expect(Object.keys((onSave2.mock.calls[0][0] as Spec).outputs)).toEqual(['direct', 'wg0', 'nl', 't2'])
    })
})

describe('редактор группы: занятая группа не удаляется', () => {
    function withGroup(): Spec {
        const s = free()
        s.outputs.eu = { name: 'eu', kind: 'group', pick: 'order', members: ['wg0', 'nl'] }
        return s
    }

    it('через группу ходит сервер DNS — отказ называет сервер', async () => {
        const s = withGroup()
        s.dns = { upstreams: { cf: { ...DOH, out: 'eu' } } }
        const onSave = vi.fn()
        render(<GroupEditor spec={s} name="eu" onSave={onSave} onCancel={() => {}} />)
        fireEvent.click(await screen.findByRole('button', { name: /Удалить/ }))
        expect(onSave).not.toHaveBeenCalled()
        expect(said()).toEqual(['Выход «eu» используется: серверы DNS — cf. Сначала уберите его оттуда'])
    })

    it('группа внутри другой группы — отказ называет объемлющую', async () => {
        const s = withGroup()
        s.outputs.all = { name: 'all', kind: 'group', pick: 'order', members: ['eu'] }
        const onSave = vi.fn()
        render(<GroupEditor spec={s} name="eu" onSave={onSave} onCancel={() => {}} />)
        fireEvent.click(await screen.findByRole('button', { name: /Удалить/ }))
        expect(onSave).not.toHaveBeenCalled()
        expect(said()).toEqual(['Выход «eu» используется: группы — all. Сначала уберите его оттуда'])
    })

    it('свободная группа удаляется', async () => {
        const onSave = vi.fn()
        render(<GroupEditor spec={withGroup()} name="eu" onSave={onSave} onCancel={() => {}} />)
        fireEvent.click(await screen.findByRole('button', { name: /Удалить/ }))
        expect(said()).toEqual([])
        expect(Object.keys((onSave.mock.calls[0][0] as Spec).outputs)).toEqual(['direct', 'wg0', 'nl'])
    })
})

describe('«Свои туннели»: выключатель не убирает занятый выход', () => {
    beforeEach(() => {
        window.localStorage.clear()
    })

    async function switchOff(spec: Spec) {
        pending.saved = spec
        pending.applied = spec
        vi.spyOn(rpc, 'specGet').mockResolvedValue(spec)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue(spec)
        const set = vi.spyOn(rpc, 'specSet').mockResolvedValue({ ok: true } as never)
        render(<IfacesPanel live={live()} />)
        ;(await screen.findByRole('switch', { name: 'wg1' })).click()
        await new Promise((r) => setTimeout(r, 10))
        await pending.flush()
        return set
    }

    it('через выход ходит сервер DNS — выход остаётся, на роутер ничего не уходит', async () => {
        const set = await switchOff(base())
        expect(said()).toEqual(['Выход «nl» используется: серверы DNS — cf. Сначала уберите его оттуда'])
        expect(set).not.toHaveBeenCalled()
        expect(Object.keys(pending.saved!.outputs)).toEqual(['direct', 'wg0', 'nl'])
        expect(pending.saved!.dns!.upstreams!.cf.out).toBe('nl')
    })

    it('никто не держит — выключается, и спека остаётся цельной', async () => {
        const set = await switchOff(free())
        expect(said()).toEqual([])
        expect(set).toHaveBeenCalledTimes(1)
        expect(Object.keys(pending.saved!.outputs)).toEqual(['direct', 'wg0'])
    })

    it('устройство в пуле вместе с другим — выход остаётся, ссылки на него целы', async () => {
        const s = base()
        s.outputs.nl = { name: 'nl', kind: 'interface', device: 'wg1', devices: ['wg1', 'wg0'], on_fail: 'drop' }
        const set = await switchOff(s)
        expect(said()).toEqual([])
        expect(set).toHaveBeenCalledTimes(1)
        expect(pending.saved!.outputs.nl.devices).toEqual(['wg0'])
        expect(pending.saved!.dns!.upstreams!.cf.out).toBe('nl')
    })
})

describe('переименование выхода уводит за собой все ссылки', () => {
    /** Выход nl держат все: правило, свой DNS в правиле, сервер DNS, туннель поверх, группа с default. */
    function held(): Spec {
        const s = base()
        s.outputs.eu = { name: 'eu', kind: 'group', pick: 'manual', members: ['wg0', 'nl'], default: 'nl' }
        s.outputs.xs = { name: 'xs', kind: 'interface', device: 'wg2', obfs: { server: '203.0.113.7:1', listen: '127.0.0.1:2' }, over: 'nl' } as Output
        s.channels = [
            { name: 'Новости', out: 'nl', match: { domains_files: ['/l/a.lst'] } },
            { name: 'Видео', out: 'wg0', match: { domains_files: ['/l/b.lst'] }, dns: { ...DOH, out: 'nl' } },
        ]
        return s
    }

    function expectFollowed(next: Spec, to: string) {
        expect(Object.keys(next.outputs)).not.toContain('nl')
        expect(next.channels.map((c) => c.out)).toEqual([to, 'wg0'])
        expect((next.channels[1].dns as { out?: string }).out).toBe(to)
        expect(next.dns!.upstreams!.cf.out).toBe(to)
        expect(next.outputs.xs.over).toBe(to)
        expect(next.outputs.eu.members).toEqual(['wg0', to])
        expect(next.outputs.eu.default).toBe(to)
    }

    it('редактор выхода: новое имя — и правила, и DNS, и туннели, и группы', async () => {
        const onSave = pool(held(), 'nl')
        const title = (await screen.findByLabelText('имя выхода')) as HTMLInputElement
        fireEvent.input(title, { target: { value: 'nl2' } })
        fireEvent.click(await screen.findByRole('button', { name: /Сохранить выход/ }))
        await waitFor(() => expect(onSave).toHaveBeenCalled())
        expect(said()).toEqual([])
        expectFollowed(onSave.mock.calls[0][0] as Spec, 'nl2')
    })

    it('редактор группы: новое имя — и правила, и DNS, и туннели, и объемлющие группы', async () => {
        const s = held()
        s.outputs.nl = { name: 'nl', kind: 'group', pick: 'order', members: ['wg0'], on_fail: 'drop' }
        const onSave = vi.fn()
        render(<GroupEditor spec={s} name="nl" onSave={onSave} onCancel={() => {}} />)
        fireEvent.input(await screen.findByLabelText('имя группы'), { target: { value: 'nl2' } })
        fireEvent.click(screen.getByText(/Сохранить группу/))
        expect(said()).toEqual([])
        const next = onSave.mock.calls[0][0] as Spec
        expectFollowed(next, 'nl2')
        expect(next.outputs.nl2).toMatchObject({ kind: 'group', members: ['wg0'] })
    })

    it('без переименования ссылки не трогаются', async () => {
        const onSave = pool(held(), 'nl')
        fireEvent.click(await screen.findByRole('button', { name: /Сохранить выход/ }))
        await waitFor(() => expect(onSave).toHaveBeenCalled())
        const next = onSave.mock.calls[0][0] as Spec
        expect(next.dns!.upstreams!.cf.out).toBe('nl')
        expect(next.outputs.eu.members).toEqual(['wg0', 'nl'])
        expect(next.outputs.xs.over).toBe('nl')
    })
})

describe('список выходов: открыть выход и нажать «Удалить»', () => {
    beforeEach(() => {
        vi.spyOn(rpc, 'outboundGeo').mockRejectedValue(new Error('нет'))
        vi.spyOn(rpc, 'helper').mockResolvedValue({ code: 1, stdout: '' })
    })

    async function open(spec: Spec) {
        pending.saved = spec
        pending.applied = spec
        pending.dirty = false
        vi.spyOn(rpc, 'specGet').mockResolvedValue(spec)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue(spec)
        const set = vi.spyOn(rpc, 'specSet').mockResolvedValue({ ok: true } as never)
        render(<PoolList live={withPools} />)
        fireEvent.click(await screen.findByText('nl'))
        fireEvent.click(await screen.findByRole('button', { name: /Удалить/ }))
        await new Promise((r) => setTimeout(r, 10))
        await pending.flush()
        return set
    }

    it('через выход идёт DNS: редактор остаётся открытым, спека не меняется и на роутер не уходит', async () => {
        const spec = base()
        const set = await open(spec)
        expect(said()).toEqual(['Выход «nl» используется: серверы DNS — cf. Сначала уберите его оттуда'])
        expect(set).not.toHaveBeenCalled()
        expect(pending.saved).toBe(spec)
        expect(pending.hasUnsaved()).toBe(false)
        // Редактор не закрылся: «Удалить» на месте, список выходов не показан.
        expect(screen.getByRole('button', { name: /Удалить/ })).toBeInTheDocument()
    })

    it('никто не держит: выход уходит, и на роутер едет спека без висячих ссылок', async () => {
        const set = await open(free())
        expect(said()).toEqual([])
        expect(set).toHaveBeenCalledTimes(1)
        const sent = decodeSpec(JSON.parse(set.mock.calls[0][0] as string))
        expect(Object.keys(sent.outputs)).toEqual(['direct', 'wg0'])
        expect(missingText(sent)).toBeNull()
        expect(pending.saved!.outputs.nl).toBeUndefined()
    })
})

describe('ядро всё же отвергло спеку с висячей ссылкой — тост называет, кто ссылается', () => {
    const RAW = 'steer: /etc/steer/spec.json.new.5321:1:369: dns.upstreams.cf.out: выхода «nl» нет в outputs (или слово direct — напрямую)'

    async function failedWrite(spec: Spec, error: string) {
        pending.saved = free()
        pending.applied = free()
        pending.dirty = false
        vi.spyOn(rpc, 'specSet').mockResolvedValue({ ok: false, error } as never)
        pending.edit(spec)
        await pending.flush()
    }

    it('вместо слов ядра с путём временного файла — сервер DNS и что делать', async () => {
        const s = base()
        const { nl: _n, ...outputs } = s.outputs
        await failedWrite({ ...s, outputs }, RAW)
        expect(said()).toEqual(['Выхода «nl» нет, но он выбран: серверы DNS — cf. Выберите там другой выход'])
        expect(vi.mocked(notify).mock.calls[0][1]).toBe('error')
        expect(pending.dirty).toBe(true)
    })

    it('причина не в выходе — слова ядра как были', async () => {
        await failedWrite(free(), 'steer: /etc/steer/spec.json.new.5321:1:9: неизвестный ключ «опечатка»')
        expect(said()).toEqual(['steer: /etc/steer/spec.json.new.5321:1:9: неизвестный ключ «опечатка»'])
    })
})

// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { missingText, outputBusy, outputUsers, renameRefs } from '@/lib/outrefs'
import { encodeSpec } from '@/lib/specv2'
import { type Output, type Spec } from '@/lib/model'

// КТО ДЕРЖИТ ВЫХОД. «Когда удаляешь выход, настройки не применяются, если через него идёт DNS;
// лечится руками» (обращение из Telegram). Выход называют по имени не только правила: ещё сервер
// DNS («через выход», dns.upstreams.<имя>.out), свой сервер DNS в правиле, группа (член) и туннель
// (`over`). Ядро проверяет каждую такую ссылку и отвергает спеку ЦЕЛИКОМ («выхода «wg1» нет в
// outputs»), а панель при удалении и переименовании выхода смотрела только на правила: выход
// убирался, spec_set отказывал на каждой следующей правке, «Применить» применяло прежнюю спеку.
//
// Здесь — сама проверка держателей (lib/outrefs.ts) и её согласие с НАСТОЯЩИМ ядром: какие висячие
// ссылки ядро отвергает, что оно говорит и что принимает после переименования. Ядро берётся из
// ../steer/build/steer (STEER_BIN); нет ядра — часть со сверкой пропускается, как у specv2-engine.

const STEER = process.env.STEER_BIN || path.resolve(__dirname, '../../../steer/build/steer')
const HAVE = existsSync(STEER)
const dir = mkdtempSync(path.join(tmpdir(), 'outrefs-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
mkdirSync(path.join(dir, 'lists'), { recursive: true })
const dom = path.join(dir, 'lists', 'dom.lst')
const dom2 = path.join(dir, 'lists', 'dom2.lst')
writeFileSync(dom, 'example.org\n')
writeFileSync(dom2, 'example.net\n')

/** Ответ ядра на спеку, как её пишет панель: `apply --dry-run`, ничего не меняя. */
function core(spec: Spec, name: string): { ok: boolean; err: string } {
    const f = path.join(dir, `${name}.json`)
    writeFileSync(f, JSON.stringify(encodeSpec(spec)))
    try {
        execFileSync(STEER, ['apply', '--dry-run', '--spec', f, '--state-dir', path.join(dir, 'state')], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        })
        return { ok: true, err: '' }
    } catch (e) {
        return { ok: false, err: String((e as { stderr?: string }).stderr ?? e) }
    }
}

const OBFS = { mode: 'wg-over-tcp' as const, server: '203.0.113.7:51820', listen: '127.0.0.1:51821' }

/** Выход wg1 держат все пятеро: правило, свой DNS в правиле, сервер DNS, группа, туннель поверх. */
function held(): Spec {
    return {
        outputs: {
            direct: { name: 'direct', kind: 'direct' },
            wg0: { name: 'wg0', kind: 'interface', device: 'wg0' },
            wg1: { name: 'wg1', kind: 'interface', device: 'wg1' },
            wg2: { name: 'wg2', kind: 'interface', device: 'wg2', obfs: OBFS, over: 'wg1' },
            eu: { name: 'eu', kind: 'group', pick: 'manual', members: ['wg0', 'wg1'], default: 'wg1' },
        },
        channels: [
            { name: 'Новости', out: 'wg1', match: { domains_files: [dom] } },
            { name: 'Видео', out: 'wg0', match: { domains_files: [dom2] }, dns: { url: 'tls://one.one.one.one', ips: ['1.1.1.1'], out: 'wg1' } },
        ],
        dns: {
            upstream: 'cf',
            upstreams: {
                cf: { url: 'https://cloudflare-dns.com/dns-query', ips: ['1.1.1.1'], out: 'wg1' },
                google: { url: 'https://dns.google/dns-query', ips: ['8.8.8.8'], out: 'wg0' },
            },
        },
    }
}

/** То же без выхода wg1 и без единой ссылки на него — как после честного удаления. */
function freed(): Spec {
    const s = held()
    const { wg1: _w, ...outputs } = s.outputs
    return {
        ...s,
        outputs: {
            ...outputs,
            wg2: { name: 'wg2', kind: 'interface', device: 'wg2', obfs: OBFS },
            eu: { name: 'eu', kind: 'group', pick: 'manual', members: ['wg0'], default: 'wg0' },
        },
        channels: [
            { name: 'Новости', out: 'wg0', match: { domains_files: [dom] } },
            { name: 'Видео', out: 'wg0', match: { domains_files: [dom2] }, dns: { url: 'tls://one.one.one.one', ips: ['1.1.1.1'] } },
        ],
        dns: {
            upstream: 'cf',
            upstreams: {
                cf: { url: 'https://cloudflare-dns.com/dns-query', ips: ['1.1.1.1'] },
                google: { url: 'https://dns.google/dns-query', ips: ['8.8.8.8'], out: 'wg0' },
            },
        },
    }
}

/** Выход wg1 убран, а то, что на него ссылалось, осталось, — ровно то, что делали редакторы. */
function dangling(): Spec {
    const s = held()
    const { wg1: _w, ...outputs } = s.outputs
    return { ...s, outputs }
}

describe('кто держит выход', () => {
    it('называет всех пятерых: правила, свой DNS в правиле, серверы DNS, группы, туннели поверх', () => {
        expect(outputUsers(held(), ['wg1'])).toEqual({
            rules: ['Новости'], ruleDns: ['Видео'], dns: ['cf'], groups: ['eu'], over: ['wg2'],
        })
        // wg0 держат правило «Видео», сервер google и группа eu.
        expect(outputUsers(held(), ['wg0'])).toEqual({
            rules: ['Видео'], ruleDns: [], dns: ['google'], groups: ['eu'], over: [],
        })
    })

    it('выход, которого никто не называет, свободен', () => {
        expect(outputBusy(held(), 'wg2')).toBeNull()
        expect(outputBusy(freed(), 'wg0')).not.toBeNull()
        // Убранный вместе с ним держатель не в счёт: туннель wg2 уходит вместе с wg1.
        expect(outputUsers(held(), ['wg1', 'wg2']).over).toEqual([])
    })

    it('отказ называет каждого держателя и говорит, что делать', () => {
        const text = outputBusy(held(), 'wg1')!
        expect(text).toBe(
            'Выход «wg1» используется: правила — Новости; серверы DNS — cf; ' +
            'свой сервер DNS в правилах — Видео; группы — eu; туннели через него — wg2. Сначала уберите его оттуда',
        )
    })

    it('выход, через который ходит только DNS, тоже занят', () => {
        const s = freed()
        s.dns!.upstreams!.cf = { ...s.dns!.upstreams!.cf, out: 'wg0' }
        s.channels = s.channels.map((c) => ({ ...c, out: 'direct' }))
        s.outputs.eu = { name: 'eu', kind: 'group', pick: 'order', members: ['direct'] } as Output
        expect(outputBusy(s, 'wg0')).toBe('Выход «wg0» используется: серверы DNS — cf, google. Сначала уберите его оттуда')
    })

    it('часть пула, идущая через выход, называется своим пулом; части убираются вместе с пулом', () => {
        const s = freed()
        s.outputs = {
            ...s.outputs,
            vpn: { name: 'vpn', kind: 'interface', devices: ['vpn-1', 'vpn-2'], device: 'vpn-1' },
            'vpn-1': { name: 'vpn-1', kind: 'vless', sub_file: '/s.txt', part_of: 'vpn', over: 'wg0' },
            'vpn-2': { name: 'vpn-2', kind: 'vless', sub_file: '/s.txt', part_of: 'vpn', over: 'wg0' },
        }
        expect(outputUsers(s, ['wg0']).over).toEqual(['vpn'])
        // Пул и его части убираются вместе — держатели среди них не в счёт.
        expect(outputUsers(s, ['vpn', 'vpn-1', 'vpn-2'])).toEqual({ rules: [], ruleDns: [], dns: [], groups: [], over: [] })
    })
})

describe('переименование выхода', () => {
    it('уводит за новым именем правила, свой DNS, серверы DNS, туннели поверх, членов групп и default', () => {
        const { wg1: old, ...rest } = held().outputs
        const next = renameRefs({ ...held(), outputs: { ...rest, nl: { ...old, name: 'nl' } } }, 'wg1', 'nl')
        expect(next.channels.map((c) => c.out)).toEqual(['nl', 'wg0'])
        expect((next.channels[1].dns as { out?: string }).out).toBe('nl')
        expect(next.dns!.upstreams!.cf.out).toBe('nl')
        expect(next.dns!.upstreams!.google.out).toBe('wg0')
        expect(next.outputs.wg2.over).toBe('nl')
        expect(next.outputs.eu.members).toEqual(['wg0', 'nl'])
        expect(next.outputs.eu.default).toBe('nl')
        expect(outputUsers(next, ['wg1'])).toEqual({ rules: [], ruleDns: [], dns: [], groups: [], over: [] })
        expect(missingText(next)).toBeNull()
    })

    it('не трогает чужое: тот же объект, если на выход никто не ссылается', () => {
        const s = freed()
        const next = renameRefs(s, 'ghost', 'new')
        expect(next.channels).toEqual(s.channels)
        expect(next.dns).toBe(s.dns)
        expect(next.outputs.wg0).toBe(s.outputs.wg0)
        expect(renameRefs(s, 'wg0', 'wg0')).toBe(s)
    })
})

describe('ссылка на выход, которого нет, словами', () => {
    it('называет, кто ссылается, и что делать', () => {
        expect(missingText(dangling())).toBe(
            'Выхода «wg1» нет, но он выбран: правила — Новости; серверы DNS — cf; ' +
            'свой сервер DNS в правилах — Видео; группы — eu; туннели через него — wg2. Выберите там другой выход',
        )
    })

    it('целая спека — ничего; слово direct у сервера DNS — «напрямую», а не потерянный выход', () => {
        expect(missingText(held())).toBeNull()
        const s = freed()
        s.dns!.upstreams!.cf = { ...s.dns!.upstreams!.cf, out: 'direct' }
        expect(missingText(s)).toBeNull()
        const noDirect = freed()
        delete (noDirect.outputs as Record<string, Output>).direct
        noDirect.dns!.upstreams!.cf = { ...noDirect.dns!.upstreams!.cf, out: 'direct' }
        expect(missingText(noDirect)).toBeNull()
    })

    it('правило без выхода — не «выхода «» нет»: это решает ядро своими словами', () => {
        const s = freed()
        s.channels = [{ ...s.channels[0], out: '' }]
        expect(missingText(s)).toBeNull()
    })
})

describe.skipIf(!HAVE)('выход, которого нет, — глазами настоящего ядра', () => {
    it('спека до правки: выход убран, DNS остался — ядро отвергает, и это его слова', () => {
        // Именно эту спеку панель держала в памяти после удаления выхода, через который ходит DNS.
        const only: Spec = {
            outputs: { direct: { name: 'direct', kind: 'direct' }, wg0: { name: 'wg0', kind: 'interface', device: 'wg0' } },
            channels: [],
            dns: { upstreams: { cf: { url: 'https://cloudflare-dns.com/dns-query', ips: ['1.1.1.1'], out: 'wg1' } } },
        }
        const r = core(only, 'only-dns')
        expect(r.ok).toBe(false)
        expect(r.err).toContain('dns.upstreams.cf.out')
        expect(r.err).toContain('выхода «wg1» нет в outputs')
        // Человеку — не это, а кто ссылается и что делать.
        expect(missingText(only)).toBe('Выхода «wg1» нет, но он выбран: серверы DNS — cf. Выберите там другой выход')
    })

    it('ядро отвергает каждую из пяти висячих ссылок, и панель их все узнаёт', () => {
        const base = (): Spec => ({
            outputs: {
                direct: { name: 'direct', kind: 'direct' },
                wg0: { name: 'wg0', kind: 'interface', device: 'wg0' },
                wg1: { name: 'wg1', kind: 'interface', device: 'wg1' },
            },
            channels: [{ name: 'Новости', out: 'wg0', match: { domains_files: [dom] } }],
        })
        const cases: Record<string, (s: Spec) => void> = {
            'правило': (s) => { s.channels[0].out = 'ghost' },
            'свой DNS в правиле': (s) => { s.channels[0].dns = { url: 'tls://one.one.one.one', ips: ['1.1.1.1'], out: 'ghost' } },
            'сервер DNS': (s) => { s.dns = { upstreams: { cf: { url: 'https://cloudflare-dns.com/dns-query', ips: ['1.1.1.1'], out: 'ghost' } } } },
            'туннель поверх': (s) => { s.outputs.wg1 = { ...s.outputs.wg1, obfs: OBFS, over: 'ghost' } },
            'член группы': (s) => { s.outputs.g = { name: 'g', kind: 'group', pick: 'order', members: ['wg0', 'ghost'] } },
        }
        for (const [what, mutate] of Object.entries(cases)) {
            const s = base()
            expect(core(s, 'ok-base').ok, 'исходная спека годна').toBe(true)
            mutate(s)
            const r = core(s, `bad-${what.length}`)
            expect(r.ok, `${what}: ядро отвергает`).toBe(false)
            expect(r.err, `${what}: ядро называет выход`).toContain('«ghost»')
            expect(missingText(s), `${what}: панель узнаёт`).toContain('«ghost»')
        }
    })

    it('слово direct у сервера DNS ядро принимает и без выхода с таким именем', () => {
        const s: Spec = {
            outputs: { wg0: { name: 'wg0', kind: 'interface', device: 'wg0' } },
            channels: [],
            dns: { upstreams: { cf: { url: 'https://cloudflare-dns.com/dns-query', ips: ['1.1.1.1'], out: 'direct' } } },
        }
        expect(core(s, 'dns-direct').ok).toBe(true)
        expect(missingText(s)).toBeNull()
    })

    it('честно освобождённый выход ядро принимает; то же без освобождения — нет', () => {
        expect(core(held(), 'held').ok, 'исходная').toBe(true)
        expect(core(freed(), 'freed').ok, 'после освобождения').toBe(true)
        expect(core(dangling(), 'dangling').ok, 'выход убран, держатели остались').toBe(false)
    })

    it('переименованный выход: со ссылками ядро принимает спеку, без — отвергает', () => {
        const { wg1: old, ...rest } = held().outputs
        const renamed: Spec = { ...held(), outputs: { ...rest, nl: { ...old, name: 'nl' } } }
        const before = core(renamed, 'rename-before')
        expect(before.ok, 'ключ сменили, ссылки остались').toBe(false)
        expect(before.err).toContain('«wg1»')
        const after = core(renameRefs(renamed, 'wg1', 'nl'), 'rename-after')
        expect(after.err).toBe('')
        expect(after.ok).toBe(true)
    })
})

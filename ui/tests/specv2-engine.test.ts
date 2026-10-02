// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { decodeSpec, encodeSpec, wasV1 } from '@/lib/specv2'

// Кодек спеки v2 против НАСТОЯЩЕГО движка.
//
// Проверяется главное свойство границы: то, что интерфейс записал бы на роутер, движок
// компилирует в ТОТ ЖЕ набор правил, что и спеку, из которой интерфейс это прочитал.
//   - спека v1 (как её писали прежние выпуски) → decodeSpec → encodeSpec → `apply --dry-run`
//     даёт тот же ruleset, что `apply --dry-run` самой v1;
//   - спека v2 «как ей пользуются» → кодек → тот же ruleset, что у исходной;
//   - пул v1 даёт тот же ruleset, что `steer spec convert` этой v1 (имена членов и порядок
//     выходов — как у движка: метки прежних выходов не сдвигаются).
// Движок берётся из ../steer/build/steer (make -C ../steer all); нет движка — стенд
// пропускается вслух, как enginematch.

const STEER = process.env.STEER_BIN || path.resolve(__dirname, '../../../steer/build/steer')
const HAVE = existsSync(STEER)
const dir = mkdtempSync(path.join(tmpdir(), 'specv2-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

mkdirSync(path.join(dir, 'lists'), { recursive: true })
const L = (n: string, body: string) => {
    const p = path.join(dir, 'lists', n)
    writeFileSync(p, body)
    return p
}
const news = L('news.lst', '10.0.0.0/8\n')
const dc = L('dc.lst', '162.159.128.0/17\n')
const dom = L('dom.lst', 'example.org\nexample.com\n')
const dom2 = L('dom2.lst', 'example.net\n')

function ruleset(doc: unknown, name: string): string {
    const f = path.join(dir, name)
    writeFileSync(f, JSON.stringify(doc))
    try {
        return execFileSync(STEER, ['apply', '--dry-run', '--spec', f, '--state-dir', path.join(dir, 'state')], {
            encoding: 'utf8',
        })
    } catch (e) {
        const err = e as { stderr?: string; message: string }
        throw new Error(`${name}: ${err.stderr || err.message}`)
    }
}

const v1Specs: Record<string, unknown> = {
    'обычный интерфейс и правило по доменам': {
        schema: 1,
        outputs: { direct: { kind: 'direct' }, wg0: { kind: 'interface', device: 'wg0', on_fail: 'drop' } },
        channels: [{ name: 'Новости', match: { domains_files: [dom] }, out: 'wg0' }],
    },
    'подсети и домены разных правил, клиент по адресу, режим realip, выключенное': {
        schema: 1,
        lan_devices: ['br-lan'],
        outputs: { direct: { kind: 'direct' }, wg0: { kind: 'interface', device: 'wg0' }, wg1: { kind: 'interface', device: 'wg1', on_fail: 'direct' } },
        channels: [
            { name: 'Первое', match: { prefixes_files: [news] }, out: 'wg0', from: ['192.168.1.50'] },
            { name: 'Второе', match: { domains_files: [dom], mode: 'realip' }, out: 'wg1' },
            { name: 'Третье', match: { domains_files: [dom2] }, out: 'wg0', enabled: false },
        ],
    },
    'исключение: правило на устройство старше глобальных': {
        schema: 2,
        outputs: { direct: { kind: 'direct' }, wg0: { kind: 'interface', device: 'wg0' } },
        channels: [
            { name: 'Глобальное', match: { domains_files: [dom] }, out: 'wg0' },
            { name: 'Телефон', match: { domains_files: [dom2] }, out: 'direct', from: ['aa:bb:cc:dd:ee:01'], scope: 'device' },
        ],
    },
    'сужение подсетей по портам': {
        schema: 2,
        outputs: { direct: { kind: 'direct' }, wg0: { kind: 'interface', device: 'wg0' } },
        channels: [
            { name: 'Discord', match: { domains_files: [dom], prefixes_files: [] }, out: 'wg0' },
            { name: 'Discord (порты)', part_of: 'Discord', match: { prefixes_files: [dc], proto: 'udp', ports: ['50000-65535'] }, out: 'wg0' },
        ],
    },
    'пул устройств': {
        schema: 1,
        outputs: {
            direct: { kind: 'direct' },
            vpn: { kind: 'interface', devices: ['wg0', 'wg1'], on_fail: 'drop' },
            solo: { kind: 'interface', device: 'wg2' },
        },
        channels: [
            { name: 'А', match: { domains_files: [dom] }, out: 'vpn' },
            { name: 'Б', match: { domains_files: [dom2] }, out: 'solo' },
        ],
    },
}

describe.skipIf(!HAVE)('кодек v2 против движка', () => {
    for (const [name, v1] of Object.entries(v1Specs)) {
        it(`v1 «${name}»: тот же набор правил`, () => {
            const before = ruleset(v1, 'a.json')
            const ui = decodeSpec(v1)
            expect(wasV1(ui)).toBe(true)
            const v2 = encodeSpec({ ...ui, schema: undefined })
            expect(v2.version).toBe(2)
            const after = ruleset(v2, 'b.json')
            expect(after).toBe(before)
        })
    }

    it('повторное чтение и запись v2 ничего не меняет (счётчик «Применить» обнуляется)', () => {
        for (const v1 of Object.values(v1Specs)) {
            const once = encodeSpec({ ...decodeSpec(v1), schema: undefined })
            const twice = encodeSpec(decodeSpec(once))
            expect(twice).toEqual(once)
        }
    })

    it('пул v1: как у `steer spec convert`', () => {
        const v1 = v1Specs['пул устройств']
        const f = path.join(dir, 'pool-v1.json')
        writeFileSync(f, JSON.stringify(v1))
        const yaml = execFileSync(STEER, ['spec', 'convert', '--spec', f], { encoding: 'utf8' })
        const g = path.join(dir, 'pool.yaml')
        writeFileSync(g, yaml)
        const viaEngine = execFileSync(STEER, ['apply', '--dry-run', '--spec', g, '--state-dir', path.join(dir, 'state')], { encoding: 'utf8' })
        const v2 = encodeSpec({ ...decodeSpec(v1), schema: undefined })
        expect(ruleset(v2, 'pool-v2.json')).toBe(viaEngine)
    })

    it('v2 со своими выходами: группы, туннель, ipv6, dns', () => {
        const v2 = {
            version: 2,
            lan: { devices: ['br-lan'] },
            clients: { kids: { mac: ['aa:bb:cc:dd:ee:01'] } },
            lists: { work: { domains_file: [dom] }, voice: { all: true, proto: 'udp', ports: ['50000-65535'] } },
            outputs: {
                wg0: { kind: 'interface', device: 'wg0', ipv6: 'nat' },
                wg1: { kind: 'interface', device: 'wg1' },
                fast: { kind: 'group', pick: 'latency', members: ['wg0', 'wg1'], tolerance: 50, url: 'http://cp.cloudflare.com/generate_204', idle_timeout: 600, ipv6: 'off' },
                eu: { kind: 'group', pick: 'manual', members: ['wg0', 'wg1'], default: 'wg1' },
                bal: { kind: 'group', pick: 'balance', members: ['wg0', 'wg1'], weights: [2, 1] },
            },
            dns: {
                cache: 512, cache_ttl: { min: 60, max: 7200, negative: 5 }, bootstrap: ['1.1.1.1'], upstream: 'g',
                upstreams: { g: { url: 'https://dns.google/dns-query', out: 'wg0' }, q: { url: 'quic://dns.adguard-dns.com', bootstrap: ['9.9.9.9'] } },
            },
            rules: [
                { name: 'kids', for: 'kids', to: 'all', out: 'eu', scope: 'device' },
                { name: 'work', to: ['work'], out: 'fast', resolve: 'realip', dns: 'g' },
                { name: 'udp', to: ["voice"], out: "bal" },
            ],
        }
        const before = ruleset(v2, 'c.json')
        const ui = decodeSpec(v2)
        expect(ui.outputs.eu.kind).toBe('group')
        expect(ui.outputs.eu.pick).toBe('manual')
        expect(ui.dns?.upstreams?.g.out).toBe('wg0')
        expect(ui.dns?.upstreams?.q.bootstrap).toEqual(['9.9.9.9'])
        expect(encodeSpec(ui).dns).toEqual(v2.dns)
        expect(ui.channels.map((c) => c.name)).toEqual(['kids', 'work', 'udp'])
        const after = ruleset(encodeSpec(ui), 'd.json')
        expect(after).toBe(before)
    })
})

describe.skipIf(!HAVE)('кодек v2 против движка: режим раздачи balance', () => {
    it('by: site и site_client — тот же набор правил после круга, хеш вместо случайного', () => {
        const v2 = {
            version: 2,
            outputs: {
                wg0: { kind: 'interface', device: 'wg0' },
                wg1: { kind: 'interface', device: 'wg1' },
                s: { kind: 'group', pick: 'balance', members: ['wg0', 'wg1'], by: 'site' },
                sc: { kind: 'group', pick: 'balance', members: ['wg0', 'wg1'], weights: [1, 3], by: 'site_client' },
            },
            lists: { a: { domains_file: [dom] }, b: { domains_file: [dom2] } },
            rules: [{ name: 'a', to: ['a'], out: 's' }, { name: 'b', to: ['b'], out: 'sc' }],
        }
        const before = ruleset(v2, 'by-a.json')
        expect(before).toContain('jhash ip daddr mod 120')
        expect(before).toContain('jhash ip saddr . ip daddr mod 120')
        expect(before).not.toContain('numgen')
        const ui = decodeSpec(v2)
        expect(ui.outputs.s.by).toBe('site')
        expect(ruleset(encodeSpec(ui), 'by-b.json')).toBe(before)
    })
})

describe.skipIf(!HAVE)('кодек v2 против движка: ключи, которых модель не знает', () => {
    it('override_port списка: тот же набор правил после круга', () => {
        const v2 = {
            version: 2,
            outputs: { wg0: { kind: 'interface', device: 'wg0' } },
            lists: { yt: { domains_file: [dom], override_port: 8443 }, b: { domains_file: [dom2] } },
            rules: [{ name: 'yt', to: ['yt'], out: 'wg0' }, { name: 'b', to: ['b'], out: 'wg0' }],
        }
        const before = ruleset(v2, 'op-a.json')
        expect(before).toContain(': 8443')
        expect(ruleset(encodeSpec(decodeSpec(v2)), 'op-b.json')).toBe(before)
    })

    it('порт из редактора правила: домены с подменой рядом с подсетями ядро принимает', () => {
        const rs = ruleset(encodeSpec({
            outputs: { direct: { name: 'direct', kind: 'direct' }, wg0: { name: 'wg0', kind: 'interface', device: 'wg0' } },
            channels: [{
                name: 'yt', out: 'wg0',
                match: { domains_files: [dom, dom2], prefixes_files: [news], mode: 'fakeip' },
                file_extra: { [dom]: { override_port: 8443 }, [dom2]: { override_port: 8443 } },
            }],
        }), 'op-ui.json')
        expect(rs).toContain(': 8443')
        expect(rs).toContain('10.0.0.0/8')
    })
})

describe.skipIf(!HAVE)('кодек v2 против движка: адреса и MAC в одном правиле', () => {
    it('спека проходит ядро и забирает трафик и адреса, и MAC', () => {
        for (const narrow of [false, true]) {
            const rs = ruleset(encodeSpec({
                outputs: { direct: { name: 'direct', kind: 'direct' }, wg0: { name: 'wg0', kind: 'interface', device: 'wg0' } },
                channels: [{
                    name: 'dom', out: 'wg0', from: ['192.168.1.50', 'aa:bb:cc:dd:ee:01'],
                    match: { domains_files: [dom], ...(narrow ? { prefixes_files: [dc] } : {}) },
                    ...(narrow ? { narrow: { [dc]: { proto: 'udp' as const, ports: ['50000-65535'] } } } : {}),
                }],
            }), `mix-${narrow}.json`)
            expect(rs).toContain('192.168.1.50')
            expect(rs).toContain('aa:bb:cc:dd:ee:01')
        }
    })
})

describe.skipIf(!HAVE)('кодек v2 против движка: «кому» с IPv6 и диапазонами', () => {
    it('адреса IPv6, подсети IPv6 и диапазоны a-b ядро принимает и ставит в правила', () => {
        const from = ['192.168.1.10-192.168.1.20', '2001:db8::1', 'fd00::/64', '2001:db8::10-2001:db8::1f']
        const rs = ruleset(encodeSpec({
            outputs: { direct: { name: 'direct', kind: 'direct' }, wg0: { name: 'wg0', kind: 'interface', device: 'wg0' } },
            channels: [{ name: 'v6', out: 'wg0', from, match: { domains_files: [dom], mode: 'fakeip' } }],
        }), 'from6.json')
        for (const a of from) expect(rs).toContain(a)
    })
})

describe.skipIf(!HAVE)('кодек v2 против движка: свой сервер DNS у правила', () => {
    it('правило с dns-отображением ядро принимает, и круг его не меняет', () => {
        const v2 = {
            version: 2,
            outputs: { wg0: { kind: 'interface', device: 'wg0' } },
            lists: { n: { domains_file: [dom] } },
            rules: [{ name: 'n', to: ['n'], out: 'wg0', dns: { url: 'tls://one.one.one.one', out: 'wg0', ips: ['1.1.1.1'] } }],
        }
        const before = ruleset(v2, 'rdns-a.json')
        const ui = decodeSpec(v2)
        expect(ui.channels[0].dns).toEqual({ url: 'tls://one.one.one.one', out: 'wg0', ips: ['1.1.1.1'] })
        expect(ruleset(encodeSpec(ui), 'rdns-b.json')).toBe(before)
    })
})

/* Туннели по подписке разбирает только сборка с видами модулей: базовая (build/steer) без
 * steer-vless отвергает `protocol: vless` целиком. Рядом с ядром для стендов лежит build/steer-xk —
 * демон базовой сборки с видами vless, hysteria2 и прокси (steer/Makefile); его и спрашиваем. Ядро
 * без умения `exclude` ключ отвергает — тогда стенд пропускается вслух, а не краснеет на чужом. */
const XK = path.join(path.dirname(STEER), 'steer-xk')
function xkConvert(doc: unknown, name: string): string {
    const f = path.join(dir, name)
    writeFileSync(f, JSON.stringify(doc))
    return execFileSync(XK, ['spec', 'convert', '--spec', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
const HAVE_XK_EXCL = (() => {
    if (!existsSync(XK)) return false
    try {
        xkConvert({ version: 2, outputs: { t: { kind: 'tunnel', protocol: 'vless', subscription: '/s.txt', exclude: ['RU'] } } }, 'xk-probe.json')
        return true
    } catch {
        return false
    }
})()

describe.skipIf(!HAVE_XK_EXCL)('кодек v2 против ядра: исключение узлов туннеля', () => {
    it('exclude и exclude_name выхода и частей пула ядро принимает и читает как записано', () => {
        const sub = path.join(dir, 'sub.txt')
        writeFileSync(sub, '')
        const ui = decodeSpec({ version: 2, outputs: { wg0: { kind: 'interface', device: 'wg0' } } })
        const doc = encodeSpec({
            ...ui,
            outputs: {
                ...ui.outputs,
                nl: { name: 'nl', kind: 'vless', sub_file: sub, nodes: [3], exclude: ['RU', 'US'], exclude_name: ['Мобильный', 'LTE'] },
                'vpn-1': { name: 'vpn-1', kind: 'trojan', sub_file: sub, part_of: 'vpn', exclude: ['RU', 'US'] },
                'vpn-2': { name: 'vpn-2', kind: 'hysteria2', sub_file: sub, part_of: 'vpn', exclude_name: ['LTE'] },
                vpn: { name: 'vpn', kind: 'interface', devices: ['vpn-1', 'vpn-2', 'wg0'], device: 'vpn-1' },
            },
            channels: [
                { name: 'a', out: 'nl', match: { domains_files: [dom] } },
                { name: 'b', out: 'vpn', match: { domains_files: [dom2] } },
            ],
        })
        const conv = xkConvert(doc, 'excl.json')
        expect(conv).toMatch(/nl:.*nodes: \[3\].*exclude: \[RU, US\], exclude_name: \["Мобильный", LTE\]/)
        expect(conv).toMatch(/vpn-1:.*protocol: trojan.*exclude: \[RU, US\]/)
        expect(conv).toMatch(/vpn-2:.*protocol: hysteria2.*exclude_name: \[LTE\]/)
        /* И круг через кодек ничего не меняет: прочитанное снова пишется тем же. */
        expect(xkConvert(encodeSpec(decodeSpec(doc)), 'excl-2.json')).toBe(conv)
    })
})

describe.skipIf(HAVE_XK_EXCL)('кодек v2 против ядра: исключение узлов — ПРОПУЩЕН', () => {
    it('нет steer-xk с умением exclude рядом с ядром (make -C ../steer build/steer-xk)', () => {
        expect(HAVE_XK_EXCL).toBe(false)
    })
})

describe.skipIf(HAVE)('кодек v2 против движка — ПРОПУЩЕН', () => {
    it('нет движка (make -C ../steer all)', () => {
        expect(HAVE).toBe(false)
    })
})

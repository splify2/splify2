import { fireEvent, render, screen } from '@testing-library/preact'
import { describe, expect, it } from 'vitest'
import OutputAdvanced, { advApply, advFrom, type Adv } from '@/components/OutputAdvanced'
import { decodeSpec, encodeSpec } from '@/lib/specv2'
import { S } from '@/copy'
import type { Output } from '@/lib/model'

// Пул «самый быстрый» — группа pick: latency спеки v2, и у неё кроме допуска и интервала есть
// адрес проверки (`url`) и пауза замера без трафика (`idle_timeout`). Дополнительные настройки
// выхода знали только первые два: адрес и паузу не показывали, а сохранение пула их стирало.

const doc = {
    version: 2,
    outputs: {
        vpn: { kind: 'group', pick: 'latency', members: ['vpn.wg0', 'vpn.wg1'], tolerance: 80, interval: 60,
            url: 'https://cp.cloudflare.com/generate_204', idle_timeout: 900 },
        'vpn.wg0': { kind: 'interface', device: 'wg0' },
        'vpn.wg1': { kind: 'interface', device: 'wg1' },
    },
}

const rebuilt = (adv: Adv): Output =>
    advApply({ name: 'vpn', kind: 'interface', devices: ['wg0', 'wg1'], device: 'wg0', on_fail: 'drop' }, adv, 'top')

describe('пул «самый быстрый»: адрес проверки и пауза замера', () => {
    it('сохранение пула без правок их не теряет', () => {
        const spec = decodeSpec(doc)
        const out = encodeSpec({ ...spec, outputs: { ...spec.outputs, vpn: rebuilt(advFrom(spec, 'vpn')) } })
        expect((out.outputs as Record<string, unknown>).vpn).toMatchObject({
            pick: 'latency', tolerance: 80, interval: 60, url: 'https://cp.cloudflare.com/generate_204', idle_timeout: 900,
        })
    })

    it('у «первого живого» их нет — ядро у order такие ключи не примет', () => {
        const spec = decodeSpec(doc)
        const o = rebuilt({ ...advFrom(spec, 'vpn'), pick: 'order' })
        expect(o.url).toBeUndefined()
        expect(o.idle_timeout).toBeUndefined()
    })

    it('поля видны у «самого быстрого» и пишут настройки', () => {
        const spec = decodeSpec(doc)
        let adv = advFrom(spec, 'vpn')
        const { rerender } = render(
            <OutputAdvanced adv={adv} onChange={(a) => { adv = a }} spec={spec} self={new Set(['vpn'])}
                show={{ tunnel: false, vless: false, iface: false, pool: true }} />,
        )
        const url = screen.getByLabelText(S.outputAdvanced.adresProverki) as HTMLInputElement
        expect(url.value).toBe('https://cp.cloudflare.com/generate_204')
        fireEvent.input(url, { target: { value: 'http://example.org/204' } })
        expect(adv.url).toBe('http://example.org/204')
        rerender(
            <OutputAdvanced adv={adv} onChange={(a) => { adv = a }} spec={spec} self={new Set(['vpn'])}
                show={{ tunnel: false, vless: false, iface: false, pool: true }} />,
        )
        fireEvent.input(screen.getByLabelText(S.outputAdvanced.neMeritBezTrafika), { target: { value: '0' } })
        expect(adv.idle_timeout).toBe(0)
        expect(rebuilt(adv)).toMatchObject({ url: 'http://example.org/204', idle_timeout: 0 })
    })
})

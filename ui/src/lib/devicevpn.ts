import { isPart, type Channel, type Output, type Spec } from '@/lib/model'
import { isClientAddr } from '@/lib/validate'
import { S } from '@/copy'

/** «Весь трафик устройства — в VPN»: выбрать устройство и выход — и всё, что устройство
 *  отправляет в интернет, идёт через выход.
 *
 *  В спеке это обычное правило: `from` — одно устройство, `match.any` — весь трафик, `scope: device` —
 *  правило на одно устройство, старше глобальных по построению (в спеке v2 — `to: all` и `scope:
 *  device`). Ядро ставит такое правило выше любого общего, куда бы оно ни легло в списке, поэтому
 *  устройство уходит в выход целиком, а исключения для него — отдельные правила `scope: device`
 *  выше (проверено на настоящем ядре, tests/specv2-engine.test.ts). Своя сеть в `all` не входит —
 *  роутер и соседи по дому остаются доступны.
 *
 *  Подсеть и диапазон ядро для `scope: device` отвергает (приоритет достался бы всем в ней), поэтому
 *  устройством здесь может быть только MAC или одиночный адрес. */

const MAC = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i

/** Устройство: MAC или одиночный адрес IPv4/IPv6 (подсеть и диапазон — нет). */
export function isDevice(v: string): boolean {
    const s = v.trim()
    if (MAC.test(s)) return true
    if (s.includes('-')) return false
    const slash = s.indexOf('/')
    if (slash >= 0 && !['32', '128'].includes(s.slice(slash + 1))) return false
    return isClientAddr(s)
}

/** Правило «весь трафик устройства»: одно устройство, `any`, `scope: device`. */
export function isDeviceAll(c: Channel): boolean {
    return c.scope === 'device' && !!c.match.any && c.from?.length === 1
}

/** Выходы, куда можно отправить всё: туннели и прокси; не «напрямую» (это исключение из правил, а не
 *  VPN) и не блок. Служебные части пулов человеку не предлагаются. */
export function vpnOutputs(outputs: Record<string, Output>): string[] {
    return Object.entries(outputs)
        .filter(([, o]) => o.kind !== 'direct' && (o.kind as string) !== 'block' && !isPart(o))
        .map(([n]) => n)
}

/** Спека с правилом «весь трафик `device` — через `out`». Правило этого устройства уже есть — у него
 *  меняется выход, и оно включается: второго такого же не заводится. `label` — как человек зовёт
 *  устройство (имя из аренды или сам адрес). */
export function withDeviceAll(spec: Spec, device: string, label: string, out: string): Spec {
    const who = device.trim()
    const at = spec.channels.findIndex((c) => isDeviceAll(c) && c.from![0].toLowerCase() === who.toLowerCase())
    if (at >= 0) {
        const channels = spec.channels.map((c, i) => (i === at ? { ...c, out, enabled: true } : c))
        return { ...spec, channels }
    }
    const used = new Set(spec.channels.map((c) => c.name))
    let name = S.deviceVpn.imyaPravila(label)
    for (let n = 2; used.has(name); n++) name = `${S.deviceVpn.imyaPravila(label)} ${n}`
    return {
        ...spec,
        channels: [...spec.channels, { name, out, from: [who], scope: 'device', match: { any: true } }],
    }
}

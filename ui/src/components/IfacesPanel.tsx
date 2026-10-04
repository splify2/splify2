import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Empty, Group } from '@/components/ui/layout'
import { notify } from '@/lib/notify'
import { outputBusy } from '@/lib/outrefs'
import { rpc } from '@/lib/rpc'
import { pending } from '@/lib/pending'
import { useSpecCopy } from '@/lib/speccopy'
import { type Output, type Spec } from '@/lib/model'
import { type Live } from '@/lib/live'

import { S } from '@/copy'
/** Какие туннели роутера splify2 берёт в работу.
 *
 *  Здесь человек отвечает на один вопрос: этот туннель мой рабочий или нет. Сам туннель
 *  (WireGuard, AmneziaWG, OpenVPN, xsteer) создаётся в сети роутера — это не наше дело и
 *  делается не здесь; наше — решить, можно ли вести в него трафик.
 *
 *  ВКЛЮЧЁННЫЙ = НАЗВАН В КАКОМ-НИБУДЬ ВЫХОДЕ, и второго места, где это хранится, нет.
 *  Отдельный список «доступных» рядом со списком выходов означал бы два источника правды:
 *  устройство помечено активным, а трафика в нём нет, потому что ни один выход его не
 *  называет. Поэтому тумблер прямо заводит выход с этим устройством и прямо его убирает.
 *
 *  Bode 26.10: устройства — строками одной карточки через волосяную линию, точка состояния
 *  слева, выключатель у правого края строки, как в приложении Splify2.
 *
 *  ТОЛЬКО СВОИ. Туннельных устройств у роутера больше, чем своих туннелей: устройство выхода
 *  vless, hysteria2, прокси, xsteer или awg заводит и держит само ядро (бэкенд помечает такие
 *  `owner: 'steer'`). Среди своих оно выглядело бы туннелем человека, и переключатель делал бы
 *  с ним то, чего никто не просил: включение заводит второй выход поверх туннеля ядра, а
 *  выключение вынимает устройство из выходов, которые его называют, — вплоть до удаления самого
 *  выхода (локацию смешанного пула оно выбросило бы из пула). Поэтому такие устройства здесь не
 *  показываются. Выход подписки правится в «Подписках», а в пул устройство ядра кладёт редактор
 *  выхода — там оно предлагается нарочно, локацией. */

const NAME_RE = /^[A-Za-z0-9_-]{1,24}$/

function devList(o: Output): string[] {
    return o.devices?.length ? o.devices : o.device ? [o.device] : []
}

export default function IfacesPanel({ live }: { live: Live }) {
    const [spec, setSpec] = useSpecCopy()
    const [devices, setDevices] = useState<
        { name: string; up: boolean; kind: string; ipv6?: 'nat' | 'off'; owner?: 'steer' }[]
    >([])

    useEffect(() => {
        rpc.devices().then((d) => setDevices(d.devices || [])).catch(() => setDevices([]))
    }, [])

    function edit(next: Spec) {
        setSpec(next)
        pending.edit(next)
    }

    if (!spec) return <div className="p-5 text-sm text-muted-foreground">{S.ifacesPanel.zagruzka}</div>

    /** Выходы, называющие это устройство. Их может быть несколько: одно и то же устройство
     *  законно стоит и в своём выходе, и запасным в пуле. */
    const usedBy = (dev: string) =>
        Object.entries(spec.outputs).filter(([, o]) => devList(o).includes(dev))

    function turnOn(dev: string) {
        let name = dev.replace(/[^A-Za-z0-9_-]/g, '')
        if (!NAME_RE.test(name)) name = 'tunnel'
        let n = 2
        while (spec!.outputs[name]) name = `${dev}${n++}`
        /* Ключ `ipv6` — с первой минуты, а не «по умолчанию», и по адресу IPv6 у самого устройства
         * (его называет бэкенд, `devices`). У туннеля вроде WARP пир один и с одним адресом IPv6,
         * клиенты LAN на ULA, и без подмены адреса IPv6 уходит в туннель как есть, а ответ не
         * возвращается: тут `nat`, и подмену на устройство ставит само ядро; masq6 у зоны
         * steer_iface мы не трогаем — зона общая для всех выходов, и подмена ВСЕГО её IPv6 сломала
         * бы `ipv6: routed` соседнего выхода. У туннеля с одним IPv4 подменять нечем, и `nat`
         * обернулся бы красным отказом ядра («нет адреса IPv6») вместо жёлтой строки: тут `off`,
         * клиенты идут по IPv4. Бэкенд о устройстве не знает — ключ не пишем: его допишет
         * самолечение при apply, по тому же правилу. */
        const hint = devices.find((d) => d.name === dev)?.ipv6
        edit({
            ...spec!,
            outputs: {
                ...spec!.outputs,
                [name]: {
                    name, kind: 'interface', devices: [dev], device: dev, on_fail: 'drop',
                    ...(hint ? { ipv6: hint } : {}),
                },
            },
        })
    }

    function turnOff(dev: string) {
        /* Выходы, у которых это устройство единственное: они уходят из спеки целиком. */
        const gone = Object.entries(spec!.outputs)
            .filter(([, o]) => devList(o).includes(dev) && devList(o).every((d) => d === dev))
            .map(([n]) => n)
        /* Занятый выход не убирается: правила, серверы DNS через него, туннели поверх него, группы —
         * иначе спека осталась бы со ссылкой на выход, которого нет, и не сохранялась бы вовсе. */
        for (const n of gone) {
            const busy = outputBusy(spec!, n, gone)
            if (busy) {
                notify(busy, 'warning')
                return
            }
        }
        const outputs: Record<string, Output> = {}
        for (const [n, o] of Object.entries(spec!.outputs)) {
            if (gone.includes(n)) continue
            const rest = devList(o).filter((d) => d !== dev)
            outputs[n] = devList(o).includes(dev) ? { ...o, devices: rest, device: rest[0] } : o
        }
        edit({ ...spec!, outputs })
    }

    /* Устройства ядра — не свои туннели: см. шапку файла. */
    const own = devices.filter((d) => d.owner !== 'steer')

    if (own.length === 0) {
        return (
            <Group>
                <Empty icon={ShieldCheck} text={S.ifacesPanel.tunnelnyhUstroystvNetTunnel} />
            </Group>
        )
    }

    return (
        <Group>
            {own.map((d) => {
                const outs = usedBy(d.name)
                const on = outs.length > 0
                const live_ = d.up || d.name in (live.devs || {})
                return (
                    <div key={d.name} className="flex min-h-[52px] select-none items-center gap-3 py-2">
                        <span
                            className={`h-2 w-2 shrink-0 rounded-full ${
                                live_ ? 'bg-success' : 'bg-muted-foreground'
                            }`}
                            aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{d.name}</div>
                            <div className="mt-0.5 truncate text-xs text-subtle">
                                {[d.kind, on ? S.ifacesPanel.vVyhodah(outs.map(([n]) => n).join(', ')) : '']
                                    .filter(Boolean)
                                    .join(' · ')}
                            </div>
                        </div>
                        <Switch
                            on={on}
                            label={d.name}
                            onClick={() => (on ? turnOff(d.name) : turnOn(d.name))}
                        />
                    </div>
                )
            })}
        </Group>
    )
}

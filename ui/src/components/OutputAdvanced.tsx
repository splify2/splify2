import { Block, CardHead, FieldRow, Segmented } from '@/components/ui/layout'
import { Chip, Field, NumField, Radio, inputCls } from '@/components/formbits'
import { isPart, isTunnelKind, type Ipv6Mode, type Output, type Spec } from '@/lib/model'

import { S } from '@/copy'
// Дополнительные настройки выхода, которые не зависят от того, из чего он собран: через какой
// выход идёт сам туннель, фильтр транспорта узлов, IPv6 от хоста и способ выбора в пуле.
// Живёт отдельно от редактора состава, чтобы тот не рос дальше: состав отвечает на «через что
// выходить», а здесь — «как именно».
//
// Bode 26.10, раскладка по образцу приложения Splify2: одна карточка «Дополнительно», в ней
// вопросы — через волосяную линию. «Через выход» — строкой «подпись слева, список справа», как
// «через выход» у выхода в приложении; способ выбора в пуле (два варианта) — сегментами; IPv6
// (четыре варианта с длинными подписями, в сегменты на телефоне не помещаются) — радиосписком.

export interface Adv {
    /** Выход-подложка для самого туннеля (`over`); пусто — напрямую. */
    over: string
    /** Фильтр транспорта узлов VLESS; пусто — любые. */
    transport: string[]
    /** IPv6 от хоста; пусто — как у вида. */
    ipv6: '' | Ipv6Mode
    prefix: string
    /** Пул: первый живой либо самый быстрый. */
    pick: 'order' | 'latency'
    tolerance?: number
    interval?: number
}

const TRANSPORTS = ['tcp', 'ws', 'httpupgrade', 'grpc', 'xhttp']

/** Настройки из уже существующего выхода `name` (и его частей, если он пул). */
export function advFrom(spec: Spec, name?: string): Adv {
    const o = name ? spec.outputs[name] : undefined
    const part = name ? Object.values(spec.outputs).find((p) => p.part_of === name) : undefined
    const tun = o && isTunnelKind(o.kind) ? o : part
    return {
        over: tun?.over || o?.over || '',
        transport: tun?.transport || [],
        ipv6: o?.ipv6 || '',
        prefix: o?.prefix || '',
        pick: o?.pick === 'latency' ? 'latency' : 'order',
        tolerance: o?.tolerance,
        interval: o?.interval,
    }
}

/** Наложить настройки на собранный выход. `role`: `top` — сам выход (пул или единственный
 *  интерфейс), `tunnel` — туннель по подписке (одиночный или часть пула). Пустое не пишется. */
export function advApply(o: Output, adv: Adv, role: 'top' | 'tunnel'): Output {
    const out: Output = { ...o }
    if (role === 'tunnel' && isTunnelKind(o.kind)) {
        if (adv.over) out.over = adv.over
        else delete out.over
        if (o.kind === 'vless' && adv.transport.length) out.transport = adv.transport
        else delete out.transport
    }
    if (role === 'top' && o.kind === 'interface') {
        const pool = (o.devices?.length ?? 0) > 1
        if (pool) {
            out.pick = adv.pick
            if (adv.pick === 'latency') {
                if (adv.tolerance !== undefined) out.tolerance = adv.tolerance
                if (adv.interval !== undefined) out.interval = adv.interval
            }
        } else if (adv.ipv6) {
            out.ipv6 = adv.ipv6
            if (adv.ipv6 === 'routed' && adv.prefix.trim()) out.prefix = adv.prefix.trim()
        }
    }
    return out
}

export default function OutputAdvanced({ adv, onChange, spec, self, show, className }: {
    /** Классы карточки: место в сетке редактора. */
    className?: string
    adv: Adv
    onChange: (a: Adv) => void
    spec: Spec
    /** Имена самого выхода и его частей: их подложкой быть нельзя. */
    self: Set<string>
    show: {
        /** Среди выбранного есть туннель по подписке. */
        tunnel: boolean
        /** …и он VLESS (у hysteria2 фильтра транспорта нет). */
        vless: boolean
        /** Выход — одно устройство (не пул): к нему применим IPv6 от хоста. */
        iface: boolean
        /** Выход — пул из нескольких строк. */
        pool: boolean
    }
}) {
    if (!show.tunnel && !show.iface && !show.pool) return null
    const set = (p: Partial<Adv>) => onChange({ ...adv, ...p })
    const unders = Object.entries(spec.outputs)
        .filter(([n, o]) => !self.has(n) && !isPart(o) && o.kind !== 'direct' && o.kind !== 'zapret' && o.kind !== 'tgws')
        .map(([n]) => n)

    return (
        <Block className={className}>
            <CardHead title={S.outputAdvanced.dopolnitelno} />
            <div className="divide-y divide-border [&>*]:py-3 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
                {show.tunnel && (
                    <FieldRow label={S.outputAdvanced.tunnelIdetCherezVyhod}>
                        <select
                            value={adv.over}
                            onChange={(e) => set({ over: e.currentTarget.value })}
                            className={`${inputCls} w-full`}
                        >
                            <option value="">{S.outputAdvanced.napryamuyu}</option>
                            {unders.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </FieldRow>
                )}
                {show.tunnel && show.vless && (
                    <div className="space-y-2">
                        <div className="text-sm text-subtle">{S.outputAdvanced.transportUzlov}</div>
                        <div className="flex flex-wrap gap-2">
                            <Chip on={adv.transport.length === 0} onClick={() => set({ transport: [] })}>{S.outputAdvanced.lyuboy}</Chip>
                            {TRANSPORTS.map((t) => (
                                <Chip
                                    key={t}
                                    on={adv.transport.includes(t)}
                                    onClick={() =>
                                        set({ transport: adv.transport.includes(t) ? adv.transport.filter((x) => x !== t) : [...adv.transport, t] })
                                    }
                                >
                                    {t}
                                </Chip>
                            ))}
                        </div>
                    </div>
                )}
                {show.iface && (
                    <div className="space-y-1">
                        <div className="pb-1 text-sm text-subtle">{S.outputAdvanced.ipv6OtHosta}</div>
                        <Radio on={adv.ipv6 === ''} onClick={() => set({ ipv6: '' })}>{S.outputAdvanced.poUmolchaniyu}</Radio>
                        <Radio on={adv.ipv6 === 'routed'} onClick={() => set({ ipv6: 'routed' })}>{S.outputAdvanced.prefiksHosta}</Radio>
                        <Radio on={adv.ipv6 === 'nat'} onClick={() => set({ ipv6: 'nat' })}>{S.outputAdvanced.odinAdresHosta}</Radio>
                        <Radio on={adv.ipv6 === 'off'} onClick={() => set({ ipv6: 'off' })}>{S.outputAdvanced.nePropuskatIpv6}</Radio>
                        {adv.ipv6 === 'routed' && (
                            <div className="pt-2">
                                <Field label={S.outputAdvanced.prefiks}>
                                    <input
                                        value={adv.prefix}
                                        onChange={(e) => set({ prefix: e.currentTarget.value })}
                                        placeholder={S.outputAdvanced.n2001Db8156}
                                        className={`${inputCls} w-full font-mono`}
                                    />
                                </Field>
                            </div>
                        )}
                    </div>
                )}
                {show.pool && (
                    <div className="space-y-2">
                        <div className="text-sm text-subtle">{S.outputAdvanced.kakVybiratIzSpiska}</div>
                        <Segmented<Adv['pick']>
                            label={S.outputAdvanced.kakVybiratIzSpiska}
                            items={[
                                { value: 'order', label: S.outputAdvanced.pervyyZhivoy },
                                { value: 'latency', label: S.outputAdvanced.samyyBystryy },
                            ]}
                            value={adv.pick}
                            onChange={(v) => set({ pick: v })}
                        />
                        {adv.pick === 'latency' && (
                            <div className="grid gap-3 pt-2 sm:grid-cols-2">
                                <NumField label={S.outputAdvanced.dopuskMs} value={adv.tolerance} onChange={(v) => set({ tolerance: v })} placeholder="50" min={0} max={60000} />
                                <NumField label={S.outputAdvanced.zamerRazVS} value={adv.interval} onChange={(v) => set({ interval: v })} placeholder="180" min={5} max={86400} />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </Block>
    )
}

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Block, CardHead, DangerButton, FieldRow, ScreenHeader, ToggleRow } from '@/components/ui/layout'
import { Chip, Field, NumField, Radio, inputCls } from '@/components/formbits'
import { balanceBySupported } from '@/lib/engine'
import { notify } from '@/lib/notify'
import { rpc } from '@/lib/rpc'
import { ON_FAIL_TEXT, isPart, type BalanceBy, type GroupPick, type OnFail, type Output, type Spec } from '@/lib/model'
import { type Live } from '@/lib/live'

import { S } from '@/copy'
/** Группа выходов: несколько выходов под одним именем, из которых движок выбирает один.
 *
 *  Правило ведёт в группу так же, как в любой выход; какой член несёт трафик, решает способ
 *  выбора. Четыре способа движка (спека v2, `pick`): первый живой по порядку, самый быстрый с
 *  допуском, выбор человека и раздача новых соединений по весам.
 *
 *  Пул из устройств и подписок (`PoolEditor`) — частный случай «первый живой» со своими
 *  служебными членами; здесь члены — обычные выходы списка и другие группы.
 *
 *  Bode 26.10, раскладка по образцу приложения Splify2 — та же, что у редактора выхода: шапка
 *  «← имя · Сохранить группу», карточки с заголовками (имя, как выбирать, члены), выбранные
 *  члены — строками одной карточки через волосяную линию, удаление — обведённой красной
 *  кнопкой внизу. Способ выбора остаётся радиосписком: у каждого из четырёх вариантов есть
 *  строка-следствие под названием, и в сегменты она не помещается. «Если все члены упали» —
 *  строкой «подпись — список» в карточке имени, как «если всё упало» у выхода в приложении:
 *  сегментами «остановить трафик» на телефоне обрезалось. */

const NAME_RE = /^[A-Za-z0-9_-]{1,24}$/

const PICK_TEXT: Record<GroupPick, { title: string; hint: string }> = {
    order: { title: S.groupEditor.pervyyZhivoy, hint: S.groupEditor.poPoryadkuVernetsyaNa },
    latency: { title: S.groupEditor.samyyBystryy, hint: S.groupEditor.poZameruZaderzhki },
    manual: { title: S.groupEditor.vyborVruchnuyu, hint: S.groupEditor.chlenVybiraeteVyBez },
    balance: { title: S.groupEditor.porovnuPoVesam, hint: S.groupEditor.novyeSoedineniyaRazdayutsyaPo },
}

/** Режим раздачи у «поровну по весам» (`by`): каждое соединение случайно, сайт на одном выходе,
 *  сайт у одного устройства на одном выходе. */
const BY_TEXT: Record<BalanceBy, string> = {
    connection: S.groupEditor.byConnection,
    site: S.groupEditor.bySite,
    site_client: S.groupEditor.bySiteClient,
}

/** Группы, в которых `name` лежит членом (прямо или через вложенные): такую группу в члены
 *  не берём — получился бы круг, и движок такую спеку отвергает. */
function contains(spec: Spec, group: string, target: string, seen = new Set<string>()): boolean {
    if (seen.has(group)) return false
    seen.add(group)
    const g = spec.outputs[group]
    if (!g || g.kind !== 'group') return false
    return (g.members || []).some((m) => m === target || contains(spec, m, target, seen))
}

export default function GroupEditor({ spec, name, live, onSave, onCancel }: {
    spec: Spec
    /** Имя правимой группы; пусто — заводим новую. */
    name?: string
    live?: Live
    onSave: (next: Spec) => void
    onCancel: () => void
}) {
    const existing = name ? spec.outputs[name] : undefined
    const [title, setTitle] = useState(name || '')
    const [pick, setPick] = useState<GroupPick>(existing?.pick || 'order')
    const [members, setMembers] = useState<string[]>(existing?.members || [])
    const [def, setDef] = useState(existing?.default || '')
    const [tolerance, setTolerance] = useState<number | undefined>(existing?.tolerance)
    const [interval, setInterval] = useState<number | undefined>(existing?.interval)
    const [url, setUrl] = useState(existing?.url || '')
    /** Пауза замера без трафика (`idle_timeout`, только у «самого быстрого»). */
    const [idle, setIdle] = useState<number | undefined>(existing?.idle_timeout)
    /** Группа IPv6 не несёт (`ipv6: off`) — единственное значение ключа у группы: routed и nat
     *  задаются у члена. */
    const [noV6, setNoV6] = useState(existing?.ipv6 === 'off')
    const [weights, setWeights] = useState<number[]>(existing?.weights || [])
    const [by, setBy] = useState<BalanceBy>(existing?.by || 'connection')
    const [onFail, setOnFail] = useState<OnFail>(existing?.on_fail === 'direct' ? 'direct' : 'drop')
    const st = name ? live?.status?.outputs?.[name] : undefined
    /* Режим раздачи — когда ядро его умеет; уже записанный в спеку показывается и без умения. */
    const canBy = balanceBySupported(live?.status) || (!!existing?.by && existing.by !== 'connection')

    /* Кого можно взять: выходы с устройством и другие группы. `direct` устройства не имеет,
     * служебные части пулов человеку не показываются. */
    const candidates = useMemo(
        () =>
            Object.entries(spec.outputs)
                .filter(([n, o]) => n !== name && !isPart(o) && o.kind !== 'direct' && o.kind !== 'zapret' && o.kind !== 'tgws')
                .filter(([n]) => !name || !contains(spec, n, name))
                .map(([n]) => n),
        [spec, name],
    )

    function toggle(n: string) {
        setMembers((m) => {
            const i = m.indexOf(n)
            if (i >= 0) {
                setWeights((w) => w.filter((_, k) => k !== i))
                return m.filter((x) => x !== n)
            }
            setWeights((w) => [...w, 1])
            return [...m, n]
        })
    }
    function move(i: number, j: number) {
        if (j < 0 || j >= members.length) return
        const m = members.slice()
        const w = members.map((_, k) => weights[k] ?? 1)
        ;[m[i], m[j]] = [m[j], m[i]]
        ;[w[i], w[j]] = [w[j], w[i]]
        setMembers(m)
        setWeights(w)
    }

    function save() {
        const n = title.trim()
        if (!NAME_RE.test(n)) { notify(S.groupEditor.imyaLatinitsaTsifryDefis, 'warning'); return }
        if (n !== name && spec.outputs[n]) { notify(S.groupEditor.vyhodUzheEst(n), 'warning'); return }
        if (!members.length) { notify(S.groupEditor.vyberiteHotyaByOdin, 'warning'); return }
        const g: Output = { name: n, kind: 'group', pick, members, on_fail: onFail }
        if (pick === 'manual' && def && members.includes(def)) g.default = def
        if (pick === 'latency') {
            if (tolerance !== undefined) g.tolerance = tolerance
            if (interval !== undefined) g.interval = interval
            if (url.trim()) g.url = url.trim()
            if (idle !== undefined) g.idle_timeout = idle
        }
        if (noV6) g.ipv6 = 'off'
        if (pick === 'balance') g.weights = members.map((_, k) => weights[k] ?? 1)
        if (pick === 'balance' && by !== 'connection') g.by = by
        if (existing?.extra) g.extra = existing.extra
        /* Переименование уводит за собой правила и членство в других группах. */
        const outputs: Record<string, Output> = {}
        for (const [k, v] of Object.entries(spec.outputs)) {
            if (k === name) continue
            outputs[k] = name && n !== name && v.kind === 'group'
                ? { ...v, members: (v.members || []).map((m) => (m === name ? n : m)) }
                : v
        }
        outputs[n] = g
        const channels = name && n !== name ? spec.channels.map((c) => (c.out === name ? { ...c, out: n } : c)) : spec.channels
        onSave({ ...spec, outputs, channels })
    }

    function remove() {
        if (!name) return
        const used = spec.channels.filter((c) => c.out === name).map((c) => c.name)
        if (used.length) { notify(S.groupEditor.vyhodZanyatPravilami(name, used.join(', ')), 'warning'); return }
        const holders = Object.entries(spec.outputs).filter(([, o]) => o.kind === 'group' && o.members?.includes(name)).map(([k]) => k)
        if (holders.length) { notify(S.groupEditor.vyhodVhoditVGruppy(name, holders.join(', ')), 'warning'); return }
        const outputs = { ...spec.outputs }
        delete outputs[name]
        onSave({ ...spec, outputs })
    }

    async function choose(member: string) {
        if (!name) return
        try {
            const r = await rpc.groupSelect(name, member)
            if (!r.ok) throw new Error(r.error || S.groupEditor.nePoluchilos)
            notify(S.groupEditor.vybran(member))
            live?.refresh()
        } catch (e) {
            notify(String(e instanceof Error ? e.message : e), 'error')
        }
    }

    const g = st?.group

    return (
        <div className="space-y-4">
            <ScreenHeader
                title={name || S.groupEditor.dobavitGruppu}
                back={onCancel}
                backLabel={S.groupEditor.otmena}
                right={
                    <Button onClick={save}>
                        <Check className="h-4 w-4" aria-hidden="true" /> {S.groupEditor.sohranitGruppu}</Button>
                }
            />

            <div className="grid gap-4 xl:grid-cols-2">
                <div className="min-w-0 space-y-4">
                <Block>
                    <Field label={S.groupEditor.imyaGruppy}>
                        <input
                            value={title}
                            onChange={(e) => setTitle(e.currentTarget.value)}
                            placeholder={S.groupEditor.imyaGruppy}
                            aria-label={S.groupEditor.imyaGruppy}
                            className={`${inputCls} w-full`}
                        />
                    </Field>
                    <div className="border-t border-border pt-1">
                        <FieldRow label={S.groupEditor.esliVseChlenyUpali}>
                            <select
                                value={onFail}
                                onChange={(e) => setOnFail(e.currentTarget.value as OnFail)}
                                className={`${inputCls} w-full`}
                            >
                                {(['drop', 'direct'] as OnFail[]).map((v) => (
                                    <option key={v} value={v}>{ON_FAIL_TEXT[v]}</option>
                                ))}
                            </select>
                        </FieldRow>
                        <ToggleRow label={S.groupEditor.nePropuskatIpv6} on={noV6} onToggle={() => setNoV6((v) => !v)} />
                    </div>
                </Block>
                <Block>
                    <CardHead title={S.groupEditor.kakVybirat} />
                    <div className="divide-y divide-border">
                        {(Object.keys(PICK_TEXT) as GroupPick[]).map((p) => (
                            <div key={p} className="py-1">
                                <Radio on={pick === p} onClick={() => setPick(p)}>
                                    <span className="font-medium">{PICK_TEXT[p].title}</span>
                                    <span className="block text-xs text-muted-foreground">{PICK_TEXT[p].hint}</span>
                                </Radio>
                            </div>
                        ))}
                    </div>
                {pick === 'latency' && (
                            <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
                                <NumField label={S.groupEditor.dopuskMs} value={tolerance} onChange={setTolerance} placeholder="50" min={0} max={60000} />
                                <NumField label={S.groupEditor.zamerRazVS} value={interval} onChange={setInterval} placeholder="180" min={5} max={86400} />
                                <NumField label={S.groupEditor.neMeritBezTrafika} value={idle} onChange={setIdle} placeholder={S.groupEditor.n0MeritVsegda} min={0} max={86400} />
                                <div className="sm:col-span-2">
                                    <Field label={S.groupEditor.adresProverki}>
                                        <input
                                            value={url}
                                            onChange={(e) => setUrl(e.currentTarget.value)}
                                            placeholder="http://cp.cloudflare.com/generate_204"
                                            className={`${inputCls} w-full`}
                                        />
                                    </Field>
                                </div>
                            </div>
                        )}
                {pick === 'balance' && canBy && (
                            <div className="border-t border-border pt-1">
                                <p className="px-2.5 pt-2 text-xs text-muted-foreground">{S.groupEditor.razdacha}</p>
                                {(Object.keys(BY_TEXT) as BalanceBy[]).map((b) => (
                                    <Radio key={b} on={by === b} onClick={() => setBy(b)}>{BY_TEXT[b]}</Radio>
                                ))}
                            </div>
                        )}
                </Block>
                </div>

                <div className="min-w-0 space-y-4">
                <Block>
                    <CardHead title={S.groupEditor.chleny} meta={members.length || undefined} />
                        {candidates.length === 0 && (
                            <p className="text-sm text-muted-foreground">{S.groupEditor.drugihVyhodovPokaNet}</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                            {candidates.map((n) => (
                                <Chip key={n} on={members.includes(n)} onClick={() => toggle(n)}>{n}</Chip>
                            ))}
                        </div>
                        {members.length > 0 && (
                            /* Выбранные члены — строками через волосяную линию, как узлы выхода
                               в приложении; порядок — номером слева. */
                            <ol className="divide-y divide-border border-t border-border">
                                {members.map((m, i) => (
                                    <li key={m} className="flex min-h-[44px] items-center gap-2 py-1.5 text-sm">
                                        <span className="w-5 shrink-0 text-xs text-muted-foreground">{i + 1}</span>
                                        <span className="min-w-0 flex-1 truncate font-medium">{m}</span>
                                        {g && (
                                            <span className="shrink-0 text-xs text-muted-foreground">
                                                {g.selected === m ? S.groupEditor.nesetTrafik : g.alive.includes(m) ? S.groupEditor.zhiv : S.groupEditor.neOtvechaet}
                                                {g.latency?.[m] !== undefined ? S.groupEditor.ms(g.latency[m]) : ''}
                                            </span>
                                        )}
                                        {pick === 'balance' && (
                                            <input
                                                type="number"
                                                min={1}
                                                max={100}
                                                value={weights[i] ?? 1}
                                                aria-label={S.groupEditor.ves(m)}
                                                onChange={(e) => {
                                                    const v = Math.max(1, Math.min(100, Number(e.currentTarget.value) || 1))
                                                    setWeights((w) => members.map((_, k) => (k === i ? v : (w[k] ?? 1))))
                                                }}
                                                className={`${inputCls} h-8 w-16`}
                                            />
                                        )}
                                        {pick === 'manual' && (
                                            <span className="flex shrink-0 gap-1">
                                                <Chip on={def === m || (!def && i === 0)} onClick={() => setDef(m)}>{S.groupEditor.poUmolchaniyu}</Chip>
                                                {name && g && (
                                                    <Button size="sm" variant="secondary" onClick={() => void choose(m)}>{S.groupEditor.vybrat}</Button>
                                                )}
                                            </span>
                                        )}
                                        <button type="button" aria-label={S.groupEditor.vyshe} onClick={() => move(i, i - 1)} disabled={i === 0}
                                            className="sp-row bg-transparent p-0 text-muted-foreground disabled:opacity-30">
                                            <ArrowUp className="h-4 w-4" />
                                        </button>
                                        <button type="button" aria-label={S.groupEditor.nizhe} onClick={() => move(i, i + 1)} disabled={i === members.length - 1}
                                            className="sp-row bg-transparent p-0 text-muted-foreground disabled:opacity-30">
                                            <ArrowDown className="h-4 w-4" />
                                        </button>
                                    </li>
                                ))}
                            </ol>
                        )}
                        {pick === 'manual' && g?.select && (
                            <p className="text-xs text-muted-foreground">{S.groupEditor.vybran2}{g.select}</p>
                        )}
                </Block>
                {name && (
                    <DangerButton full onClick={remove}>
                        <Trash2 aria-hidden="true" /> {S.groupEditor.udalit}</DangerButton>
                )}
                </div>
            </div>
        </div>
    )
}

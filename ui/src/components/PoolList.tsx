import { useEffect, useState } from 'react'
import { ArrowRight, Globe, Layers, Plus, ShieldCheck, Waves } from 'lucide-react'
import GroupEditor from '@/components/GroupEditor'
import { Button } from '@/components/ui/button'
import { CardHead, Empty, Group, TapRow } from '@/components/ui/layout'
import PoolEditor from '@/components/PoolEditor'
import { rpc } from '@/lib/rpc'
import { missingModule } from '@/lib/engine'
import { pending } from '@/lib/pending'
import { country } from '@/lib/geo'
import { devList, EMPTY_SPEC, isPart, type Spec } from '@/lib/model'
import { subsRemember, subsRemembered, type SubRow } from '@/lib/subs'
import { type Live } from '@/lib/live'

import { S } from '@/copy'
/** Выходы: во что правила ведут трафик.
 *
 *  Строка выхода читается как в дизайн-паке — «имя · через что идёт сейчас», а под ней состав
 *  и запас. Прежний вид (спойлер на каждый выход со своей настройкой внутри) отвечал на другой
 *  вопрос: он показывал, КАК выход устроен, тогда как со списка спрашивают, КУДА он ведёт и
 *  работает ли. Настройка открывается по нажатию, целым экраном.
 *
 *  Bode 26.10: выходы — строками ОДНОЙ карточки через волосяную линию, с заголовком «Выходы» и
 *  счётчиком справа, как карточки приложения Splify2. Кнопки добавления — под карточкой, во всю
 *  её ширину: это основное действие экрана, и в приложении оно стоит там же, внизу перечня.
 *  Наверху справа они стояли мелкими и читались как фильтр списка. */

/** Метка в состоянии «что правим»: редактор группы, а не пула. Имя выхода латиницей без
 *  двоеточия, так что столкнуться с настоящим именем она не может. */
const GROUP_PREFIX = 'group:'

const GROUP_PICK: Record<string, string> = {
    order: S.poolList.pervyyZhivoy,
    latency: S.poolList.samyyBystryy,
    manual: S.poolList.vyborVruchnuyu,
    balance: S.poolList.poVesam,
}

export default function PoolList({
    live, onEditingChange,
}: {
    live: Live
    /** Открылся или закрылся редактор выхода. Раздел выше по этому признаку убирает свои
     *  подпункты: редактор — целый экран, и три строки-входа над ним читались как часть
     *  формы, которой они не являются. */
    onEditingChange?: (on: boolean) => void
}) {
    const [spec, setSpec] = useState<Spec | null>(null)
    /** Что правим: имя выхода, пустая строка — новый, null — список. */
    const [editing, setEditingRaw] = useState<string | null>(null)
    const setEditing = (v: string | null) => {
        setEditingRaw(v)
        onEditingChange?.(v !== null)
    }
    const [geo, setGeo] = useState<Record<string, { cc?: string; ms?: number }>>({})
    /* Подписки — чтобы часть пула называлась именем подписки, а не «подписка»: строка
     * «подписка → подписка» не говорила, какая из двух идёт первой. */
    const [subs, setSubs] = useState<SubRow[]>(() => subsRemembered() ?? [])
    useEffect(() => {
        rpc.subList()
            .then((r) => { setSubs(r.subs || []); subsRemember(r.subs) })
            .catch(() => {})
    }, [])
    const subTitle = (path?: string) => {
        const s = subs.find((x) => x.path === path)
        return s?.title || s?.name || S.poolList.podpiska
    }

    useEffect(() => {
        pending.load().then(setSpec).catch(() => setSpec(EMPTY_SPEC))
    }, [])

    const names = Object.keys(live.status?.outputs || {}).join(',')
    useEffect(() => {
        if (!names) return
        let stop = false
        /* Запомненное измерение: страна и время ответа приезжают ОДНИМ вызовом через
         * устройство выхода, и без обращения наружу — бэкенд отдаёт то, что помнит. */
        for (const n of names.split(',')) {
            rpc.outboundGeo(n, false)
                .then((g) => {
                    if (stop || (!g.cc && !g.ms)) return
                    setGeo((s) => ({ ...s, [n]: { cc: g.cc, ms: g.ms } }))
                })
                .catch(() => {})
        }
        return () => { stop = true }
    }, [names])

    function edit(next: Spec) {
        setSpec(next)
        pending.edit(next)
    }

    if (!spec) return <div className="p-5 text-sm text-muted-foreground">{S.poolList.zagruzka}</div>

    if (editing !== null && editing.startsWith(GROUP_PREFIX)) {
        return (
            <GroupEditor
                spec={spec}
                name={editing.slice(GROUP_PREFIX.length) || undefined}
                live={live}
                onCancel={() => setEditing(null)}
                onSave={(next) => {
                    edit(next)
                    setEditing(null)
                }}
            />
        )
    }

    if (editing !== null) {
        return (
            <PoolEditor
                spec={spec}
                name={editing || undefined}
                live={live}
                onCancel={() => setEditing(null)}
                onSave={(next) => {
                    edit(next)
                    setEditing(null)
                }}
            />
        )
    }

    /* Служебные части пулов — не выходы для человека: их локации показаны строками внутри
     * своего пула (см. Output.part_of). Постоянный `direct` — тоже не строка этого списка:
     * настраивать в нём нечего, а «Выходы» отвечают на вопрос «чем роутер выходит наружу»,
     * тогда как direct — это отсутствие туннеля. Целью правила он при этом остаётся всегда,
     * и виден там, где выбирают: в редакторе правила (см. model.ts, withDirect). */
    const rows = Object.entries(spec.outputs).filter(([, o]) => !isPart(o) && o.kind !== 'direct')

    /* Кнопки добавления — одни на оба состояния: пустой перечень прежде показывал свою
     * «Добавить выход» в карточке и вторую такую же над ней. */
    const adds = (
        <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="secondary" className="h-10 w-full" onClick={() => setEditing(GROUP_PREFIX)}>
                <Layers className="h-4 w-4" aria-hidden="true" /> {S.poolList.dobavitGruppu}</Button>
            <Button className="h-10 w-full" onClick={() => setEditing('')}>
                <Plus className="h-4 w-4" aria-hidden="true" /> {S.poolList.dobavitVyhod}</Button>
        </div>
    )

    return (
        <div className="space-y-3">
            {rows.length === 0 ? (
                <Group head={<CardHead title={S.poolList.vyhody} />}>
                    <Empty
                        icon={Globe}
                        text={
                            <>
                                <span className="block font-medium text-foreground">{S.poolList.vyhodovNet}</span>
                                <span className="mt-1 block text-xs">
                                    {S.poolList.dobavteVyhodSvoyTunnel}</span>
                            </>
                        }
                    />
                </Group>
            ) : (
                <Group head={<CardHead title={S.poolList.vyhody} meta={rows.length} />}>
                    {rows.map(([name, o]) => {
                        const st = live.status?.outputs?.[name]
                        const g = geo[name]
                        const devs = devList(o)
                        const rules = spec.channels.filter((c) => c.out === name).length
                        /* Строка отвечает на «куда ведёт и работает ли»: где выходит сейчас,
                         * из чего собран, сколько правил на нём висит. */
                        const need = missingModule(o, live.build?.modules)
                        const state =
                            need
                                ? S.poolList.nuzhenPaketSteer(need)
                                : o.kind === 'direct'
                                ? S.poolList.napryamuyuMimoTunnelya
                                : o.kind === 'zapret'
                                  /* У этого выхода нет ни устройства, ни страны: трафик
                                     уходит обычным маршрутом, меняется только то, что с ним
                                     по дороге сделает обход. Показывать ему «устройство не
                                     выбрано» значило бы обещать устройство. */
                                  ? [S.poolList.obhodDpi, rules ? S.poolList.pravil(rules) : '']
                                        .filter(Boolean)
                                        .join(' · ')
                                  : o.kind === 'group'
                                    /* Группа: способ выбора, кто несёт трафик сейчас и из
                                       кого она собрана. */
                                    ? [
                                        GROUP_PICK[o.pick || 'order'],
                                        st?.group?.selected ? S.poolList.seychas(st.group.selected) : st?.group ? S.poolList.chlenyNeOtvechayut : '',
                                        S.poolList.chlenov(o.members?.length ?? 0),
                                        rules ? S.poolList.pravil(rules) : '',
                                      ]
                                          .filter(Boolean)
                                          .join(' · ')
                                  : [
                                      country(g?.cc),
                                      o.kind === 'vless' || o.kind === 'hysteria2'
                                          ? S.poolList.podpiska
                                          : devs
                                                /* Устройство служебной части называется
                                                   подпиской, которой оно принадлежит: имя
                                                   вида «vpn-1» человеку ни о чём не говорит. */
                                                .map((d) => {
                                                    const p = spec.outputs[d]
                                                    return p && isPart(p) ? subTitle(p.sub_file) : d
                                                })
                                                .join(' → ') || S.poolList.ustroystvoNeVybrano,
                                      g?.ms ? S.poolList.ms(g.ms) : '',
                                      rules ? S.poolList.pravil(rules) : '',
                                  ]
                                      .filter(Boolean)
                                      .join(' · ')
                        return (
                            <TapRow
                                key={name}
                                icon={
                                    o.kind === 'direct'
                                        ? ArrowRight
                                        : o.kind === 'vless' || o.kind === 'hysteria2'
                                          ? Globe
                                          : o.kind === 'group'
                                            ? Layers
                                            : o.kind === 'zapret'
                                              ? Waves
                                              : ShieldCheck
                                }
                                title={name}
                                subtitle={state}
                                alarm={!!need || (o.kind !== 'direct' && st?.up === false)}
                                onClick={() => setEditing(o.kind === 'group' ? `${GROUP_PREFIX}${name}` : name)}
                            />
                        )
                    })}
                </Group>
            )}
            {adds}
        </div>
    )
}

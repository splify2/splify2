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
    order: 'первый живой',
    latency: 'самый быстрый',
    manual: 'выбор вручную',
    balance: 'по весам',
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
        return s?.title || s?.name || 'подписка'
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

    if (!spec) return <div className="p-5 text-sm text-muted-foreground">Загрузка…</div>

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
                <Layers className="h-4 w-4" aria-hidden="true" /> Добавить группу
            </Button>
            <Button className="h-10 w-full" onClick={() => setEditing('')}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Добавить выход
            </Button>
        </div>
    )

    return (
        <div className="space-y-3">
            {rows.length === 0 ? (
                <Group head={<CardHead title="Выходы" />}>
                    <Empty
                        icon={Globe}
                        text={
                            <>
                                <span className="block font-medium text-foreground">Выходов нет</span>
                                <span className="mt-1 block text-xs">
                                    Добавьте выход (свой туннель или подписку), чтобы правила могли направлять через него трафик.
                                </span>
                            </>
                        }
                    />
                </Group>
            ) : (
                <Group head={<CardHead title="Выходы" meta={rows.length} />}>
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
                                ? `нужен пакет steer-${need}`
                                : o.kind === 'direct'
                                ? 'напрямую, мимо туннеля'
                                : o.kind === 'zapret'
                                  /* У этого выхода нет ни устройства, ни страны: трафик
                                     уходит обычным маршрутом, меняется только то, что с ним
                                     по дороге сделает обход. Показывать ему «устройство не
                                     выбрано» значило бы обещать устройство. */
                                  ? ['обход DPI', rules ? `правил: ${rules}` : '']
                                        .filter(Boolean)
                                        .join(' · ')
                                  : o.kind === 'group'
                                    /* Группа: способ выбора, кто несёт трафик сейчас и из
                                       кого она собрана. */
                                    ? [
                                        GROUP_PICK[o.pick || 'order'],
                                        st?.group?.selected ? `сейчас: ${st.group.selected}` : st?.group ? 'члены не отвечают' : '',
                                        `членов: ${o.members?.length ?? 0}`,
                                        rules ? `правил: ${rules}` : '',
                                      ]
                                          .filter(Boolean)
                                          .join(' · ')
                                  : [
                                      country(g?.cc),
                                      o.kind === 'vless' || o.kind === 'hysteria2'
                                          ? 'подписка'
                                          : devs
                                                /* Устройство служебной части называется
                                                   подпиской, которой оно принадлежит: имя
                                                   вида «vpn-1» человеку ни о чём не говорит. */
                                                .map((d) => {
                                                    const p = spec.outputs[d]
                                                    return p && isPart(p) ? subTitle(p.sub_file) : d
                                                })
                                                .join(' → ') || 'устройство не выбрано',
                                      g?.ms ? `${g.ms} мс` : '',
                                      rules ? `правил: ${rules}` : '',
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

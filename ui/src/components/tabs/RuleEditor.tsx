import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Block, CardHead, FieldRow, ScreenHeader, Segmented } from '@/components/ui/layout'
import { rpc } from '@/lib/rpc'
import { isClientAddr } from '@/lib/validate'
import { usePending } from '@/lib/pending'
import { type Channel, type Narrow, type OutputStatus, type ServiceEntry, type Upstream, devList, isPart, isTunnelKind } from '@/lib/model'

/** Редактор правила — на месте таблицы, а не в модальном окне.
 *
 *  Модальное окно здесь мешало бы ровно тому, зачем правило открывают: чтобы сравнить его с
 *  соседними. Окно закрывает список, и «чем это правило отличается от того» приходится держать
 *  в голове.
 *
 *  Три блока повторяют строку таблицы: что перенаправляем, кого касается, куда. Галочки
 *  каталога живут ЗДЕСЬ и только здесь — прежде маршрут назначался в двух местах, и два места
 *  спорили об одном и том же. */

/** MAC ровно в том виде, в каком его понимает nft: шесть пар шестнадцатеричных цифр через
 *  двоеточие. Своя проверка, а не из `lib/validate.ts`, потому что MAC-адрес нигде больше в
 *  формах не набирают. Двоеточие есть и у IPv6, поэтому запись годна, если она MAC ЛИБО адрес
 *  (`isClientAddr`): `aa:bb:cc` не проходит ни то, ни другое. */
const MAC = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i

/** Значение пункта «свой адрес» в выборе сервера DNS правила: имя апстрима так не назовёшь
 *  (имена — буквы, цифры, `_ - .`), и с выбранным по имени он не спутается. */
const OWN_DNS = ' own'

export { pathFor, srsPathFor, ruleFiles, onRouter, srsOf, selectedIds, isDomains } from '@/lib/rulefiles'
import { pathFor, srsPathFor, ruleFiles, onRouter, srsProbe, mayNarrow, selectedIds, isDomains, serviceFiles, overridePortOf, withOverridePort } from '@/lib/rulefiles'


import { S } from '@/copy'
interface Props {
    ch: Channel
    index: number
    services: ServiceEntry[]
    local: Record<string, { count: number; mtime: number }>
    outputs: Record<string, OutputStatus>
    /** Пересечения с другими правилами — текстом, потому что решение принимает ПОРЯДОК, и
     *  прятать это нельзя: адрес достанется тому правилу, что выше. */
    clash: string | null
    /** Сколько всего правил — чтобы «Правило 3» читалось как место в очереди, а не как
     *  номер. Порядок здесь и есть приоритет, и в редакторе он был не виден вовсе. */
    rulesTotal: number
    /** Имена туннельных правил ВЫШЕ этого, забирающих те же записи. Пусто, если правило
     *  ведёт в туннель: перекрытие важно именно для исключения — оно молча не срабатывает,
     *  и выглядит это как «исключения не работают», а не как «правило стоит не там». */
    coveredBy: string[]
    onChange: (ch: Channel) => void
    onClose: () => void
    onDelete: () => void
}

export default function RuleEditor({
    ch, index, services, local, outputs, clash, rulesTotal, coveredBy, onChange, onClose, onDelete,
}: Props) {
    const [q, setQ] = useState('')
    /** Наборы каталога, о которых сейчас спрашиваем роутер (pick → srsOf). */
    const [probing, setProbing] = useState<ReadonlySet<string>>(() => new Set())
    /** Правило на момент ответа сети: list_fetch отвечает секунды, и дописывать сужение
     *  надо к тому, что человек успел наредактировать, а не к снимку на момент щелчка. */
    const latest = useRef(ch)
    latest.current = ch
    /** Аренды DHCP — чтобы устройства выбирали по имени, а не набирали MAC руками. Опечатка в
     *  MAC не совпадёт ни с чем и не пожалуется: правило просто не будет действовать. */
    const [leases, setLeases] = useState<{ mac: string; ip: string; name: string }[]>([])
    /** Туннельные устройства роутера. Правило ведёт в ВЫХОД, а не в устройство, — но
     *  человек ищет здесь именно устройство (splify2#12), и молчать про поднятый туннель,
     *  которого нет ни в одном выходе, значит подтверждать вывод «второй туннель не
     *  поддерживается». */
    const [devices, setDevices] = useState<{ name: string; up: boolean; kind: string }[]>([])
    useEffect(() => {
        rpc.leases().then((r) => setLeases(r.leases || [])).catch(() => setLeases([]))
        rpc.devices().then((d) => setDevices(d.devices || [])).catch(() => setDevices([]))
    }, [])
    const chosen = selectedIds(ch, services)
    const chosenEntries = services.filter((sv) => chosen.includes(sv.id))
    const outNames = Object.keys(outputs)
    /* Серверы DNS из раздела «DNS»: правило может выбрать свой вместо общего. */
    const { spec: fullSpec } = usePending()
    const upstreamNames = Object.keys(fullSpec?.dns?.upstreams || {})
    /** Свой сервер прямо в правиле (`dns: { url, out, ips }` спеки v2): адрес и выход — тем же
     *  набором, что у сервера раздела «DNS». Выходы — с устройством, через которые ядро умеет
     *  направить запрос (как в разделе «DNS»). */
    const ownDns: Upstream | undefined = ch.dns && typeof ch.dns !== 'string' ? ch.dns : undefined
    const dnsOuts = Object.entries(fullSpec?.outputs || {})
        .filter(([, o]) => !isPart(o) && o.kind !== 'direct' && o.kind !== 'zapret' && o.kind !== 'tgws' && o.kind !== 'group')
        .map(([n]) => n)
    const setOwnDns = (u: Upstream) => onChange({ ...ch, dns: u })
    const hasDomains = isDomains(ch)
    /** Подмена порта у доменов правила (`override_port`, см. lib/rulefiles.ts). Ядро делает её
     *  по карте fake-IP, поэтому поле есть только в этом режиме — с учётом общего режима DNS,
     *  если у правила своего нет. */
    const port = overridePortOf(ch)
    const fakeip = (ch.match.mode ?? fullSpec?.dns?.mode ?? 'fakeip') === 'fakeip'
    /** Правило-исключение — это канал в выход `direct`, стоящий выше туннельных. Отдельной
     *  сущности в движке нет и не нужно: метку раздаёт первое совпадение, поэтому верхнее
     *  правило забирает сервис себе и оставляет его на обычном пути. */
    const isException = outputs[ch.out]?.kind === 'direct'

    /** Туннели, которые не ведёт ни один выход.
     *
     *  Показываем ТОЛЬКО когда туннельный выход ровно один — из двух вариантов снятия риска
     *  (кнопка «не показывать» или условие) выбран второй: гасить подсказку значит хранить
     *  ещё одно состояние и уметь его вернуть, а «выход один» описывает ровно ту ситуацию,
     *  где подсказка полезна. Один выход — человек ещё не заводил второго ни разу, и
     *  свободный туннель почти наверняка тот, который он ищет в этом списке. Когда выходов
     *  два и больше, заводить их он умеет, и свободное устройство — скорее осознанный запас
     *  под другую задачу; постоянная метка про него учила бы не смотреть на метки.
     *  `up` обязателен: опущенный интерфейс — не свидетельство намерения. */
    const tunnelOuts = outNames.filter((n) => outputs[n].kind !== 'direct')
    const busy = new Set(outNames.flatMap((n) => devList(outputs[n])))
    const orphans = tunnelOuts.length === 1 ? devices.filter((d) => d.up && !busy.has(d.name)) : []

    /** Включить или выключить сервис — сразу всеми его частями.
     *
     *  Раньше здесь переключался ВИД списка, и включение доменной записи сбрасывало адресную:
     *  движок отвергал правило с обоими видами. Теперь принимает — набор один, адреса из файла
     *  лежат в нём постоянно, домены кладёт резолвер с TTL. Поэтому и выбор стал про сервис. */
    function pick(sv: ServiceEntry) {
        const on = chosen.includes(sv.id)
        /* Набор каталога: списками или файлом — узнаём до того, как правило уедет на роутер
         * (см. srsOf). Ответ приходит через секунды, ставим его в правило, каким оно стало. */
        if (!on && sv.srs) {
            if (probing.has(sv.id)) return
            setProbing((b) => new Set(b).add(sv.id))
            void srsProbe(sv, local).then((r) => {
                setProbing((b) => { const n = new Set(b); n.delete(sv.id); return n })
                put(latest.current, sv, false, r.set, r.asked ? { narrow: r.narrow } : undefined)
            })
            return
        }
        put(ch, sv, on)
    }

    /** Поставить (`on` — снять) сервис в правило `ch`: списками или, если задан `set`, файлом
     *  набора. Снимается сервис в обоих видах — каким бы его ни поставили. `known` — роутер уже
     *  ответил про сужение подсетей (srsProbe): `narrow` пусто — подсети не сужены. */
    function put(ch: Channel, entry: ServiceEntry, on: boolean, set?: string, known?: { narrow?: Narrow }) {
        const pref = new Set(ch.match.prefixes_files || [])
        const doms = new Set(ch.match.domains_files || [])
        const srs = new Set(ch.match.srs_files || [])
        if (on) for (const f of [...entry.prefixes, ...entry.domains]) srs.delete(srsPathFor(f))
        else if (set) srs.add(set)
        const sv = set ? { ...entry, prefixes: [], domains: [] } : entry
        /* Сужение подсетей (Discord: только udp и его порты) — вместе с файлами: снимаем
         * сервис — снимаем и его; ставим — берём известное у каталога, а неизвестное
         * спрашиваем у list_fetch ниже. Без сужения подсети Cloudflare уехали бы в туннель
         * целиком (steer, srs.c). В спеку это уходит каналом-спутником, см. model.ts. */
        const narrow: Record<string, Narrow> = { ...(ch.narrow || {}) }
        const nw = sv.narrow ?? known?.narrow
        for (const f of sv.prefixes) {
            if (on) { pref.delete(pathFor(f)); delete narrow[pathFor(f)] }
            else { pref.add(pathFor(f)); if (nw) narrow[pathFor(f)] = nw }
        }
        for (const f of sv.domains) {
            if (on) doms.delete(pathFor(f)); else doms.add(pathFor(f))
        }
        /* match расширяется, а не пересоздаётся: правило с `any` (или любым полем,
         * которого эта форма не знает) при щелчке по галочке теряло его молча —
         * «весь трафик» превращался в «только выбранное» без единого слова (I-012). */
        const next: Channel = {
            ...ch,
            match: {
                ...ch.match,
                prefixes_files: pref.size ? [...pref] : undefined,
                domains_files: doms.size ? [...doms] : undefined,
                srs_files: srs.size ? [...srs] : undefined,
                mode: doms.size || srs.size ? (ch.match.mode ?? 'fakeip') : undefined,
            },
            narrow: Object.keys(narrow).length ? narrow : undefined,
        }
        /* Подмена порта — свойство доменов правила: новый доменный файл получает её тоже. */
        onChange(port === undefined ? next : withOverridePort(next, port))
        if (set) return
        /* Сужение неизвестно (набор ещё не разбирали) — узнать сейчас, а не при следующем
         * открытии каталога: list_fetch разбирает набор и отдаёт `narrow` тем же ответом.
         * Ответ без сужения — тоже ответ: подсети не ограничены. Спрашивается по КАЖДОЙ части
         * подсетей её id: у записи каталога id записи — склейка частей, и роутер его не знает
         * (I-421); у второго издателя id части и записи совпадают. */
        if (!on && !known && mayNarrow(sv) && sv.narrow === undefined) {
            for (const part of sv.parts.filter((p) => p.kind === 'prefixes')) {
                const file = pathFor(part.file)
                void rpc.listFetch(part.id, 'prefixes')
                    .then((r) => {
                        if (!r.ok || !r.narrow) return
                        const cur = latest.current
                        if (!cur.match.prefixes_files?.includes(file)) return
                        onChange({ ...cur, narrow: { ...(cur.narrow || {}), [file]: r.narrow } })
                    })
                    .catch(() => undefined)
            }
        }
    }

    const shown = services.filter((sv) => {
        const s = q.trim().toLowerCase()
        return !s || sv.name.toLowerCase().includes(s) || sv.id.toLowerCase().includes(s)
    })

    const total = chosenEntries.reduce((n, sv) => n + (sv.count || 0), 0)

    /** Файлы правила, за которыми не стоит ни одна запись каталога и ни один свой список.
     *
     *  Считается по СПЕКЕ, а не по диску: вопрос «что это правило делает», а не «что
     *  скачано». Свои списки исключены — у них своя карточка и свой способ снять. */
    const foreign = useMemo(() => {
        const known = new Set(services.flatMap(serviceFiles))
        return [...new Set(ruleFiles(ch))].filter((f) => !known.has(f))
    }, [services, ch])

    /** Убрать из правила один файл, не трогая остальные.
     *
     *  Отдельно от `pick`: тот работает записью каталога, а здесь записи нет вовсе — есть
     *  путь, и снимать надо ровно его. `match` расширяется, а не пересоздаётся, по той же
     *  причине, что и там (I-012). */
    function dropFile(file: string) {
        const pref = (ch.match.prefixes_files || []).filter((f) => f !== file)
        const doms = (ch.match.domains_files || []).filter((f) => f !== file)
        const srs = (ch.match.srs_files || []).filter((f) => f !== file)
        const narrow = ch.narrow ? Object.fromEntries(Object.entries(ch.narrow).filter(([f]) => f !== file)) : undefined
        const next: Channel = {
            ...ch,
            narrow: narrow && Object.keys(narrow).length ? narrow : undefined,
            match: {
                ...ch.match,
                prefixes_files: pref.length ? pref : undefined,
                domains_files: doms.length ? doms : undefined,
                srs_files: srs.length ? srs : undefined,
                mode: doms.length || srs.length ? (ch.match.mode ?? 'fakeip') : undefined,
            },
        }
        onChange(port === undefined ? next : withOverridePort(next, port))
    }

    /** Порт назначения у доменов правила, как его набирает человек: строкой, чтобы набор
     *  «70000» не обрывался на «7000». В правило уходит только годное число (ядро: 1..65535). */
    const [portText, setPortText] = useState(() => (port === undefined ? '' : String(port)))
    const portOk = (t: string) => /^[1-9]\d{0,4}$/.test(t) && Number(t) <= 65535
    const portBad = portText.trim() !== '' && !portOk(portText.trim())
    function setPort(v: string) {
        setPortText(v)
        const t = v.trim()
        if (t === '') onChange(withOverridePort(ch, undefined))
        else if (portOk(t)) onChange(withOverridePort(ch, Number(t)))
    }

    /* Bode 26.10: редактор по образцу экрана правила в приложении Splify2.
     *
     *  Шапка экрана — стрелка назад и место правила в очереди. Ниже
     *  блоки-карточки в порядке приложения: название, кого касается, что перенаправляем,
     *  куда. На широком экране они встают в две колонки (название и «кого» слева, «что» и
     *  «куда» справа) — порядок чтения при этом тот же, что на узком, где колонка одна.
     *  Внизу «Готово» во всю ширину и «Удалить правило» обведённой красной кнопкой: первое —
     *  то, что делают почти всегда, второе — то, что нельзя нажать нечаянно вместо первого. */
    const someone = !!ch.from?.length
    return (
        <div className="space-y-4">
            <ScreenHeader
                title={S.ruleEditor.praviloIz(index + 1, rulesTotal)}
                back={onClose}
                backLabel={S.ruleEditor.vsePravila}
            />

            <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
                <div className="min-w-0 space-y-4">
                    <Block>
                        <label className="flex flex-col gap-1.5 text-xs text-subtle">
                            {S.ruleEditor.nazvaniePravila}<input
                                value={ch.name}
                                onChange={(e) => onChange({ ...ch, name: e.currentTarget.value })}
                                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                            />
                        </label>
                    </Block>

                    <Block>
                        <CardHead title={S.ruleEditor.kogoKasaetsya} />
                        {/* Два варианта — сегментами, как «Кому» в приложении. Значение то же,
                            что у прежних переключателей: пустой `from` — все устройства,
                            непустой — только перечисленные. */}
                        <Segmented
                            label={S.ruleEditor.kogoKasaetsya}
                            value={someone ? 'some' : 'all'}
                            onChange={(v) =>
                                v === 'all'
                                    ? onChange({ ...ch, from: undefined })
                                    : onChange({ ...ch, from: ch.from?.length ? ch.from : [''] })
                            }
                            /* Подписи мельче на узком экране и переносятся: «Все устройства в
                               сети» в половине ширины телефона иначе обрезалась бы многоточием. */
                            items={[
                                { value: 'all', label: <span className="block whitespace-normal text-xs leading-tight sm:text-sm">{S.ruleEditor.vseUstroystvaVSeti}</span> },
                                { value: 'some', label: <span className="block whitespace-normal text-xs leading-tight sm:text-sm">{S.ruleEditor.tolkoVybrannye}</span> },
                            ]}
                        />
                        {someone && (
                            <>
                                {/* Устройства из аренд DHCP. Адрес у устройства меняется — DHCP
                                    выдаёт другой после перезагрузки, и правило начинает касаться
                                    не того; MAC живёт, пока живёт устройство. Поэтому в правило
                                    кладём MAC, а адрес показываем только чтобы узнать устройство. */}
                                {leases.length > 0 && (
                                    <div className="max-h-48 divide-y divide-border overflow-y-auto">
                                        {leases.map((l) => {
                                            const on = (ch.from || []).includes(l.mac)
                                            return (
                                                <label
                                                    key={l.mac}
                                                    className="flex min-h-[44px] cursor-pointer items-center gap-3 py-1.5 text-sm"
                                                >
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate">{l.name || l.ip}</span>
                                                        <span className="block truncate font-mono text-xs text-muted-foreground">
                                                            {l.mac}
                                                        </span>
                                                    </span>
                                                    <input
                                                        type="checkbox"
                                                        checked={on}
                                                        onChange={() => {
                                                            const cur = ch.from || []
                                                            const next = on
                                                                ? cur.filter((x) => x !== l.mac)
                                                                : [...cur.filter(Boolean), l.mac]
                                                            onChange({ ...ch, from: next.length ? next : [''] })
                                                        }}
                                                        className="shrink-0"
                                                    />
                                                </label>
                                            )
                                        })}
                                    </div>
                                )}
                                <input
                                    value={(ch.from || []).join(', ')}
                                    placeholder={S.ruleEditor.n192168150}
                                    onChange={(e) => {
                                        const v = e.currentTarget.value
                                            .split(',')
                                            .map((s) => s.trim())
                                            .filter(Boolean)
                                        onChange({ ...ch, from: v.length ? v : [''] })
                                    }}
                                    className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
                                />
                                {/* Адреса и MAC в одном правиле законны: ядру такое правило
                                    уходит двумя правилами подряд (encodeSpec в lib/specv2.ts). */}
                                <p className="text-xs text-muted-foreground">
                                    {S.ruleEditor.macVidenTolkoU}</p>
                                {/* Опечатку в адресе ядро 2.0 не пропускает: спека с ней не
                                    применится целиком (addr_check спеки v2), и правки соседних
                                    правил встанут вместе с ней. Проверка та же, что у ядра
                                    (lib/validate.ts): IPv4 и IPv6 — адрес, подсеть или диапазон
                                    `a-b`; MAC — шесть пар через двоеточие. Двоеточие само по себе
                                    MAC не означает: у IPv6 оно тоже есть. */}
                                {(() => {
                                    const bad = (ch.from || [])
                                        .filter(Boolean)
                                        .filter((x) => !MAC.test(x.trim()) && !isClientAddr(x))
                                    return bad.length ? (
                                        <p className="text-xs text-destructive">
                                            {S.ruleEditor.neAdresINe}{bad.join(', ')} {S.ruleEditor.takuyuZapisYadroVybrosit}</p>
                                    ) : null
                                })()}
                            </>
                        )}
                    </Block>
                </div>

                <div className="min-w-0 space-y-4">
                    <Block>
                        <CardHead
                            title={S.ruleEditor.chtoPerenapravlyaem}
                            meta={chosen.length
                                ? S.ruleEditor.zapiseyVybrano(chosen.length)
                                : ch.match.any ? S.rulesTab.vesTrafik : S.ruleEditor.nichegoNeVybrano}
                        />
                        {/* Счёт сервисов и записей стоял в шапке редактора справа. В шапке
                            экрана по образцу приложения на 390 пикселях он отнимал место у
                            заголовка («Правило 3 из 6» обрезалось), а относится он к этому
                            блоку — сюда и переехал. */}
                        <div className="-mt-2 font-mono text-xs text-muted-foreground">
                            {/* Правило «весь трафик» (match.any — исключение для устройства) сервисов не
                                имеет: «ничего не выбрано · сервис не выбран» над ним читалось как
                                пустое правило (QEMU-стенд, после перехода 26.9.2 → 26.10). */}
                            {chosenEntries.length
                                ? S.ruleEditor.servisov(chosenEntries.length)
                                : ch.match.any ? '' : S.ruleEditor.servisNeVybran}
                            {total ? S.ruleEditor.zapisey(total.toLocaleString('ru-RU')) : ''}
                        </div>

                        {chosenEntries.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {chosenEntries.map((sv) => (
                                    <button
                                        key={sv.id}
                                        type="button"
                                        onClick={() => pick(sv)}
                                        className="flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs"
                                    >
                                        {sv.name} <span aria-hidden="true">×</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3">
                            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <input
                                value={q}
                                onChange={(e) => setQ(e.currentTarget.value)}
                                placeholder={S.ruleEditor.poiskPoKataloguServisy}
                                className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
                            />
                            <span className="shrink-0 text-xs text-muted-foreground">
                                {shown.length} {S.ruleEditor.zapisey2}</span>
                        </div>

                        {/* Каталог — строками через волосяную линию, галочка у правого края, как
                            выбор списков в приложении. Прокрутка своя: каталог длиннее экрана,
                            а блок «Куда» должен оставаться в пределах досягаемости. */}
                        <div className="max-h-72 divide-y divide-border overflow-y-auto">
                            {shown.length === 0 && (
                                <p className="py-3 text-xs text-muted-foreground">{S.ruleEditor.nichegoNeNashlos}</p>
                            )}
                            {shown.map((sv) => {
                                const on = chosen.includes(sv.id)
                                const kinds = [...new Set(sv.parts.map((p) => p.kind))]
                                const missing = onRouter(sv, local) ? 0 : 1
                                return (
                                    <label
                                        key={sv.id}
                                        className="flex min-h-[44px] cursor-pointer items-center gap-3 py-1.5 text-sm"
                                    >
                                        <span className="min-w-0 flex-1 truncate">
                                            {sv.name}
                                            {/* «Скачается» — под именем, а не в строку справа: там
                                                оно вклинивалось между именем и видом, и вид с числом
                                                обрезался как раз у самых длинных названий. */}
                                            {probing.has(sv.id) ? (
                                                <span className="ml-2 text-xs text-muted-foreground">
                                                    {S.ruleEditor.skachivaetsya}</span>
                                            ) : missing > 0 && (
                                                <span className="ml-2 text-xs text-muted-foreground">
                                                    {S.ruleEditor.skachaetsya}</span>
                                            )}
                                        </span>
                                        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                                            {kinds.length === 2
                                                ? S.ruleEditor.domenyIAdresa
                                                : kinds[0] === 'domains'
                                                  ? S.ruleEditor.domeny
                                                  : S.ruleEditor.adresa}
                                            {sv.count ? ` · ${sv.count.toLocaleString('ru-RU')}` : ''}
                                        </span>
                                        <input
                                            type="checkbox"
                                            checked={on}
                                            disabled={probing.has(sv.id)}
                                            onChange={() => pick(sv)}
                                            className="shrink-0"
                                        />
                                    </label>
                                )
                            })}
                        </div>

                        {foreign.length > 0 && (
                            /* ФАЙЛЫ, КОТОРЫХ НЕТ В КАТАЛОГЕ, но которые в этом правиле стоят.
                               Появляются они у того, кто выбирал списки до смены издателя, и у
                               того, кто правил спеку руками. Промолчать нельзя: галочки у них
                               нет, а работают они по-прежнему — то есть правило делает больше,
                               чем показывает. Снять можно прямо здесь, поимённо: это
                               единственное место, где такой файл вообще виден. */
                            <div className="rounded-xl border border-border p-3">
                                <div className="mb-1 text-xs font-medium text-warning-fg">
                                    {S.ruleEditor.vPravileEstFayly}</div>
                                <ul className="divide-y divide-border">
                                    {foreign.map((f) => (
                                        <li key={f} className="flex items-center gap-2 py-1 text-xs">
                                            <code className="min-w-0 flex-1 truncate">{f}</code>
                                            <button
                                                type="button"
                                                onClick={() => dropFile(f)}
                                                className="shrink-0 text-muted-foreground underline decoration-dotted hover:text-destructive"
                                            >
                                                {S.ruleEditor.ubrat}</button>
                                        </li>
                                    ))}
                                </ul>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {S.ruleEditor.oniProdolzhayutRabotatI}</p>
                            </div>
                        )}

                        <p className="text-xs text-muted-foreground">
                            {S.ruleEditor.vybiraetsyaServisEsliU}</p>
                        {clash && <p className="text-xs text-warning-fg">{clash}</p>}
                    </Block>

                    <Block>
                        <CardHead title={S.ruleEditor.kudaNapravlenieVyhod} />
                        {outNames.length === 0 && (
                            <p className="text-xs text-warning-fg">
                                {S.ruleEditor.vyhodovNetPraviluNekuda}</p>
                        )}
                        {orphans.map((d) => (
                            <p key={d.name} className="text-xs text-warning-fg">
                                {S.ruleEditor.tunnel}{d.name} {S.ruleEditor.podnyatNoNePrivyazan}</p>
                        ))}
                        {/* Радиосписок с точкой состояния выхода, как «Куда» в приложении:
                            кружок выбора, точка, имя, справа — чем выход является. */}
                        {outNames.length > 0 && (
                            <div>
                                {outNames.map((n) => {
                                    const o = outputs[n]
                                    return (
                                        <label key={n} className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm">
                                            <input
                                                type="radio"
                                                checked={ch.out === n}
                                                onChange={() => onChange({ ...ch, out: n })}
                                                className="shrink-0"
                                            />
                                            <span
                                                className={`h-2 w-2 shrink-0 rounded-full ${
                                                    o.kind === 'direct'
                                                        ? 'bg-muted-foreground'
                                                        : o.up
                                                          ? 'bg-success'
                                                          : 'bg-destructive'
                                                }`}
                                                aria-hidden="true"
                                            />
                                            {/* Постоянный выход называется словом, а не ключом
                                                спеки: «direct» в списке целей читалось как чьё-то
                                                имя выхода, а не как «никуда не уводить». */}
                                            <span className="min-w-0 flex-1 truncate">
                                                {o.kind === 'direct' ? S.ruleEditor.napryamuyu : n}
                                            </span>
                                            <span className="shrink-0 text-xs text-muted-foreground">
                                                {/* «нет NAT» — только у своего устройства: у туннеля
                                                    подписки (и у пула, где активна часть подписки)
                                                    masquerade не нужен вовсе, и метка пугала зря. */}
                                                {o.kind === 'direct'
                                                    ? S.ruleEditor.mimoTunnelya
                                                    : o.nat === false && o.kind === 'interface' && !isPart(outputs[o.device || ''])
                                                          && !(o.device && isTunnelKind(outputs[o.device]?.kind))
                                                      ? S.ruleEditor.netNat
                                                      : o.kind === 'interface' && o.device && isPart(outputs[o.device])
                                                        ? S.ruleEditor.podpiska
                                                        : o.device || ''}
                                            </span>
                                        </label>
                                    )
                                })}
                            </div>
                        )}
                        {/* Исключение называется словом ровно там, где оно задаётся. Механизм в
                            продукте был всегда — канал в direct выше туннельных, — но нигде так не
                            назывался, и запрос «Spotify без VPN работает лучше» (splify2#3) не
                            находил ответа. Заодно здесь единственное место, где видно, СРАБОТАЕТ ли
                            оно: место в очереди решает всё. */}
                        {isException && (
                            <p className="text-xs text-muted-foreground">
                                {/* «Пока стоит выше» — это следствие того, что метку раздаёт первое
                                    совпадение сверху. Раздача меток — устройство движка, и на экране
                                    ей не место; место в очереди человек видит числом и правит
                                    стрелками. */}
                                {S.ruleEditor.etoIsklyuchenieVybrannoePoydet}{index + 1}{S.ruleEditor.eIz}{rulesTotal}.
                            </p>
                        )}
                        {isException && coveredBy.length > 0 && (
                            <p className="text-xs text-destructive">
                                {S.ruleEditor.isklyucheniePerekrytoVysheStoit}{coveredBy.join('», «')}{S.ruleEditor.sTemiZheZapisyami}</p>
                        )}
                        {hasDomains && (
                            /* Два режима — сегментами, как любой выбор из двух-четырёх вариантов в
                               приложении; значения те же, что были у выпадающего списка. */
                            <div className="space-y-1.5 border-t border-border pt-3 text-xs">
                                <div className="text-subtle">{S.ruleEditor.rezhimDomenov}</div>
                                <Segmented
                                    label={S.ruleEditor.rezhimDomenov}
                                    value={ch.match.mode ?? 'fakeip'}
                                    onChange={(m) => {
                                        const next: Channel = { ...ch, match: { ...ch.match, mode: m } }
                                        /* В realip подмены порта нет (ядро такое правило не примет). */
                                        onChange(m === 'realip' ? withOverridePort(next, undefined) : next)
                                        if (m === 'realip') setPortText('')
                                    }}
                                    items={[
                                        { value: 'fakeip', label: S.ruleEditor.fakeIpTochnee },
                                        { value: 'realip', label: S.ruleEditor.realIpDeshevle },
                                    ]}
                                />
                                <p className="text-muted-foreground">
                                    {S.ruleEditor.fakeIpKazhdomuDomenu}</p>
                            </div>
                        )}
                        {hasDomains && fakeip && (
                            <div className="text-xs">
                                <FieldRow label={S.ruleEditor.portNaznacheniya}>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={portText}
                                        placeholder={S.ruleEditor.portKakUZaprosa}
                                        onChange={(e) => setPort(e.currentTarget.value)}
                                        className="w-32 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                                    />
                                </FieldRow>
                                {portBad && <p className="text-destructive">{S.ruleEditor.portOt1Do65535}</p>}
                            </div>
                        )}
                        {hasDomains && (
                            <label className="flex items-center justify-between gap-3 text-xs">
                                <span className="text-subtle">{S.ruleEditor.serverDns}</span>
                                <select
                                    value={typeof ch.dns === 'string' ? ch.dns : ownDns ? OWN_DNS : ''}
                                    onChange={(e) => {
                                        const v = e.currentTarget.value
                                        const next = { ...ch }
                                        if (v === OWN_DNS) next.dns = ownDns ?? { url: 'https://' }
                                        else if (v) next.dns = v
                                        else delete next.dns
                                        onChange(next)
                                    }}
                                    className="min-w-0 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                                >
                                    <option value="">{S.ruleEditor.poUmolchaniyu}</option>
                                    {upstreamNames.map((n) => <option key={n} value={n}>{n}</option>)}
                                    <option value={OWN_DNS}>{S.ruleEditor.svoyAdresDns}</option>
                                </select>
                            </label>
                        )}
                        {hasDomains && ownDns && (
                            <div className="space-y-1 text-xs">
                                <FieldRow label={S.ruleEditor.adresDns}>
                                    <input
                                        value={ownDns.url}
                                        onChange={(e) => setOwnDns({ ...ownDns, url: e.currentTarget.value.trim() })}
                                        placeholder="https://dns.example/dns-query"
                                        className="w-full rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-sm"
                                    />
                                </FieldRow>
                                <FieldRow label={S.ruleEditor.dnsCherezVyhod}>
                                    <select
                                        value={ownDns.out || ''}
                                        onChange={(e) => {
                                            const { out: _o, ...rest } = ownDns
                                            const v = e.currentTarget.value
                                            setOwnDns(v ? { ...rest, out: v } : rest)
                                        }}
                                        className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                                    >
                                        <option value="">{S.ruleEditor.dnsNapryamuyu}</option>
                                        {dnsOuts.map((o) => <option key={o} value={o}>{o}</option>)}
                                    </select>
                                </FieldRow>
                                <FieldRow label={S.ruleEditor.dnsAdresaServera}>
                                    <input
                                        defaultValue={(ownDns.ips || []).join(', ')}
                                        onBlur={(e) => {
                                            const ips = e.currentTarget.value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)
                                            const { ips: _i, ...rest } = ownDns
                                            setOwnDns(ips.length ? { ...rest, ips } : rest)
                                        }}
                                        placeholder="1.1.1.1, 1.0.0.1"
                                        className="w-full rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-sm"
                                    />
                                </FieldRow>
                            </div>
                        )}
                    </Block>
                </div>
            </div>

            <div className="space-y-2">
                <Button onClick={onClose} className="w-full">{S.ruleEditor.gotovo}</Button>
                <Button
                    variant="outline"
                    onClick={onDelete}
                    className="w-full border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                    <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" /> {S.ruleEditor.udalitPravilo}</Button>
            </div>
        </div>
    )
}

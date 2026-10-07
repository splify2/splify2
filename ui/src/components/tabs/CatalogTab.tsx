import { useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { rpc } from '@/lib/rpc'
import CustomLists from '@/components/CustomLists'
import { Hint } from '@/components/ui/hint'
import { ruleFiles, srsPathFor } from '@/lib/rulefiles'
import {
    toAllowDomainsServices,
    toCatalog,
    type AllowDomains,
    type ListOrigin,
    type ServiceEntry,
    type Spec,
} from '@/lib/model'

import { S } from '@/copy'
/** Каталог: что доступно, сколько записей, где используется. ТОЛЬКО справка.
 *
 *  Кнопки «Загрузить» больше нет: списки, на которые указывает правило, скачивает бэкенд
 *  в момент применения (ветка apply в rpcd), а свежесть держит расписание. Человеку
 *  осталась одна необязательная кнопка — обновить уже лежащий список прямо сейчас.
 *
 *  Назначение живёт только в правиле, каталог отвечает на другой вопрос: «что вообще
 *  есть и задействовано ли оно».
 *
 *  ИСТОЧНИК ОДИН — itdoginfo/allow-domains, решение владельца. Прежний манифест
 *  (ru-bypass-ipsets) отсюда убран, и убран ТОЛЬКО из предложения: файлы, на которые уже
 *  ссылаются правила, продолжают скачиваться и обновляться как прежде. Поэтому внизу
 *  отдельной строкой перечислено то, что правила используют, а каталог больше не
 *  предлагает: спрятать это молча значило бы, что включённый человеком список исчезает с
 *  экрана, оставаясь в работе, — и снять его становится негде.
 *
 *  Версия у второго издателя — ТЕГ РЕЛИЗА, а не номер манифеста, и он зашит в пакет:
 *  состав списков не меняется сам собой, а подпись внизу говорит, какой именно тег. */

interface Props {
    /** Открыть редактор правила с этим сервисом. Переключает вкладку — каталог не умеет
     *  назначать сам, и это ровно то разделение, ради которого он переписан. */
    onUseInRule: (s: ServiceEntry) => void
}

/** Признак источника доменной части: откуда список берётся и что делать с недостающим
 *  доменом. Форма у зеркала и у своего списка издателя одна, разное — единственное, что
 *  человеку и важно: переживёт ли обновление то, что он добавит, и куда идти с доменом.
 *
 *  Выросло из splify2#7: категория «18+» включена, нужного сайта в ней нет, и узнать
 *  почему было негде. */
function SourceNote({ origin, ours, mixed }: { origin: ListOrigin; ours: boolean; mixed: boolean }) {
    const label = ours ? S.catalogTab.spisokNash : S.catalogTab.spisokVneshniy
    return (
        <div className="mt-0.5 text-xs text-muted-foreground">
            <Hint
                tip={
                    ours
                        ? S.catalogTab.neHvataetDomenaPredlozhite(origin.repo ? ` (${origin.repo})` : '')
                        : S.catalogTab.dobavitDomenMozhnoU(origin.repo ? ` (${origin.repo})` : '')
                }
            >
                {mixed ? S.catalogTab.domeny(label) : label}
            </Hint>
            {origin.suggest_url && (
                <>
                    {' · '}
                    <a
                        href={origin.suggest_url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-dotted hover:text-foreground"
                    >
                        {S.catalogTab.predlozhitDomen}</a>
                </>
            )}
        </div>
    )
}

export default function CatalogTab({ onUseInRule }: Props) {
    const [services, setServices] = useState<ServiceEntry[]>([])
    /** Ответ ЗАПАСНОГО пути: таблица издателя из пакета. Не null — значит каталог провайдера
     *  скачать не вышло, и внизу надо назвать то, что показано на самом деле, вместе с его
     *  тегом. Пока источник тот, который выбрал человек, это поле пусто. */
    const [ad, setAd] = useState<AllowDomains | null>(null)
    /** Версия каталога — как её назвал источник. Показывается внизу: вопрос «какие у тебя
     *  списки» без неё ответа не имеет. */
    const [version, setVersion] = useState('')
    /** Каталог не загрузился — отдельным признаком от «загрузился пустым»: первое означает
     *  поломку и требует объяснения, второе законно (издатель не публикует ничего). */
    const [adFailed, setFailed] = useState(false)
    const [spec, setSpec] = useState<Spec | null>(null)
    const [local, setLocal] = useState<Record<string, { count: number; mtime: number }>>({})
    const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set())
    const mark = (id: string) => setBusy((b) => new Set(b).add(id))
    const unmark = (id: string) =>
        setBusy((b) => {
            const n = new Set(b)
            n.delete(id)
            return n
        })
    const [q, setQ] = useState('')
    const [only, setOnly] = useState<'all' | 'used'>('all')
    /** Форма своих списков — по кнопке, а не всегда: за ней приходят редко, а место
     *  над каталогом она занимала всегда. Открытой остаётся, пока вкладку не покинули. */
    const [customOpen, setCustomOpen] = useState(false)
    /** Идёт общий прогон обновления. Отдельно от `busy`: тот про одну запись, а этот
     *  запирает кнопку целиком — два прогона разом скрипт всё равно не пустит. */
    const [updating, setUpdating] = useState(false)

    useEffect(() => {
        /* КАТАЛОГ — ЭТО ПРОВАЙДЕР, а не таблица в пакете. Человек выбирает источник в
           настройках, и вкладка обязана показывать ВЫБРАННЫЙ: пока она рисовала зашитую
           таблицу, смена источника не меняла на экране ничего.

           Зашитый издатель остался ЗАПАСНЫМ путём и только им: каталог живёт в сети, и
           роутер, которому его нечем скачать (первый запуск, закрытый GitHub), не должен
           оставаться с пустым экраном — таблица в пакете отвечает без сети. */
        rpc.manifest()
            .then((m) => {
                const c = toCatalog(m)
                if (c.services.length) {
                    setServices(c.services)
                    setVersion(c.version || '')
                    setFailed(false)
                    return
                }
                throw new Error(S.catalogTab.pustoyKatalog)
            })
            .catch(() =>
                rpc.allowDomains()
                    .then((a) => { setAd(a); setServices(toAllowDomainsServices(a)); setFailed(false) })
                    .catch(() => { setServices([]); setFailed(true) }),
            )
        rpc.specGet().then(setSpec).catch(() => setSpec(null))
        rpc.localLists().then((d) => setLocal(d.files || {})).catch(() => setLocal({}))
    }, [])

    /** Кто на запись ссылается. Ключ — путь относительно каталога списков, а НЕ имя файла:
     *  `hodca.lst` есть и адресный, и доменный (`domains/hodca.lst`), и по имени они слились
     *  бы в одну запись. */
    const used = useMemo(() => {
        const m = new Map<string, string[]>()
        for (const ch of spec?.channels || [])
            for (const f of ruleFiles(ch)) {
                const key = f.replace(/^.*\/etc\/steer\/lists\//, '')
                m.set(key, [...(m.get(key) || []), ch.name])
            }
        return m
    }, [spec])

    /* Обновление — по ВСЕМ частям сервиса: человек попросил сервис, и отчитываться
     * надо о нём. */
    async function fetchService(sv: ServiceEntry) {
        mark(sv.id)
        let bad = 0
        // Каким путём приехали файлы. Пусто — прямым; иначе бэкенд обошёл закрытый
        // githubusercontent, и сказать об этом надо здесь: обход медленнее, и человек
        // иначе видит только затянувшееся ожидание (splify2#15).
        let via = ''
        try {
            for (const p of sv.parts) {
                const r = await rpc
                    .listFetch(p.id, p.kind)
                    .catch(() => ({ ok: false }) as { ok: boolean; via?: string })
                if (!r.ok) bad++
                if (r.via) via = r.via
            }
            setLocal((await rpc.localLists()).files || {})
            if (bad) notify(S.catalogTab.neObnovilosChasteyIz(sv.name, bad, sv.parts.length), 'warning')
            else notify(S.catalogTab.obnovleno(sv.name, via ? ` (${via})` : ''))
        } finally {
            unmark(sv.id)
        }
    }

    /** Обновить всё, что используют правила. Ровно то же, что делает расписание:
     *  скачать, подогнать, проверить и применить. */
    async function updateAll() {
        setUpdating(true)
        try {
            const r = await rpc.listsUpdate()
            setLocal((await rpc.localLists()).files || {})
            if (!r.ok) notify(r.error || S.catalogTab.neObnovilosSpiskov(r.failed || 1), 'warning')
            else if (r.updated) notify(S.catalogTab.obnovlenoSpiskov(r.updated))
            else notify(S.catalogTab.spiskiUzheSvezhie)
        } catch {
            notify(S.catalogTab.obnovitSpiskiNeUdalos, 'warning')
        } finally {
            setUpdating(false)
        }
    }

    async function removeService(sv: ServiceEntry) {
        mark(sv.id)
        let bad = 0
        let last = ''
        try {
            for (const p of sv.parts) {
                const r = await rpc.listRemove(p.id, p.kind).catch(
                    () => ({ ok: false }) as { ok: boolean; error?: string },
                )
                if (!r.ok) {
                    bad++
                    if (r.error) last = r.error
                }
            }
            setLocal((await rpc.localLists()).files || {})
            if (bad)
                notify(
                    last || S.catalogTab.neUdalosUdalitChastey(sv.name, bad, sv.parts.length),
                    'warning',
                )
            else notify(S.catalogTab.udalenSRoutera(sv.name))
        } finally {
            unmark(sv.id)
        }
    }

    if (adFailed)
        return (
            <div className="rounded-md border border-border bg-card p-5 text-sm text-muted-foreground">
                {S.catalogTab.katalogNeZagruzilsyaProverte}</div>
        )

    const rulesFor = (sv: ServiceEntry) => {
        const names = new Set<string>()
        for (const p of sv.parts)
            for (const f of [p.file, ...(sv.srs ? [srsPathFor(p.file)] : [])])
                for (const r of used.get(f.replace(/^.*\/etc\/steer\/lists\//, '').replace(/^\/+/, '')) || []) names.add(r)
        return [...names]
    }

    const shown = services.filter((sv) => {
        if (only === 'used' && rulesFor(sv).length === 0) return false
        const s = q.trim().toLowerCase()
        return !s || sv.name.toLowerCase().includes(s) || sv.id.toLowerCase().includes(s)
    })

    const usedCount = services.filter((sv) => rulesFor(sv).length > 0).length

    /* ЧТО ПРАВИЛА ИСПОЛЬЗУЮТ, А КАТАЛОГ БОЛЬШЕ НЕ ПРЕДЛАГАЕТ. Считается по спеке, а не по
       диску: вопрос ровно один — «на что ссылается правило, чего я тут не вижу». Свои
       списки исключены, у них своя карточка; всё остальное — прежний издатель или файл,
       положенный руками. */
    const catalogFiles = new Set(services.flatMap((sv) => sv.parts.map((p) => p.file.replace(/^\/+/, ''))))
    const orphans = [...used.keys()].filter(
        (f) => !catalogFiles.has(f) && !f.startsWith('custom/') && !f.startsWith('domains/custom/'),
    )

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-2">
                    <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <input
                        value={q}
                        onChange={(e) => setQ(e.currentTarget.value)}
                        placeholder={S.catalogTab.poiskPoKatalogu}
                        className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
                    />
                </div>
                {/* Bode: переключатель «все / используются» — сегментами, как в приложении. */}
                <div className="flex gap-0.5 rounded-xl bg-muted p-0.5" role="tablist" aria-label={S.catalogTab.chtoPokazyvat}>
                    {([
                        ['all', S.catalogTab.vse(services.length)],
                        ['used', S.catalogTab.ispolzuyutsya(usedCount)],
                    ] as const).map(([id, label]) => (
                        <button
                            key={id}
                            role="tab"
                            aria-selected={only === id}
                            onClick={() => setOnly(id)}
                            className={[
                                'h-8 rounded-lg px-3 text-sm transition-colors',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                only === id
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-transparent text-subtle hover:text-foreground',
                            ].join(' ')}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <Button variant="secondary" onClick={updateAll} disabled={updating}>
                    <RefreshCw
                        className={`mr-1 h-4 w-4${updating ? ' animate-spin' : ''}`}
                        aria-hidden="true"
                    />{' '}
                    {S.catalogTab.obnovitSpiski}</Button>
                <Button variant="secondary" onClick={() => setCustomOpen((v) => !v)} aria-expanded={customOpen}>
                    <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> {S.catalogTab.svoySpisok}</Button>
            </div>

            {customOpen && (
                <CustomLists
                    local={local}
                    onChanged={async () => setLocal((await rpc.localLists()).files || {})}
                />
            )}

            <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-card lg:rounded-2xl">
                {/* sp-stack: на узком экране строки таблицы встают блоками, а шапка убирается —
                    иначе столбцы «где используется» и действия уезжают за край, и кнопки
                    оказываются недостижимы. Разбор — в комментарии к правилу в index.css. */}
                <table className="sp-stack w-full text-sm md:min-w-[38rem]">
                    <thead>
                        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="px-3 py-2">{S.catalogTab.zapis}</th>
                            <th className="px-3 py-2">{S.catalogTab.zapisey}</th>
                            <th className="px-3 py-2">{S.catalogTab.gdeIspolzuetsya}</th>
                            <th className="px-3 py-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map((sv) => {
                            const byRules = rulesFor(sv)
                            const have = sv.parts.filter((p) => local[p.file.replace(/^\/+/, '')])
                            const localCount = have.reduce(
                                (n, p) => n + (local[p.file.replace(/^\/+/, '')]?.count || 0), 0)
                            /* Набор, лёгший файлом (списком не выразим): строк у него нет, есть
                               только «на роутере». */
                            const set = sv.srs && sv.parts.some((p) =>
                                local[srsPathFor(p.file).replace(/^\/etc\/steer\/lists\//, '')])
                            const kinds = [...new Set(sv.parts.map((p) => p.kind))]
                            return (
                                <tr key={sv.id} className="border-b border-border/50 transition-colors last:border-b-0 hover:bg-muted/40">
                                    <td className="px-3 py-2">
                                        <div className="truncate font-medium">{sv.name}</div>
                                        <div className="truncate text-xs text-muted-foreground">
                                            {kinds.length === 2
                                                ? S.catalogTab.domenyIAdresa
                                                : kinds[0] === 'domains'
                                                  ? S.catalogTab.tolkoDomeny
                                                  : S.catalogTab.tolkoAdresa}
                                            {sv.parts.length > 1 && S.catalogTab.chastey(sv.parts.length)}
                                        </div>
                                        {sv.same_prefixes && (
                                            /* Прочитать это надо ДО включения: адресный список у пары
                                               совпадает побайтово, и второй выбор не добавляет ни
                                               одного адреса. Причина — издателя, не наша. */
                                            <div className="mt-0.5 text-xs text-warning-fg">
                                                <Hint
                                                    /* Причина — строка издателя, и она вставляется
                                                       как есть: своей формулировки у интерфейса
                                                       здесь быть не должно. */
                                                    tip={`${sv.same_prefixes.reason ? S.catalogTab.prichina(sv.same_prefixes.reason) : ''}${
                                                        sv.same_prefixes.within
                                                            ? S.catalogTab.etoOdnaITa
                                                            : S.catalogTab.vklyuchatObeZapisiOdnovremenno
                                                    }`}
                                                >
                                                    {sv.same_prefixes.within
                                                        ? S.catalogTab.odinSpisokAdresov(sv.same_prefixes.names.join('» = «'))
                                                        : S.catalogTab.totZheSpisokAdresov(sv.same_prefixes.names.join('», «'))}
                                                </Hint>
                                            </div>
                                        )}
                                        {sv.upstream && (
                                            <SourceNote origin={sv.upstream} ours={false} mixed={sv.prefixes.length > 0} />
                                        )}
                                        {sv.maintained && (
                                            <SourceNote origin={sv.maintained} ours mixed={sv.prefixes.length > 0} />
                                        )}
                                        {sv.complement && (
                                            /* Вторая половина splify2#7: домена нет в зеркале, он есть
                                               в дополнении — но дополнение это ОТДЕЛЬНАЯ строка
                                               каталога. Промолчать здесь значит оставить человека с
                                               включённым зеркалом и тем же отсутствующим доменом. */
                                            <div className="mt-0.5 text-xs text-warning-fg">
                                                <Hint
                                                    tip={
                                                        sv.complement.ours
                                                            ? S.catalogTab.etaZapisDopolnyaetA(sv.complement.names.join('», «'))
                                                            : S.catalogTab.ryadomEstNashSpisok(sv.complement.names.join('», «'))
                                                    }
                                                >
                                                    {sv.complement.ours
                                                        ? S.catalogTab.dopolnyaetVklyuchayteOba(sv.complement.names.join('», «'))
                                                        : S.catalogTab.ryadomNashSpisokVklyuchayte(sv.complement.names.join('», «'))}
                                                </Hint>
                                            </div>
                                        )}
                                    </td>
                                    <td
                                        className="px-3 py-2 whitespace-nowrap text-muted-foreground"
                                        data-label={S.catalogTab.zapisey2}
                                    >
                                        {/* НЕЗАГРУЖЕННЫЙ СПИСОК И ПУСТОЙ СПИСОК — РАЗНЫЕ ВЕЩИ.
                                            Здесь стояло `localCount || sv.count || 0`: пока
                                            на диске нет ни одной части, столбец показывал
                                            число ИЗ КАТАЛОГА, то есть обещание издателя, а
                                            если и его нет — ноль. Именно этим столбцом люди
                                            проверяют, лёг ли список на роутер, и обе подмены
                                            отвечали им неправдой: первая — «всё на месте»,
                                            вторая — «список пуст». */}
                                        {have.length === 0
                                            ? set ? S.catalogTab.zagruzhen : S.catalogTab.neZagruzhen
                                            : localCount.toLocaleString('ru-RU')}
                                    </td>
                                    <td className="px-3 py-2">
                                        {byRules.length ? (
                                            <span className="text-primary">{byRules.join(', ')}</span>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => onUseInRule(sv)}
                                                className="text-primary underline decoration-dotted"
                                            >
                                                {S.catalogTab.vPravilo}</button>
                                        )}
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className="flex items-center justify-end gap-1">
                                            {have.length === 0 && !set ? (
                                                /* Не кнопка, а обещание: файл скачает бэкенд в момент
                                                   применения — человеку здесь делать нечего. */
                                                <Hint tip={S.catalogTab.spiskaEscheNetNa}>
                                                    <span className="text-xs text-muted-foreground">
                                                        {S.catalogTab.skachaetsyaSam}</span>
                                                </Hint>
                                            ) : (
                                                <>
                                                    <Hint tip={S.catalogTab.spiskiObnovlyayutsyaSamiRaz}>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            aria-label={S.catalogTab.obnovit(sv.name)}
                                                            disabled={busy.has(sv.id)}
                                                            onClick={() => fetchService(sv)}
                                                        >
                                                            <RefreshCw className={`h-4 w-4 ${busy.has(sv.id) ? 'animate-spin' : ''}`} aria-hidden="true" />
                                                        </Button>
                                                    </Hint>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        aria-label={S.catalogTab.udalitSRoutera(sv.name)}
                                                        className="hover:bg-destructive/10 hover:text-destructive"
                                                        disabled={busy.has(sv.id)}
                                                        onClick={() => removeService(sv)}
                                                    >
                                                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            )
                        })}
                        {shown.length === 0 && (
                            <tr>
                                <td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">
                                    {S.catalogTab.nichegoNeNashlos}</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {orphans.length > 0 && (
                /* Отдельным блоком и без кнопок: убрать такой список можно только там, где он
                   назначен, — в правиле. Кнопка «удалить» здесь предложила бы снять файл
                   из-под живого правила, а это отказ применения при следующей перезагрузке. */
                <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
                    <div className="mb-1 font-medium text-warning-fg">
                        {S.catalogTab.ispolzuyutsyaPravilamiNoKatalog}</div>
                    <p className="mb-2">
                        {S.catalogTab.etiSpiskiOstalisOt}</p>
                    <ul className="space-y-0.5">
                        {orphans.map((f) => (
                            <li key={f} className="truncate">
                                <code>{f}</code> · {(used.get(f) || []).join(', ')}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* ЧТО ПОКАЗАНО НА САМОМ ДЕЛЕ. Обычно это каталог выбранного источника, и тогда
                внизу его версия. Но если скачать его не вышло, показана запасная таблица из
                пакета — и молчать об этом нельзя: человек считал бы, что видит свой источник. */}
            {ad ? (
                <p className="text-xs text-warning-fg">
                    {S.catalogTab.katalogIstochnikaSkachatNe}{' '}
                    {ad.repo || 'itdoginfo/allow-domains'}{S.catalogTab.versiyaZafiksirovanaTegom}{' '}
                    <code>{ad.tag || '—'}</code>
                    {ad.tag_default && ad.tag !== ad.tag_default && S.catalogTab.pereopredelenNastroykoy}.
                </p>
            ) : (
                <p className="text-xs text-muted-foreground">
                    {S.catalogTab.katalogSpravkaZapisNachinaet}{version ? S.catalogTab.versiya(version) : ''}.
                </p>
            )}
            {ad?.tag_warn && (
                /* Настройка, отбитая молча, — ровно та беда, ради которой предупреждение и
                   заведено на роутере: человек набрал тег, получил прежние списки и не узнал
                   почему. */
                <p className="text-xs text-warning-fg">{ad.tag_warn}</p>
            )}
        </div>
    )
}

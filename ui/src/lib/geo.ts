import { S } from '@/copy'
/** Страна по коду ISO 3166-1 alpha-2, как её называет внешняя сторона (`loc=` в ответе
 *  cdn-cgi/trace).
 *
 *  ЗАЧЕМ СВОЙ СПИСОК, А НЕ Intl.DisplayNames. Он есть в браузере и знает все страны, но на
 *  роутере интерфейс открывают и из приложений с урезанным движком, а падать из-за подписи
 *  под адресом нельзя. Поэтому список свой, короткий — те страны, где стоят узлы, — а всё
 *  остальное показывается кодом: «NL» лучше пустоты и лучше выдумки.
 *
 *  Флага здесь нет вовсе: его рисует вшитый шрифт флагов по коду страны (components/Flag.tsx),
 *  и он знает все страны — этот список только про названия, и полным быть не обязан. */

const NAMES: Record<string, string> = {
    AM: S.geo.armeniya, AT: S.geo.avstriya, AZ: S.geo.azerbaydzhan, BE: S.geo.belgiya, BG: S.geo.bolgariya,
    BR: S.geo.braziliya, CA: S.geo.kanada, CH: S.geo.shveytsariya, CY: S.geo.kipr, CZ: S.geo.chehiya,
    DE: S.geo.germaniya, DK: S.geo.daniya, EE: S.geo.estoniya, ES: S.geo.ispaniya, FI: S.geo.finlyandiya,
    FR: S.geo.frantsiya, GB: S.geo.velikobritaniya, GE: S.geo.gruziya, HK: S.geo.gonkong, HU: S.geo.vengriya,
    IE: S.geo.irlandiya, IL: S.geo.izrail, IN: S.geo.indiya, IT: S.geo.italiya, JP: S.geo.yaponiya,
    KZ: S.geo.kazahstan, LT: S.geo.litva, LU: S.geo.lyuksemburg, LV: S.geo.latviya, MD: S.geo.moldaviya,
    NL: S.geo.niderlandy, NO: S.geo.norvegiya, PL: S.geo.polsha, PT: S.geo.portugaliya, RO: S.geo.rumyniya,
    RS: S.geo.serbiya, RU: S.geo.rossiya, SE: S.geo.shvetsiya, SG: S.geo.singapur, SK: S.geo.slovakiya,
    TR: S.geo.turtsiya, UA: S.geo.ukraina, US: S.geo.ssha, AE: S.geo.oae, AU: S.geo.avstraliya,
}

/** Название страны для человека. Неизвестный код возвращается как есть: «NL» лучше пустоты и
 *  лучше выдумки. */
/** Коды, для которых у нас есть и название, и флаг. Нужен СИНХРОННО — решить, рисовать ли
 *  флаг, — тогда как сам спрайт приезжает отдельным куском по требованию. */

export function country(cc?: string): string {
    const c = (cc || '').trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(c)) return ''
    return NAMES[c] || c
}

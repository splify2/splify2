// Field validation for the settings form.
//
// These are the same shapes the shell side enforces (common.sh's clean_ip_list
// drops anything that isn't a well-formed IPv4 prefix, splify-apply feeds them
// straight into nft sets), but there the rejection is SILENT: a typo'd subnet is
// simply dropped from the generated set and the operator sees "I added it and
// nothing happens". Catching it in the form is the whole point.

const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4 = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`)
const CIDR4 = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}/(3[0-2]|[12]?\\d)$`)

/** Есть ли в строке хоть один знак вне ASCII. Признак того, что имя записано буквами
 *  своего алфавита и до роутера в таком виде доезжать не должно. */
const NON_ASCII = /[^\u0000-\u007F]/

export const isIp4 = (v: string) => IPV4.test(v.trim())
/** Подсеть с длиной префикса — то, что принимает `from` канала и наборы nft. */
export const isCidr4 = (v: string) => CIDR4.test(v.trim())

/** Адрес IPv6 без длины префикса. Разбирает браузер (`URL` с хостом в скобках) — тот же
 *  разборщик, что у адресной строки: сжатие `::` и хвост в точечной записи регуляркой не
 *  опишешь, а ядро steer проверяет ту же запись через inet_pton. Знаки вне состава IPv6
 *  отсекаются заранее: `]`, `/` или `%` в скобках поменяли бы смысл записи. */
export const isIp6 = (v: string) => {
  const s = v.trim()
  if (!s.includes(':') || !/^[0-9a-f:.]+$/i.test(s)) return false
  try {
    new URL(`http://[${s}]/`)
    return true
  } catch {
    return false
  }
}

/** Адрес клиента правила так, как его принимает ядро steer 2.0 (`addr_check` спеки v2 —
 *  `spec_line_family` в src/model/parse.c): IPv4 или IPv6, адресом, подсетью или диапазоном
 *  `начало-конец` одного семейства. */
export function isClientAddr(v: string): boolean {
  const s = v.trim()
  const dash = s.indexOf('-')
  if (dash >= 0) {
    const a = s.slice(0, dash)
    const b = s.slice(dash + 1)
    return (isIp4(a) && isIp4(b)) || (isIp6(a) && isIp6(b))
  }
  if (isIp4(s) || isCidr4(s)) return true
  const slash = s.indexOf('/')
  if (slash < 0) return isIp6(s)
  const len = s.slice(slash + 1)
  return /^(12[0-8]|1[01]\d|[1-9]?\d)$/.test(len) && isIp6(s.slice(0, slash))
}

export const isHttpUrl = (v: string) => {
  const s = v.trim()
  if (!s) return true            // empty = feature off, not an error
  return /^https?:\/\/[^\s]+$/i.test(s)
}

/** Источник узлов для выхода vless: ссылка на подписку ЛИБО одна или несколько ссылок
 *  vless://.
 *
 *  Две формы одного поля, а не две настройки: различает их БЭКЕНД по схеме (`sub_set` в
 *  rpcd-скрипте — ветка `https://*|http://*` скачивает, ветка `vless://*` пишет строки в файл
 *  подписки), и человек режимом не выбирает. Значит проверка здесь обязана принимать ровно то
 *  же, что принимает он: проверяя одним isHttpUrl, интерфейс отвергал ссылки vless:// до
 *  вызова rpc — то есть закрывал путь, который роутер умеет, и объяснял это словами «других
 *  схем он не умеет», неправдой про собственный бэкенд.
 *
 *  Смесь форм отвергается НАМЕРЕННО: `sub_set` идёт по одной ветке `case`, и вторую форму она
 *  молча потеряет. Тихая потеря половины ввода хуже отказа. */
export const isSubSource = (v: string) => {
  const s = v.trim()
  if (!s) return true            // пустое = «ещё не ввели»; обязательность проверяет панель
  if (isHttpUrl(s)) return true
  // Ссылок может быть несколько: из однострочного поля многострочная вставка приезжает
  // склеенной пробелами, и делит их бэкенд — здесь только проверяем, что все они vless://.
  // Схемы те же, что принимает sub_set: vless://, hysteria2:// и короткая hy2://.
  return s.split(/\s+/).every((p) => /^(vless|hysteria2|hy2):\/\/[^\s]+$/i.test(p))
}

/** Свой список доменов — в punycode, ПЕРЕД отправкой на роутер.
 *
 *  ЗАЧЕМ. Домен «россия.рф» терялся молча: `sanitize_list` (rpcd/common.sh) принимает только
 *  `[a-z0-9._-]`, а сообщение об отброшенных строках человек читает как придирку к своему
 *  файлу. Послаблять регулярку НЕЛЬЗЯ, и это главное соображение здесь: резолвер движка
 *  сравнивает байты имени из запроса DNS (dnsd.c), а браузер спрашивает `.рф` уже переведённым
 *  в `xn--…`. Кириллическая строка в списке не совпала бы ни с одним запросом — список принят,
 *  правило стоит, домен не уходит в туннель, и объяснить это нечем.
 *
 *  Перевод делает браузер: `new URL('http://' + host).hostname` — та же самая функция, которой
 *  он переводит адрес в строке, значит и результат тот же, что окажется в запросе DNS. Своей
 *  таблицы punycode в дереве нет и заводить её незачем.
 *
 *  Строка, в которой нет ни одного не-ASCII знака, возвращается ДОСЛОВНО: комментарии, пустые
 *  строки, звёздочка и отступы — дело `sanitize_list`, и трогать их здесь значило бы завести
 *  вторую чистку рядом с первой. */
export function toPunycodeList(text: string): string {
  return text.split('\n').map((raw) => {
    const line = raw.replace(/\r$/, '')
    if (!NON_ASCII.test(line)) return raw
    const hash = line.indexOf('#')
    const body = hash >= 0 ? line.slice(0, hash) : line
    const tail = hash >= 0 ? line.slice(hash) : ''
    const core = body.trim()
    if (!core) return raw
    const lead = body.slice(0, body.length - body.trimStart().length)
    const trail = body.slice(body.trimEnd().length)
    // Звёздочка поддомена — наша разметка, а не часть имени: URL её не поймёт.
    const star = core.startsWith('*.')
    const host = star ? core.slice(2) : core
    try {
      const p = new URL('http://' + host).hostname
      if (!p || NON_ASCII.test(p)) return raw
      return lead + (star ? '*.' : '') + p + trail + tail
    } catch {
      return raw
    }
  }).join('\n')
}

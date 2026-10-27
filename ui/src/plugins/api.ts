/** Типы host API плагинов панели — копия `@splify2/plugin-api` (plugin-sdk, packages/plugin-api/src/index.d.ts)
 *  версии 1.0.0. Источник правды — пакет и docs/host-api.md; при смене версии host API файл обновляется
 *  целиком, а `HOST_API_VERSION` растёт вместе с пакетом. Здесь же — форма ответа `plugins_list`. */
/**
 * @splify2/plugin-api — host API панели splify2 для UI плагинов. Только типы.
 *
 * Версия пакета = версия host API. Плагин объявляет её в манифесте: "compat": {"host-api": "^1.0"}.
 * Описание и правила — docs/host-api.md репозитория splify2/plugin-sdk.
 *
 * Модуль плагина — ES-модуль ui/index.js: панель грузит его import() и зовёт activate(host).
 * preact у плагина и панели один: сборщик SDK подменяет импорты preact, preact/hooks,
 * preact/jsx-runtime, react* на прокладку, которая берёт всё из globalThis.__splify2_host.preact.
 */
import type { ComponentChildren, ComponentType, VNode } from 'preact'

export const HOST_API_VERSION = '1.0.0'

// ---------------------------------------------------------------------------------------------
// Модуль плагина

export interface PluginModule {
  /** Зовётся один раз после import(). Регистрации (slots.*, themes.register…) отменяются сами при
   *  отключении плагина; возвращённая функция зовётся тогда же. Ошибка — плагин отключён в этой сессии. */
  activate(host: Host): void | Dispose | Promise<void | Dispose>
  deactivate?(): void
}

/** Отменить регистрацию. */
export type Dispose = () => void

// ---------------------------------------------------------------------------------------------
// Хост

export interface Host {
  /** Версия host API панели, semver: "1.0.0". */
  readonly apiVersion: string
  readonly plugin: PluginInfo
  /** luci — панель под LuCI; desktop — приложение splify2 (код с роутера, проверен по подписи). */
  readonly platform: 'luci' | 'desktop'
  /** Версия панели splify2 (build-id): "26.11.0". */
  readonly hostVersion: string

  readonly preact: PreactExports
  readonly ui: UiKit
  readonly rpc: Rpc
  readonly core: Core
  readonly i18n: I18n
  readonly styles: Styles
  readonly slots: Slots
  readonly themes: Themes
  readonly nav: Nav
  readonly prefs: Prefs

  /** Короткое сообщение внизу панели. */
  notify(text: string, tone?: 'info' | 'ok' | 'warn' | 'error'): void
  /** Диалог подтверждения панели (ui/src/components/ui/confirm.tsx). */
  confirm(req: ConfirmRequest): Promise<boolean>
}

export interface PluginInfo {
  readonly id: string
  readonly version: string
  /** Репозиторий, из которого поставлен; official — splify2. */
  readonly repo: string
  /** official — официальный репозиторий; third-party — подключённый человеком; unsigned — из файла без подписи. */
  readonly trust: 'official' | 'third-party' | 'unsigned'
  /** Адрес каталога ui/ плагина — для своих картинок и чанков: new URL('img/x.svg', host.plugin.base). */
  readonly base: string
}

export interface PreactExports {
  readonly h: typeof import('preact').h
  readonly Fragment: typeof import('preact').Fragment
  readonly render: typeof import('preact').render
  readonly hooks: typeof import('preact/hooks')
}

// ---------------------------------------------------------------------------------------------
// rpc плагина: объект ubus splify2.p.<id> (методы — rpc.methods манифеста)

export interface Rpc {
  /** Вызвать свой метод. Ответ программы rpc/<prog> — как есть; {ok:false,error} — отказ (RpcError). */
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  /** Долгий метод (job: true в манифесте): ждёт конца задания, onProgress — промежуточные ответы. */
  job<T = unknown>(method: string, params?: Record<string, unknown>,
                   onProgress?: (p: unknown) => void): Promise<T>
  /** Срок на обещание: по истечении — RpcError('timeout'). */
  deadline<T>(p: Promise<T>, ms: number): Promise<T>
}

export interface RpcError extends Error {
  /** denied — нет прав ACL; timeout; unavailable — нет ubus (вне LuCI); failed — метод сказал ok:false. */
  readonly kind: 'denied' | 'timeout' | 'unavailable' | 'failed'
  /** Машинное слово отказа (`code` ответа), если метод его назвал: у отказов бэкенда — код текста
   *  (`lists.too_big`), у отказов хоста — вид (`bad_request`, `not_installed`). Текст сообщения хост уже подставил
   *  на языке каркаса; код и `args` нужны плагину, у которого свой перевод. */
  readonly code?: string
  /** Подстановки `{имя}` текста отказа: значения как есть. */
  readonly args?: Record<string, string>
}

// ---------------------------------------------------------------------------------------------
// Ядро steer глазами панели: живые данные, спека, события

export interface Core {
  /** Хук: живые данные панели (тот же опрос, что useLive, ui/src/lib/live.ts:201). */
  useLive(): Live
  /** Последний снимок без подписки. */
  getLive(): Live
  /** Хук: сохранённая спека v2 в виде JSON (как её видит ядро) и признак несохранённых правок. */
  useSpec(): { spec: SpecV2 | null; dirty: boolean; applying: boolean }
  /**
   * Правка спеки через черновик панели (pending.edit, ui/src/lib/pending.ts:318).
   * fn правит копию; панель сама сохранит и применит (autoapply, ui/src/lib/autoapply.ts:21-23).
   * Отказ ядра приходит в rejects — человек видит его там же, где отказы своих правок.
   */
  edit(fn: (draft: SpecV2) => void): Promise<void>
  /** События сокета steerd (docs/ctl.md, subscribe; docs/steer-api.md, 4.1). */
  on<E extends CoreEventName>(ev: E, cb: (e: CoreEvent<E>) => void): Dispose
  /** Состояние плагинов (раздел «Плагины»). */
  plugins(): Promise<PluginState[]>
}

export type CoreEventName =
  | 'applied' | 'spec-error' | 'switched' | 'failed' | 'balance' | 'revived'
  | 'helper-up' | 'helper-down' | 'node' | 'health' | 'repaired'
  | 'plugin' | 'plugin-state'

export type CoreEvent<E extends CoreEventName> = { v: 1; ev: E } & Record<string, unknown>

export interface PluginState {
  id: string
  repo: string
  version: string
  state: 'installed' | 'enabled' | 'disabled' | 'failed' | 'pending'
  why: string | null
  update?: string
}

/** Живые данные (ui/src/lib/live.ts:65-138), то, что гарантирует host API 1.x. */
export interface Live {
  status: Status | null
  /** Ошибка связи с роутером или ядром для человека; null — всё хорошо. */
  error: string | null
  errorKind: 'router' | 'core' | null
  /** Данные устарели (последний опрос не удался). */
  stale: boolean
  /** Идёт применение или старт ядра. */
  phase: 'applying' | 'starting' | null
  /** Скорости устройств и каналов, байт/с. */
  speed: { ch: Record<string, { up: number; down: number }>; dev: Record<string, { rx: number; tx: number }> }
  refresh(): void
}

/** `steer status` (docs/contract-v1.md ядра) — гарантированная часть. */
export interface Status {
  schema: 1
  outputs: Record<string, OutputStatus>
  channels: unknown[]
  warnings?: { code: string; text: string; channel?: string }[]
  at?: number
  [k: string]: unknown
}

export interface OutputStatus {
  kind: string
  device?: string
  failed?: boolean
  on_fail?: 'drop' | 'direct'
  group?: { pick: string; members: string[]; selected: string | null; alive: string[]; [k: string]: unknown }
  /** Выход заведён плагином (разворот или pre-apply): docs/spec-fields.md. */
  owner?: { plugin: string; out?: string }
  /** Выход недоступен: вид без плагина, плагин отключён, спека не подготовлена. */
  unavail?: { why: string; plugin?: string }
  /** Состояние, которое пишет помощник плагина (событие state). */
  plugin?: unknown
  [k: string]: unknown
}

// ---------------------------------------------------------------------------------------------
// Спека v2 в виде JSON (steer/docs/spec-v2.md). Неизвестные ключи сохраняются как есть.

export interface SpecV2 {
  version: 2
  lan?: unknown
  clients?: Record<string, unknown>
  lists?: Record<string, unknown>
  outputs?: Record<string, OutputV2>
  dns?: Record<string, unknown>
  rules?: RuleV2[]
  [k: string]: unknown
}

export interface OutputV2 {
  /** Вид: ядра (direct, interface, group, block, awg) или плагина ("tunnel" + protocol, "warp"…). */
  kind: string
  protocol?: string
  on_fail?: 'drop' | 'direct'
  over?: string
  ipv6?: 'routed' | 'nat' | 'off'
  [k: string]: unknown
}

export interface RuleV2 {
  out: string
  to?: string | string[]
  from?: string | string[]
  [k: string]: unknown
}

// ---------------------------------------------------------------------------------------------
// i18n: словарь плагина i18n/<язык>.json

export interface I18n {
  /** Язык человека: "ru", "en". */
  readonly lang: string
  /** Строка из словаря плагина; vars подставляются в {имя}. Нет в языке — ru, нет и там — ключ. */
  t(key: string, vars?: Record<string, string | number>): string
  /** Множественное число по правилам языка: forms — ["узел", "узла", "узлов"] для ru. */
  plural(n: number, forms: readonly string[]): string
  onChange(cb: (lang: string) => void): Dispose
}

// ---------------------------------------------------------------------------------------------
// Стили: панель живёт в shadow root (ui/src/main.tsx:98-123), document.head туда не доходит

export interface Styles {
  /** Добавить CSS в shadow root панели. */
  add(css: string): Dispose
  /** Подключить файл CSS плагина (путь относительно ui/). Файлы ui.css манифеста подключаются сами. */
  link(path: string): Dispose
}

// ---------------------------------------------------------------------------------------------
// Слоты: точки, куда плагин встраивает интерфейс. Встроенные разделы панели регистрируются ими же.

export type IconComponent = ComponentType<{ className?: string; class?: string; 'aria-hidden'?: boolean | 'true' }>

/** Встроенные разделы панели (ui/src/lib/sections.ts:5) и новая вкладка «Плагины». */
export type BuiltinSection = 'home' | 'rules' | 'vpn' | 'dns' | 'requests' | 'diag' | 'plugins' | 'settings'

export interface Slots {
  /**
   * ГЛАВНЫЙ СЛОТ UI ПЛАГИНА. Вкладка «Плагины» показывает карточку каждого установленного плагина —
   * тем же приёмом, что карточки правил (RuleCard, ui/src/components/sections/Home.tsx:716-801):
   * имя, выключатель, удаление, строка состояния; щелчок по имени раскрывает карточку в настройки
   * плагина (как правило открывается в RuleEditor, ui/src/components/tabs/RulesTab.tsx:134-160, 368-380).
   * render — содержимое раскрытой карточки, summary — строка на свёрнутой.
   * Регистрируется один раз на плагин; повторная регистрация заменяет прежнюю.
   */
  pluginSettings(p: PluginSettingsSlot): Dispose

  /**
   * ИСКЛЮЧЕНИЕ: собственный раздел в полосе (Rail). По умолчанию плагин в Rail не попадает — его место
   * во вкладке «Плагины». Слот работает, только если манифест объявил "ui": {"rail": true} и человек
   * не снял «показывать в полосе» в карточке плагина; без этого регистрация ничего не показывает.
   */
  railSection(s: {
    id: string
    label: string
    icon: IconComponent
    render(live: Live): VNode | null
    /** Место среди разделов; встроенные — 100, 200 … 800 по порядку Rail. */
    order?: number
    badge?(live: Live): { text: string; alarm?: boolean } | null
  }): Dispose

  /** Плитка на «Доске» (ui/src/components/sections/Home.tsx:1124-1146). */
  boardTile(t: {
    id: string
    order?: number
    when(live: Live): boolean
    render(live: Live): VNode | null
  }): Dispose

  /** Редактор и представление своего вида выхода. */
  outputKind(k: OutputKindSlot): Dispose

  /** Шаг мастера первой настройки, ветка «через что» (ui/src/components/board/SetupWizard.tsx:23). */
  setupVia(v: {
    id: string
    label: string
    caption?: string
    /** Доступна ли ветка; строка — почему нет. */
    available(): Promise<true | string>
    /** Экран ветки; done(outputs) — выходы, куда пойдут правила мастера. */
    render(done: (outputs: string[]) => void): VNode | null
  }): Dispose

  /** Значок конфигурации выхода (ui/src/lib/badges.ts:33-44). */
  badge(b: {
    id: string
    group: 'proto' | 'transport' | 'security' | 'feature'
    /** Порядок внутри группы; меньше — левее. */
    rank?: number
    match(o: OutputV2, st: OutputStatus | undefined): { text: string; title?: string; warn?: boolean } | null
  }): Dispose

  /** Проверка в разделе «Диагностика». */
  diag(d: { id: string; label: string; run(): Promise<DiagResult[]> }): Dispose
}

export interface PluginSettingsSlot {
  /** Содержимое раскрытой карточки плагина во вкладке «Плагины». */
  render(ctx: PluginSettingsContext): VNode | null
  /** Строка состояния на свёрнутой карточке («Работает · 3 сайта обходятся»); null — общая строка хоста. */
  summary?(live: Live): { text: string; tone?: 'ok' | 'warn' | 'bad' | 'idle' } | null
}

export interface PluginSettingsContext {
  live: Live
  /** Свернуть карточку (как закрытие RuleEditor). */
  close(): void
  /** Карточка открыта в приложении для ПК: правки спеки — черновиком до «Сохранить» (как defer у RuleEditor). */
  readonly deferred: boolean
}

export interface OutputKindSlot {
  /** Имя вида в спеке: "warp", "tunnel:vless" (как kinds[].name манифеста). */
  kind: string
  label: string
  icon: IconComponent
  /** Новый выход этого вида (кнопка «Добавить»). */
  create(name: string): OutputV2
  /** Редактор; set — новое значение выхода (через core.edit). */
  editor(o: OutputV2, set: (o: OutputV2) => void, name: string): VNode | null
  /** Строка в списках выходов; нет — общая. */
  summary?(o: OutputV2, st: OutputStatus | undefined): VNode | null
  /** Раздел блока «Куда» правила (сейчас WARP вшит, ui/src/components/board/RuleTarget.tsx:74-138, 203-211). */
  ruleTarget?: {
    group: string
    /** Пилюля выхода в блоке «Куда». */
    pill?(name: string, o: OutputV2, st: OutputStatus | undefined): VNode | null
  }
  /** Выходы с owner этого выхода не показывать как самостоятельные туннели (члены разворота). */
  hidesOwned?: boolean
}

export interface DiagResult {
  id: string
  verdict: 'ok' | 'note' | 'warn' | 'fail'
  what: string
  why?: string
}

// ---------------------------------------------------------------------------------------------
// Темы: переменные панели (ui/src/index.css:48-153, ui/andromeda/tokens/colors.css)

/** Переменные --sp-* (ui/src/index.css:48-116 светлая, :118-153 тёмная). */
export type SpToken =
  | '--sp-background' | '--sp-foreground' | '--sp-card' | '--sp-card-foreground' | '--sp-rail'
  | '--sp-fg2' | '--sp-popover' | '--sp-popover-foreground' | '--sp-primary' | '--sp-primary-foreground'
  | '--sp-secondary' | '--sp-secondary-foreground' | '--sp-muted' | '--sp-muted-foreground'
  | '--sp-accent' | '--sp-accent-foreground' | '--sp-destructive' | '--sp-destructive-foreground'
  | '--sp-success' | '--sp-warning' | '--sp-warning-fg' | '--sp-info' | '--sp-border' | '--sp-input'
  | '--sp-ring' | '--sp-card-shadow' | '--sp-font-sans' | '--sp-font-mono' | '--radius'
  | '--sp-cb-wash' | '--sp-cb-edge' | '--sp-cb-ink' | '--sp-cb-ink-to' | '--sp-cbw-wash' | '--sp-cbw-ink'

/** Переменные --an-* дизайн-системы (семейства — docs/host-api.md, «Темы»). */
export type AnToken = `--an-${string}`

export interface Theme {
  id: string
  name: string
  light: Partial<Record<SpToken | AnToken, string>>
  dark?: Partial<Record<SpToken | AnToken, string>>
  /** Дополнительный CSS (только оформление). */
  css?: string
}

export interface Themes {
  register(t: Theme): Dispose
  /** Текущая тема и режим: auto — по фону LuCI или системе (ui/src/main.tsx:31-42). */
  current(): { id: string; mode: 'light' | 'dark' | 'auto' }
}

// ---------------------------------------------------------------------------------------------
// Навигация и настройки интерфейса плагина

export interface Nav {
  /** Открыть раздел: встроенный или зарегистрированный (событие splify:section, Console.tsx:118-128). */
  open(section: BuiltinSection | string): void
  /** Открыть вкладку «Плагины» с раскрытой карточкой плагина (по умолчанию — своего). */
  openPlugin(id?: string): void
}

/** Настройки интерфейса плагина (что развернуть, какой фильтр) — на роутере, у каждого плагина свои. */
export interface Prefs {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
}

// ---------------------------------------------------------------------------------------------
// Компоненты панели (ui/src/components/ui/*, formbits.tsx). Подписи — как у панели.

export interface ConfirmRequest {
  title: string
  body?: string
  confirmLabel?: string
  tone?: 'destructive' | 'default'
}

type Children = { children?: ComponentChildren }
type Cls = { className?: string }

export interface UiKit {
  Button: ComponentType<Children & Cls & {
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
    size?: 'default' | 'sm' | 'lg' | 'icon'
    disabled?: boolean
    type?: 'button' | 'submit'
    title?: string
    onClick?: (e: MouseEvent) => void
  }>
  Badge: ComponentType<Children & Cls & { variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'proto' }>
  Card: ComponentType<Children & Cls>
  CardContent: ComponentType<Children & Cls>
  Switch: ComponentType<{ on: boolean; label: string; onClick: () => void; disabled?: boolean }>
  Hint: ComponentType<Children & { tip: string }>
  ScreenHeader: ComponentType<{ title: string; back?: () => void; backLabel?: string; right?: ComponentChildren }>
  CardHead: ComponentType<{ title: string; meta?: ComponentChildren; action?: ComponentChildren }>
  Block: ComponentType<Children & Cls>
  Group: ComponentType<Children & { head?: ComponentChildren }>
  TapRow: ComponentType<{
    icon?: IconComponent
    title: ComponentChildren
    subtitle?: ComponentChildren
    note?: ComponentChildren
    right?: ComponentChildren
    onClick?: () => void
    alarm?: boolean
    dot?: 'ok' | 'warn' | 'bad' | 'idle'
    badges?: ComponentChildren
  }>
  KV: ComponentType<{ k: ComponentChildren; v: ComponentChildren }>
  ToggleRow: ComponentType<{ label: string; caption?: string; on: boolean; onToggle: () => void; disabled?: boolean; switchLabel?: string }>
  Segmented: <T extends string>(p: { items: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string }) => VNode
  Empty: ComponentType<{ icon: IconComponent; text: string; action?: ComponentChildren }>
  FieldRow: ComponentType<Children & { label: string; caption?: string }>
  Field: ComponentType<Children & { label: string }>
  Chip: ComponentType<Children & { on: boolean; onClick: () => void }>
  FileButton: ComponentType<{ accept: string; label: string; disabled?: boolean; onFile: (f: File) => void }>
  DangerButton: ComponentType<Children & { onClick: () => void; disabled?: boolean; full?: boolean; label?: string }>
  Meter: ComponentType<{ value: number; muted?: boolean }>
  Spark: ComponentType<{ points: readonly { t: number; up: number; down: number }[]; width?: number; height?: number; label?: string }>
  StateLine: ComponentType<Children & { ok: boolean | null }>
  /** Классы поля ввода панели (formbits.tsx:25). */
  readonly inputClass: string
  /** Флаг страны по коду ISO 3166-1. */
  Flag: ComponentType<{ cc: string; className?: string }>
}

// ---------------------------------------------------------------------------------------------
// Ответы бэкенда (rpcd splify2): это уже не пакет plugin-api, а договор панели с rpcd.
// Состав полей — `steer plugin list --json` (steer-api.md, plugin-list) плюс то, что берётся из манифеста.

/** Тема из манифеста (`themes[]`): JSON без кода. */
export interface ManifestTheme {
    name: string
    light: Record<string, string>
    dark?: Record<string, string>
    css?: string
}

/** Словарь хоста от плагина языка: `i18n.host.<язык>` манифеста. */
export interface ManifestHostLang {
    /** Код языка: "en". */
    lang: string
    name: string
    /** Адрес файла словаря (JSON «ns.key → строка»). */
    url: string
    /** Каким версиям панели он подходит: "^26.11". */
    host?: string
}

export interface PluginEntry {
    id: string
    name: string
    description?: string
    version: string
    repo: string
    trust: 'official' | 'third-party' | 'unsigned'
    type?: 'plugin' | 'library' | 'language' | 'theme'
    state: PluginState['state']
    /** Причина `failed`/`pending` или «нужен пакет…» — готовым текстом. */
    why?: string | null
    /** Доступная версия, новее стоящей. */
    update?: string
    /** Теги совместимости манифеста: {"host-api": "^1.0"}. */
    compat?: Record<string, string>
    /** Раздел `ui` манифеста; `base` — адрес каталога `ui/`. */
    ui?: { entry: string; css?: string[]; desktop?: boolean; rail?: boolean; base?: string }
    /** Показывать раздел плагина в полосе (карточка плагина, только если `ui.rail`). */
    rail_shown?: boolean
    /** Какие словари плагина есть (`i18n/<язык>.json`). */
    languages?: string[]
    /** Адрес каталога плагина — для словарей и файлов. Нет — по умолчанию из `id`. */
    root?: string
    themes?: ManifestTheme[]
    host_langs?: ManifestHostLang[]
    /** Виды выходов, которые плагин добавляет. */
    kinds?: string[]
    permissions?: string[]
    autoupdate?: boolean
    pinned?: boolean
    /** Системные пакеты, поставленные для плагина. */
    packages?: string[]
    /** Выходы спеки с видом плагина: удаление называет их. */
    used_by?: string[]
}

/** Ответ `plugins_list` как его отдаёт бэкенд (docs/rpcd-api.md): массивы менеджера как есть. Записи
 *  разбирает `normalize.ts` — форма вывода `steer plugin list --json` у менеджера уточняется. */
export interface PluginsListReply {
    ok?: boolean
    /** Версия host API панели, которую знает бэкенд (build-id.txt). */
    host_api?: string
    plugins: unknown[]
    repos?: unknown[]
    repos_error?: string
}

export interface CatalogEntry {
    id: string
    name: string
    description?: string
    version: string
    repo: string
    trust: PluginEntry['trust']
    /** Что добавит: виды, права. */
    kinds?: string[]
    permissions?: string[]
    /** Уже стоит. */
    installed?: boolean
    /** Размер архива, байт. */
    size?: number
}

export interface RepoEntry {
    /** Имя репозитория — по нему его убирают (`repo_del`). */
    name: string
    url: string
    official: boolean
    /** Номер ключа (отпечаток), если менеджер его отдаёт. */
    key_id?: string
}

/** Ход задания установки/обновления (`plugin_job`). */
export interface PluginJob {
    state: 'running' | 'done' | 'failed'
    /** Последняя строка менеджера. */
    progress?: string
    error?: string
    /** Ответ метода плагина — у задания, начатого `rpc.job`. */
    result?: unknown
}

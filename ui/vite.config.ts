import fs from "node:fs"
import path from "path"
import ts from "typescript"
import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"

/** Текстовый слой без цены на роутере.
 *
 *  В исходниках строки интерфейса живут в src/copy/ru.ts, а компоненты ссылаются на них
 *  (`S.home.dobavitPravilo`). В сборке так оставлять дорого: uhttpd не сжимает ответы, а
 *  имена свойств минификатор не сокращает — словарь с ключами и ссылки на него прибавляли
 *  к бандлу около 40 КБ при том же тексте.
 *
 *  Поэтому на сборке ссылки на ПРОСТЫЕ строки подставляются литералами прямо в код, а из
 *  словаря остаются только строки-функции (с числами и именами). Итог в dist — как до выноса
 *  текста: те же строки на тех же местах. Источник правды остаётся один — ru.ts. */

type Dict = Record<string, Record<string, unknown>>

function loadCopy(file: string): Dict {
    const src = fs.readFileSync(file, 'utf8')
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const mod = { exports: {} as Record<string, unknown> }
    new Function('module', 'exports', js)(mod, mod.exports)
    return mod.exports.ru as Dict
}

function inlineCopy(root: string): Plugin {
    const file = path.join(root, 'src/copy/ru.ts')
    let dict: Dict = {}
    return {
        name: 'splify-inline-copy',
        apply: 'build',
        enforce: 'pre',
        buildStart() {
            dict = loadCopy(file)
            this.addWatchFile(file)
        },
        transform(code, id) {
            if (id.includes('node_modules') || !/\.[jt]sx?$/.test(id)) return null
            if (path.resolve(id) === file) {
                // В словаре сборки — только функции: простые строки уже стоят в коде. Режется
                // по дереву разбора, а не пересобирается: функции ссылаются на помощников
                // модуля (plural), и они должны остаться на месте.
                const sf = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true)
                const cut: [number, number][] = []
                const visit = (n: ts.Node) => {
                    if (ts.isPropertyAssignment(n) && (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer))) {
                        let end = n.getEnd()
                        if (code[end] === ',') end++
                        cut.push([n.getFullStart(), end])
                        return
                    }
                    ts.forEachChild(n, visit)
                }
                visit(sf)
                let out = code
                for (const [a, b] of cut.reverse()) out = out.slice(0, a) + out.slice(b)
                return { code: out, map: null }
            }
            if (!code.includes('S.')) return null
            let changed = false
            const out = code.replace(/\bS\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\b(?!\s*\()/g, (m, ns, key) => {
                const v = dict[ns]?.[key]
                if (typeof v !== 'string') return m
                changed = true
                return JSON.stringify(v)
            })
            return changed ? { code: out, map: null } : null
        },
    }
}

export default defineConfig({
  // Адреса файлов сборки — ОТНОСИТЕЛЬНЫЕ. Под LuCI всё лежит в /luci-static/resources/splify2/,
  // а не в корне сайта, и шрифты из index.css (url(...)) должны искаться рядом со стилем.
  base: "./",
  plugins: [inlineCopy(__dirname), react()],
  define: {
    // Приписка к имени выпуска, которую печатает рельс: «26.9 Andromeda beta 1». Версия
    // пакета остаётся числом (VERSION: только цифры и точки — из неё собираются имя файла и
    // ?v= бандлов), а слова «beta 1» живут только в интерфейсе. Задаётся на сборке:
    //   SPLIFY_RELEASE_SUFFIX="beta 1" ./build.sh
    // Пусто — выпуск без приписки, и строка остаётся «26.9 Andromeda».
    __RELEASE_SUFFIX__: JSON.stringify(process.env.SPLIFY_RELEASE_SUFFIX ?? ""),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // ── React -> Preact at BUILD time (source stays plain React) ───────────
      // The dashboard is served by uhttpd, which does NOT gzip: whatever the
      // bundle weighs on disk is what every router client downloads, and it is
      // parsed by a router-class browser client over router-class Wi-Fi. The
      // React 19 vendor chunk alone was 236KB — bigger than the rest of the app,
      // the CSS and every icon combined, for a page whose entire UI is cards,
      // tables and buttons.
      //
      // preact/compat implements the same API surface we use (hooks, StrictMode,
      // createRoot, forwardRef via lucide-react) at roughly a fifth of the size.
      // Aliasing here rather than rewriting imports keeps every source file, and
      // the @types/react typings tsc checks against, exactly as they were — so
      // this is reversible by deleting these four lines.
      react: "preact/compat",
      "react-dom": "preact/compat",
      "react-dom/client": "preact/compat/client",
      "react/jsx-runtime": "preact/jsx-runtime",
    },
  },
  build: {
    // No <link rel=modulepreload> is ever emitted into a LuCI page — the loader
    // shim injects one <script type=module> by hand — so Vite's preload machinery
    // is dead weight here. Disabled outright rather than just skipping the
    // polyfill: it also emits a dependency table of BARE chunk names next to each
    // dynamic import, and those names carry no ?v=, so a stale cache could be
    // asked for the wrong copy of a lazily loaded tab.
    modulePreload: false,
    rollupOptions: {
      // Two independent SPA bundles, one per LuCI view: "Главная" (status
      // dashboard) and "Дополнительно" (settings, formerly a form.Map page).
      // One bundle: the new UI is a single dashboard with tabs, not two LuCI views.
      input: { index: path.resolve(__dirname, "index.html") },
      output: {
        entryFileNames: `splify-[name].js`,
        chunkFileNames: `splify-[name].js`,
        assetFileNames: (info) =>
          info.name?.endsWith('.css') ? 'splify-index.[ext]' : 'splify-[name].[ext]',
        // The shared chunk's NAME IS AN INTERFACE, not an implementation detail:
        // build.sh pins `splify-x.js?v=<version>` inside both entry bundles so a
        // stale HTTP cache can never pair a new entry with an old chunk. Left to
        // rollup, that name is derived from whichever module happens to lead the
        // shared graph (it silently became "splify-notify.js" when a new import
        // was added), and the pinning sed would quietly match nothing. So route
        // everything shared into one explicitly named chunk. scripts/check-dist.mjs
        // fails the build if the emitted file list ever drifts from this.
        manualChunks(id) {
          if (id.includes('node_modules')) return 'x'
          // Modules imported by BOTH the dashboard and the settings entry.
          // `validate` попал сюда в запуске 46: до подключения валидаторов к формам его не
          // импортировал никто, а теперь его читают и главный бандл (VlessPanel, ObfsPanel), и
          // ленивая вкладка правил (RuleEditor) — то есть он стал общим, и rollup выделил его в
          // собственный кусок `splify-validate.js`, у которого нет пина `?v=`. Барьер
          // scripts/check-dist.mjs это и остановил.
          // ВЕСЬ src/lib, а не перечень имён. Перечень отставал от графа импортов при каждой
          // новой связи: после того как опрос состояния стал читать окно применения (pending) и
          // адрес файлов сборки (assets), rollup выделил `splify-pending.js`, следом —
          // `splify-cache.js`, и каждый раз барьер останавливал сборку уже после того, как
          // кусок без пина `?v=` лежал в dist. Библиотека вся общая по смыслу: её читают и
          // главный бандл, и ленивые разделы.
          if (/[\\/]src[\\/]lib[\\/]/.test(id)) return 'x'
          if (/[\\/]src[\\/]components[\\/]ui[\\/]/.test(id)) return 'x'
          return undefined
        },
      }
    }
  }
})

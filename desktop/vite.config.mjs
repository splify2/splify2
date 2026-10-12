// Сборка окна приложения из исходников панели (ui/src).
//
// Запускается из каталога ui (`npm run renderer`): оттуда берутся vite, Tailwind и postcss
// панели с её же настройкой, а Tailwind ищет классы по ui/src относительно рабочего каталога.
// Своих копий этих пакетов у приложения нет — иначе в сборке оказались бы два preact, и хуки
// панели перестали бы работать.
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const UI = path.resolve(HERE, '../ui')
const uiRequire = createRequire(path.join(UI, 'package.json'))
const react = (await import(pathToFileURL(uiRequire.resolve('@vitejs/plugin-react')).href)).default
const mod = (name) => path.join(UI, 'node_modules', name)

export default {
    root: path.join(HERE, 'renderer'),
    base: './',
    publicDir: path.join(UI, 'public'),
    plugins: [react()],
    define: {
        __RELEASE_SUFFIX__: JSON.stringify(process.env.SPLIFY_RELEASE_SUFFIX ?? ''),
    },
    css: { postcss: UI },
    resolve: {
        alias: [
            { find: /^@\//, replacement: path.join(UI, 'src') + '/' },
            { find: /^@andromeda\/ui/, replacement: path.join(UI, 'andromeda') },
            // Тот же React → Preact, что у панели (ui/vite.config.ts), но путями до пакетов
            // панели: файлы desktop/renderer лежат вне ui, и голое имя оттуда не нашлось бы.
            { find: /^react-dom\/client$/, replacement: mod('preact/compat/client') },
            { find: /^react\/jsx-runtime$/, replacement: mod('preact/jsx-runtime') },
            { find: /^react\/jsx-dev-runtime$/, replacement: mod('preact/jsx-dev-runtime') },
            { find: /^react-dom$/, replacement: mod('preact/compat') },
            { find: /^react$/, replacement: mod('preact/compat') },
            { find: /^lucide-react$/, replacement: mod('lucide-react') },
        ],
    },
    build: {
        outDir: path.join(HERE, 'dist', 'renderer'),
        emptyOutDir: true,
        modulePreload: false,
        rollupOptions: {
            input: {
                index: path.join(HERE, 'renderer', 'index.html'),
                splash: path.join(HERE, 'renderer', 'splash.html'),
            },
        },
        chunkSizeWarningLimit: 4096,
    },
}

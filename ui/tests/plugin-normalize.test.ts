import { describe, expect, it } from 'vitest'
import { normalizeCatalog, normalizePlugin, normalizePlugins, normalizeRepos } from '@/plugins/normalize'

// Записи менеджера (`steer plugin list --json`) → модель панели. Разбор терпимый: поля плоские или в
// `manifest`, доверие выводится из репозитория.
const repos = normalizeRepos([
    { name: 'splify2', url: 'https://x', official: true },
    { name: 'mine', url: 'https://y', official: false },
])

describe('записи плагинов', () => {
    it('плоская запись: состояние, обновление, автообновление, доверие по репозиторию', () => {
        const p = normalizePlugin({ id: 'vless', version: '2.1.1', repo: 'mine', state: 'failed', why: 'нужен пакет kmod-tun', auto_update: false, update: '2.2.0' }, repos)!
        expect(p).toMatchObject({ id: 'vless', name: 'vless', version: '2.1.1', trust: 'third-party', state: 'failed', why: 'нужен пакет kmod-tun', autoupdate: false, update: '2.2.0' })
        expect(normalizePlugin({ id: 'a', repo: 'splify2' }, repos)!.trust).toBe('official')
        expect(normalizePlugin({ id: 'a', repo: 'ghost', unsigned: true }, repos)!.trust).toBe('unsigned')
    })

    it('поля манифеста — из вложенного manifest: ui, compat, виды, права, словари хоста, темы', () => {
        const p = normalizePlugin({
            id: 'lang-en', version: '1.0.0', repo: 'splify2', state: 'enabled',
            manifest: {
                name: 'English', type: 'language', compat: { 'host-api': '^1.0' },
                ui: { entry: 'ui/index.js', css: ['ui/s.css'], rail: true },
                i18n: { languages: ['ru'], host: { en: { file: 'i18n/host/en.json', name: 'English', host: '^26.11' } } },
                steer: { kinds: [{ name: 'warp' }] }, permissions: { net: true, nft: false },
                themes: [{ name: 'Неон', light: { '--sp-primary': '#f0f' } }],
            },
        }, repos)!
        expect(p.name).toBe('English')
        expect(p.type).toBe('language')
        expect(p.compat).toEqual({ 'host-api': '^1.0' })
        expect(p.ui).toMatchObject({ entry: 'ui/index.js', css: ['ui/s.css'], rail: true })
        expect(p.kinds).toEqual(['warp'])
        expect(p.permissions).toEqual(['net'])
        expect(p.host_langs).toEqual([{ lang: 'en', name: 'English', url: '/luci-static/resources/splify2/plugins/lang-en/i18n/host/en.json', host: '^26.11' }])
        expect(p.themes?.[0].name).toBe('Неон')
        expect(p.languages).toEqual(['ru'])
    })

    it('мусор отбрасывается, а не роняет список', () => {
        expect(normalizePlugins([null, 5, { nope: 1 }, { id: 'ok' }], repos).map((p) => p.id)).toEqual(['ok'])
        expect(normalizePlugins(undefined, repos)).toEqual([])
        expect(normalizeRepos('x')).toEqual([])
    })

    it('каталог: установленный помечен, права и виды названы', () => {
        const c = normalizeCatalog([{ id: 'w', version: '1', repo: 'mine', installed: true, kinds: ['warp'], size: 10 }], repos)
        expect(c).toEqual([expect.objectContaining({ id: 'w', trust: 'third-party', installed: true, kinds: ['warp'], size: 10 })])
    })

    it('официальный репозиторий узнаётся и без флага — по имени splify2', () => {
        expect(normalizeRepos([{ name: 'splify2', url: 'u' }])[0].official).toBe(true)
        expect(normalizeRepos([{ name: 'other', url: 'u' }])[0].official).toBe(false)
    })
})

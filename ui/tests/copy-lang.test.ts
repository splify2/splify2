import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error — скрипт сборки на чистом JS
import { extract } from '../scripts/copy-dict.mjs'
import { format, pluralForm } from '@/copy/format'

// Язык панели: словарь «ns.key → строка» строится из ru.ts, перевод — тем же набором ключей и
// плейсхолдеров, а в рантайме подменяет строки поверх вшитого русского.

const dir = join(process.cwd(), 'src', 'copy')
const ruJson = JSON.parse(readFileSync(join(dir, 'ru.json'), 'utf8')) as Record<string, string>
const enJson = JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8')) as Record<string, string>
const slots = (s: string) => [...s.matchAll(/\{(\d+)/g)].map((m) => m[1]).sort().join(',')

describe('словарь хоста', () => {
    it('ru.json совпадает с ru.ts (node scripts/copy-dict.mjs его обновляет)', () => {
        expect(extract().dict).toEqual(ruJson)
    })

    it('английский: ключи — из русского, плейсхолдеры те же, формы числа — две', () => {
        const extra = Object.keys(enJson).filter((k) => !(k in ruJson))
        expect(extra).toEqual([])
        const badSlots = Object.keys(enJson).filter((k) => slots(enJson[k]) !== slots(ruJson[k]))
        expect(badSlots).toEqual([])
        const badForms = Object.entries(enJson).filter(([, v]) => [...v.matchAll(/\{\d+#((?:\\.|[^}\\])*)\}/g)].some((m) => m[1].split('|').length !== 2))
        expect(badForms.map(([k]) => k)).toEqual([])
    })

    it('английский покрывает словарь целиком', () => {
        expect(Object.keys(ruJson).filter((k) => !(k in enJson))).toEqual([])
    })
})

describe('шаблоны', () => {
    it('подстановка и число со словом нужной формы', () => {
        expect(format('Серверов: {0}, {1}', [3, 'ок'], 'ru')).toBe('Серверов: 3, ок')
        const ru = '{0#подписка|подписки|подписок}'
        expect([1, 2, 5, 11, 21].map((n) => format(ru, [n], 'ru'))).toEqual(['1 подписка', '2 подписки', '5 подписок', '11 подписок', '21 подписка'])
        expect([1, 2].map((n) => format('{0#node|nodes}', [n], 'en'))).toEqual(['1 node', '2 nodes'])
        expect(format('a \\{0\\} {0}', [7], 'en')).toBe('a {0} 7')
    })
    it('pluralForm — слово без числа', () => {
        expect(pluralForm('en', 1, ['node', 'nodes'])).toBe('node')
        expect(pluralForm('en', 0, ['node', 'nodes'])).toBe('nodes')
        expect(pluralForm('ru', 3, ['узел', 'узла', 'узлов'])).toBe('узла')
    })
})

describe('выбор языка', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.resetModules()
    })

    it('по умолчанию — русский, S — сам вшитый объект', async () => {
        const c = await import('@/copy')
        const { ru } = await import('@/copy/ru')
        expect(c.LANG).toBe('ru')
        expect(c.S).toBe(ru)
    })

    it('английский: строки и строки-функции по словарю, непереведённое — по-русски', async () => {
        localStorage.setItem('splify2.lang', 'en')
        const { S, LANG } = await import('@/copy')
        expect(LANG).toBe('en')
        expect(S.confirm.cancel).toBe(enJson['confirm.cancel'])
        expect(S.confirm.cancel).not.toBe('Отмена')
        expect(S.backupCard.arhivNastroekSohranenKb(5)).toBe(enJson['backupCard.arhivNastroekSohranenKb'].replace('{0}', '5'))
        // вложенный объект (подписи модулей) и функция, которую в шаблон не свести, остаются прежними
        expect(S.modules.label.vless).toBe('VLESS')
        expect(S.dns.http('h2')).toBe(' · HTTP/2')
    })

    it('словарь, принесённый плагином языка, перекрывает вшитый и попадает в список языков', async () => {
        const first = await import('@/copy')
        first.registerHostDict('de', 'Deutsch', { 'confirm.cancel': 'Abbrechen' })
        expect(first.availableLangs().map((l) => l.id)).toEqual(['ru', 'en', 'de'])
        localStorage.setItem('splify2.lang', 'de')
        vi.resetModules()
        const { S } = await import('@/copy')
        expect(S.confirm.cancel).toBe('Abbrechen')
        expect(S.confirm.confirm).toBe('Подтвердить') // нет в словаре — русский
    })

    it('setLang запоминает язык и перезагружает панель; русский — снимает запись', async () => {
        const reload = vi.fn()
        vi.stubGlobal('location', { ...window.location, reload })
        try {
            const { setLang } = await import('@/copy')
            setLang('en')
            expect(localStorage.getItem('splify2.lang')).toBe('en')
            setLang('ru')
            expect(localStorage.getItem('splify2.lang')).toBeNull()
            expect(reload).toHaveBeenCalledTimes(2)
        } finally {
            vi.unstubAllGlobals()
        }
    })
})

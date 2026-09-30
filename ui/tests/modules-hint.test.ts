import { describe, expect, it } from 'vitest'
import { missingModule } from '@/lib/engine'

// Модули движка 2.0 — отдельные пакеты. Экран называет недостающий пакет, но только когда
// бэкенд сообщил список установленных: нет списка — утверждать нечего.

describe('какого модуля не хватает выходу', () => {
    const mods = ['vless', 'xsteer']
    it('туннель hysteria2 без модуля — пакет steer-hysteria2', () => {
        expect(missingModule({ kind: 'hysteria2' }, mods)).toBe('hysteria2')
    })
    it('установленный модуль ничего не просит', () => {
        expect(missingModule({ kind: 'vless' }, mods)).toBeNull()
        expect(missingModule({ kind: 'xsteer' }, mods)).toBeNull()
    })
    it('интерфейс с обфускацией просит steer-obfs, без неё — ничего', () => {
        expect(missingModule({ kind: 'interface', obfs: { server: 'a:1', listen: 'b:2' } }, mods)).toBe('obfs')
        expect(missingModule({ kind: 'interface' }, mods)).toBeNull()
    })
    it('выходы без помощника модуля не просят', () => {
        for (const kind of ['direct', 'group', 'awg', 'zapret']) expect(missingModule({ kind }, [])).toBeNull()
    })
    it('списка модулей нет — не утверждаем', () => {
        expect(missingModule({ kind: 'hysteria2' }, undefined)).toBeNull()
    })
})

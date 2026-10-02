import { describe, expect, it } from 'vitest'
import { missingModule, specV2Unsupported } from '@/lib/engine'
import type { Status } from '@/lib/model'

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

describe('читает ли движок спеку v2', () => {
    const st = (features?: string[]) => ({ features }) as unknown as Status
    /* Перечни умений дословно: 1.5.9 — src/steer.c тега v1.5.9, 2.0 — src/daemon/status.c. */
    const v159 = ['lan_devices', 'nodes', 'pool', 'active_device', 'status_cache', 'xslink', 'xsteer_state', 'spec_schema2', 'awg', 'via']
    const v200 = [...v159, 'failed', 'groups']
    it('ядро 1.5.9: spec_schema2 есть (это вторая схема спеки v1), groups нет — не читает', () => {
        expect(specV2Unsupported(st(v159))).toBe(true)
    })
    it('ядро 2.0 — читает', () => {
        expect(specV2Unsupported(st(v200))).toBe(false)
    })
    it('перечня нет — утверждать нечего', () => {
        expect(specV2Unsupported(st(undefined))).toBe(false)
        expect(specV2Unsupported(null)).toBe(false)
    })
})

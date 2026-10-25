/** Реестр слотов: точки, куда встраивается интерфейс (host-api.md, «Слоты»).
 *
 *  Один реестр на всех: встроенные разделы панели регистрируются в нём же (владелец `host`),
 *  плагины — через `host.slots.*`. Владелец записи нужен, чтобы снять все регистрации плагина разом
 *  (отключение, ошибка в `activate`, удаление) и чтобы предохранитель знал, чей слот упал.
 *
 *  Хранилище внешнее, а не состояние компонента: слоты читают и рельс, и доска, и редактор, а
 *  регистрируют их позже монтирования — после ответа `plugins_list`. Подписка — `useRegistry()`. */
import { useSyncExternalStore } from 'react'

export type SlotName = 'section' | 'boardTile' | 'outputKind' | 'setupVia' | 'badge' | 'diag' | 'pluginSettings'

export interface Reg<T = unknown> {
    /** Владелец: `host` — сама панель, иначе id плагина. */
    owner: string
    /** Уникален среди записей слота у владельца. */
    id: string
    order: number
    value: T
}

export const HOST_OWNER = 'host'

type Listener = () => void

class Registry {
    private slots = new Map<SlotName, Reg[]>()
    private listeners = new Set<Listener>()
    private ver = 0

    private bump() {
        this.ver++
        for (const l of [...this.listeners]) l()
    }

    /** Записать; та же пара (владелец, id) заменяет прежнюю. Возвращает отмену. */
    register<T>(slot: SlotName, owner: string, id: string, value: T, order = 1000): () => void {
        const list = (this.slots.get(slot) ?? []).filter((r) => !(r.owner === owner && r.id === id))
        const reg: Reg<T> = { owner, id, order, value }
        list.push(reg)
        list.sort((a, b) => a.order - b.order)
        this.slots.set(slot, list)
        this.bump()
        return () => {
            const cur = this.slots.get(slot)
            if (!cur || !cur.includes(reg as Reg)) return
            this.slots.set(slot, cur.filter((r) => r !== (reg as Reg)))
            this.bump()
        }
    }

    list<T>(slot: SlotName): Reg<T>[] {
        return (this.slots.get(slot) ?? []) as Reg<T>[]
    }

    get<T>(slot: SlotName, owner: string, id?: string): Reg<T> | undefined {
        return this.list<T>(slot).find((r) => r.owner === owner && (id === undefined || r.id === id))
    }

    /** Снять всё, что записал владелец (отключение плагина). */
    clearOwner(owner: string): void {
        let changed = false
        for (const [slot, list] of this.slots) {
            const rest = list.filter((r) => r.owner !== owner)
            if (rest.length !== list.length) { this.slots.set(slot, rest); changed = true }
        }
        if (changed) this.bump()
    }

    subscribe(l: Listener): () => void {
        this.listeners.add(l)
        return () => this.listeners.delete(l)
    }

    version(): number { return this.ver }
}

export const registry = new Registry()

/** Перерисовка компонента при любой смене реестра. Возвращает номер версии. */
export function useRegistry(): number {
    return useSyncExternalStore((cb) => registry.subscribe(cb), () => registry.version())
}

import { House, ListTree, Lock, Puzzle, Route, Settings, ShieldCheck, Stethoscope } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { HOST_OWNER, registry, useRegistry, type Reg } from '@/plugins/registry'
import type { Live } from '@/lib/live'
import { S } from '@/copy'
/** Разделы пульта. Отдельным файлом, а не в оболочке: тип нужен и рельсу, и каждому разделу,
 *  который умеет отправить человека в соседний («выход собирается во вкладке VPN»), а импорт
 *  из оболочки в её же ребёнка — это круг.
 *
 *  Разделы — записи реестра слотов (plugins/registry.ts): встроенные регистрируются здесь тем же
 *  вызовом, что и `railSection` плагина (host-api.md, «Слоты»), поэтому закрытого объединения нет —
 *  `SectionId` открыт для разделов, которые приносят плагины и оболочка. */
export type BuiltinSectionId = 'home' | 'rules' | 'vpn' | 'dns' | 'requests' | 'diag' | 'plugins' | 'settings'
export type SectionId = BuiltinSectionId | (string & {})

/** Заголовки встроенных разделов. Здесь, а не в рельсе, потому что раздел печатает своё имя сам —
 *  и оно обязано совпадать с пунктом рельса дословно. */
export const SECTION_TITLE: Record<BuiltinSectionId, string> = {
    home: S.sections.glavnaya,
    rules: S.sections.pravila,
    vpn: 'VPN',
    dns: 'DNS',
    requests: S.sections.zaprosy,
    diag: S.sections.diagnostika,
    plugins: S.sections.plaginy,
    settings: S.sections.nastroyki,
}

export type SectionIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>

/** Запись раздела в реестре. У встроенных `render` нет — раздел рисует оболочка по имени. */
export interface SectionItem {
    id: string
    /** Подпись в рельсе. */
    label: string
    icon: SectionIcon
    /** Раздел плагина (`railSection`): его же и рисует. */
    plugin?: string
    render?: (live: Live) => ReactNode
    badge?: (live: Live) => { text: string; alarm?: boolean } | null
}

const BUILTIN: { id: BuiltinSectionId; label: string; icon: SectionIcon }[] = [
    { id: 'home', label: S.rail.glavnaya, icon: House },
    { id: 'rules', label: S.rail.pravila, icon: Route },
    { id: 'vpn', label: 'VPN', icon: ShieldCheck },
    { id: 'dns', label: 'DNS', icon: Lock },
    { id: 'requests', label: S.rail.zaprosy, icon: ListTree },
    { id: 'diag', label: S.rail.diagnostika, icon: Stethoscope },
    { id: 'plugins', label: S.rail.plaginy, icon: Puzzle },
    { id: 'settings', label: S.rail.nastroyki, icon: Settings },
]

// Порядок — 100, 200 … 800, как в host-api.md: раздел плагина встаёт между ними по своему `order`.
BUILTIN.forEach((s, i) => registry.register<SectionItem>('section', HOST_OWNER, s.id, s, (i + 1) * 100))

/** Разделы в порядке рельса: встроенные и принесённые плагинами. */
export function useSections(): Reg<SectionItem>[] {
    useRegistry()
    return registry.list<SectionItem>('section')
}

export function sectionTitle(id: string): string | undefined {
    if (id in SECTION_TITLE) return SECTION_TITLE[id as BuiltinSectionId]
    return registry.list<SectionItem>('section').find((r) => r.value.id === id)?.value.label
}

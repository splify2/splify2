import { useSyncExternalStore } from 'react'
import { Block, CardHead, FieldRow, Segmented } from '@/components/ui/layout'
import { inputCls } from '@/components/formbits'
import { availableLangs, LANG, setLang } from '@/copy'
import { currentTheme, listThemes, setTheme, subscribeThemes } from '@/plugins/themes'
import { S } from '@/copy'

/** «Настройки → Интерфейс»: язык панели и оформление.
 *
 *  Язык меняется перезагрузкой панели (строки читаются при подключении модулей): выбрал — страница
 *  открылась на новом языке. Список — русский, вшитые и принесённые плагинами языка (lang-en…).
 *  Тема появляется, когда плагин принёс хотя бы одну; режим «как у страницы / светлый / тёмный» —
 *  всегда (host-api.md, «Темы»). */
export default function AppearanceCard() {
    const t = useSyncExternalStore(subscribeThemes, () => JSON.stringify(currentTheme()) + listThemes().length)
    void t
    const cur = currentTheme()
    const langs = availableLangs()
    const themes = listThemes()
    return (
        <Block>
            <CardHead title={S.appearance.title} />
            {langs.length > 1 && (
                <div className="space-y-1.5 py-1">
                    <div className="text-sm text-subtle">{S.appearance.yazyk}</div>
                    <Segmented
                        label={S.appearance.yazyk}
                        items={langs.map((l) => ({ value: l.id, label: l.name }))}
                        value={LANG}
                        onChange={(v) => { if (v !== LANG) setLang(v) }}
                    />
                </div>
            )}
            {themes.length > 1 && (
                <FieldRow label={S.appearance.tema}>
                    <select
                        aria-label={S.appearance.tema}
                        className={`${inputCls} w-full`}
                        value={cur.id}
                        onChange={(e) => setTheme({ id: e.currentTarget.value })}
                    >
                        {themes.map((x) => <option key={x.id} value={x.id}>{x.name || S.appearance.standartnaya}</option>)}
                    </select>
                </FieldRow>
            )}
            <div className="space-y-1.5 py-1">
                <div className="text-sm text-subtle">{S.appearance.rezhim}</div>
                <Segmented
                    label={S.appearance.rezhim}
                    items={[
                        { value: 'auto', label: S.appearance.kakUStranicy },
                        { value: 'light', label: S.appearance.svetlyy },
                        { value: 'dark', label: S.appearance.tyomnyy },
                    ]}
                    value={cur.mode}
                    onChange={(v) => setTheme({ mode: v })}
                />
            </div>
        </Block>
    )
}

import { useEffect, useState } from 'react'
import { Block, CardHead } from '@/components/ui/layout'
import { Switch } from '@/components/ui/switch'
import { rpc } from '@/lib/rpc'
import { notify } from '@/lib/notify'

import { S } from '@/copy'
/** Чем роутер качает списки и обновления.
 *
 *  ЗАЧЕМ ЭТО ВЫБОР ЧЕЛОВЕКА, А НЕ АВТОМАТИКА. По умолчанию туннель стоит последним: сначала
 *  прямой адрес, потом те же файлы с хостов самого GitHub. Роутеру, у которого издатель
 *  доступен, менять нечего. Но там, где провайдер закрыл `githubusercontent.com` насовсем
 *  (splify2#15), автоматика каждый раз проходит две ступени впустую, а вторая в худшем случае
 *  тянет архив ветки целиком ради одного списка. Человек знает про свою сеть больше нас и
 *  вправе сказать «ходи сразу через туннель»: тогда файл едет по прямому адресу одним запросом.
 *
 *  Имя выхода показано рядом с выбором, а не спрятано в подсказке: без поднятого выхода
 *  «через туннель» не даст ничего, и знать это надо ДО того, как человек его выберет. */

/** Переключатель принадлежит человеку и значит ровно то, что написано: включено — качать
 *  через туннель, выключено — не трогать туннель. Третьего состояния нет: «мы сами решим,
 *  если не вышло» — это не выбор человека, а наша самодеятельность у него за спиной.
 *
 *  Через туннель идёт ВСЁ, что роутер берёт из интернета: списки, манифест каталога и пакеты
 *  при обновлении движка и интерфейса. Названо это на экране так же — «списки и обновления»,
 *  — потому что переключатель один и настройка одна: делить их значило бы завести вторую. */
type Mode = 'always' | 'off'

export default function FetchCard() {
    const [mode, setMode] = useState<Mode | null>(null)
    const [out, setOut] = useState('')
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        rpc.fetchMode()
            .then((r) => {
                setMode(r.mode === 'always' ? 'always' : 'off')
                setOut(r.out || '')
            })
            .catch(() => setMode('off'))
    }, [])

    async function choose(next: Mode) {
        if (next === mode || busy) return
        const prev = mode
        setMode(next)
        setBusy(true)
        try {
            const r = await rpc.fetchModeSet(next)
            if (!r.ok) throw new Error(r.error || S.fetchCard.neSohranilos)
            notify(S.fetchCard.sohraneno)
        } catch (e) {
            // Возврат к прежнему значению обязателен: иначе на экране остаётся выбор,
            // которого на роутере нет, и человек уверен, что настроил.
            setMode(prev)
            notify(String(e instanceof Error ? e.message : e), 'error')
        } finally {
            setBusy(false)
        }
    }

    const on = mode === 'always'

    return (
        <Block>
                <CardHead title={S.fetchCard.skachivanie} />
                <div className="flex flex-row-reverse items-start justify-between gap-3">
                    <Switch
                        on={on}
                        label={S.fetchCard.skachivatSpiskiIObnovleniya}
                        disabled={busy || mode === null}
                        onClick={() => void choose(on ? 'off' : 'always')}
                    />
                    <div className="min-w-0">
                        <div className="text-[13px]">{S.fetchCard.skachivatSpiskiIObnovleniya}</div>
                        {/* Вторая строка — состояние, а не пояснение: включённый выключатель без
                            поднятого выхода ничего не даст, и знать это надо здесь, а не после. */}
                        {/* Ровно состояние, и ничего про то, как мы решаем сами: включатель
                            принадлежит человеку. Выключено — строки нет вовсе. */}
                        {on && (
                            <div className="text-xs text-muted-foreground">
                                {out ? (
                                    <>{S.fetchCard.poydetCherezVyhod} <span className="font-medium text-foreground">{out}</span></>
                                ) : (
                                    <span className="text-warning-fg">{S.fetchCard.podnyatogoVyhodaSeychasNet}</span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
        </Block>
    )
}

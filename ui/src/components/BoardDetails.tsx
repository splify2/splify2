import { useEffect, useId, useRef, useState } from 'react'
import { Check, Copy, Eye, EyeOff, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { S } from '@/copy'

/** В свернутом виде — одна строка; полный набор никогда не теряется за overflow.
 * Измеряем реальные подписи, включая счетчик: длинный первый бейдж не вытесняет «ещё».
 * Панель раскрывается поверх сетки, не меняя высоту соседних карточек. */
export function BoardLabels({ labels }: { labels: string[] }) {
    const host = useRef<HTMLDivElement>(null)
    const trigger = useRef<HTMLButtonElement>(null)
    const id = useId()
    const [count, setCount] = useState(0)
    const [open, setOpen] = useState(false)
    const [above, setAbove] = useState(false)
    const key = JSON.stringify(labels)
    useEffect(() => {
        const el = host.current
        if (!el) return
        function measure() {
            const samples = [...el!.querySelectorAll<HTMLElement>('[data-label-measure]')]
            const reserve = el!.querySelector<HTMLElement>('[data-count-measure]')?.offsetWidth ?? 70
            let used = 0, n = 0
            for (let i = 0; i < samples.length; i++) {
                const next = samples[i].offsetWidth + (i ? 4 : 0)
                if (used + next + (i < samples.length - 1 ? reserve + 4 : 0) > el!.clientWidth) break
                used += next
                n++
            }
            setCount(n)
        }
        measure()
        /* Под LuCI панель открывает любой браузер роутера, в том числе старый WebView без наблюдателя
         * размера (main.tsx защищается так же): без него число меток считается один раз. */
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
        observer?.observe(el)
        // Шрифт может приехать после первого измерения.
        let stopped = false
        document.fonts?.ready.then(() => { if (!stopped) measure() })
        return () => { stopped = true; observer?.disconnect() }
    }, [key])
    useEffect(() => {
        if (!open) return
        const position = () => {
            const rect = host.current?.getBoundingClientRect()
            if (rect) setAbove(window.innerHeight - rect.bottom < 270 && rect.top > window.innerHeight - rect.bottom)
        }
        position()
        window.addEventListener('resize', position)
        document.addEventListener('scroll', position, true)
        const outside = (e: PointerEvent) => { if (!host.current?.contains(e.target as Node)) setOpen(false) }
        const escape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus() }
        }
        document.addEventListener('pointerdown', outside)
        host.current?.addEventListener('keydown', escape)
        const el = host.current
        return () => { document.removeEventListener('pointerdown', outside); el?.removeEventListener('keydown', escape); window.removeEventListener('resize', position); document.removeEventListener('scroll', position, true) }
    }, [open])
    return (
        <div ref={host} className="sp-board-labels">
            <div className="sp-board-label-measure" aria-hidden="true">
                {labels.map((label) => <Badge key={label} variant="proto" data-label-measure><span className="truncate">{label}</span></Badge>)}
                <span data-count-measure>{S.home.escheSpiskov(labels.length)}</span>
            </div>
            <div className="sp-board-label-line">
                {labels.slice(0, count).map((label) => <Badge key={label} variant="proto" title={label}><span className="truncate">{label}</span></Badge>)}
                {count < labels.length && <button ref={trigger} type="button" className="sp-board-more bg-transparent" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>{S.home.escheSpiskov(labels.length - count)}</button>}
                {!labels.length && <span className="text-xs text-muted-foreground">{S.rulesTab.servisNeVybran}</span>}
            </div>
            {open && <div id={id} className="sp-board-list-panel" data-above={above || undefined} role="region" aria-label={S.home.vybrannyeSpiski}>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">{S.home.vybrannyeSpiski} · {labels.length}</span>
                    <button type="button" className="sp-board-icon bg-transparent" aria-label={S.home.zakrytSpiski} onClick={() => { setOpen(false); trigger.current?.focus() }}><X className="h-4 w-4" /></button>
                </div>
                <ul>{labels.map((label) => <li key={label}>{label}</li>)}</ul>
            </div>}
        </div>
    )
}

/** Адрес по-прежнему скрыт до нажатия; IPv6 переносится, а не теряется за многоточием. */
export function BoardAddress({ ip }: { ip?: string }) {
    const [shown, setShown] = useState(false)
    const [copied, setCopied] = useState(false)
    const [failed, setFailed] = useState(false)
    useEffect(() => { setShown(false); setCopied(false); setFailed(false) }, [ip])
    useEffect(() => {
        if (!copied) return
        const timer = setTimeout(() => setCopied(false), 1800)
        return () => clearTimeout(timer)
    }, [copied])
    if (!ip) return null
    async function copy() {
        try { await navigator.clipboard.writeText(ip!); setCopied(true); setFailed(false) }
        catch { setFailed(true) }
    }
    return <div className="sp-board-address">
        <span className="sp-board-address-value" aria-hidden={!shown}>{shown ? ip : S.home.adresSkryt}</span>
        <button type="button" className="sp-board-icon bg-transparent" aria-label={shown ? S.outputCards.skrytVneshniyAdres : S.outputCards.pokazatVneshniyAdres} onClick={() => setShown((s) => !s)}>{shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
        {shown && <button type="button" className="sp-board-icon bg-transparent" aria-label={copied ? S.home.adresSkopirovan : S.home.skopirovatAdres} onClick={() => void copy()}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</button>}
        <span className={failed ? 'sp-board-copy-error' : 'sr-only'} role="status">{failed ? S.home.neSkopirovan : copied ? S.home.adresSkopirovan : ''}</span>
    </div>
}

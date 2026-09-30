import { render, screen, waitFor, fireEvent } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Zapret from '@/components/sections/Zapret'
import { rpc } from '@/lib/rpc'

// splify2#34. Стратегия семейства YouTube (Yv) — не основная, а СЛОЙ поверх неё: применённая
// всему роутеру, она ложится в пачку NFQWS_OPT рядом с основной, и zapret_state называет её
// полем layers.youtube. Вкладка же смотрела только на `active`, и применённая Yv нигде не
// отмечалась: ни в кнопке «Весь роутер», ни галочкой в списке, а «Применить» у неё оставалось
// нажимаемым — человек видел сообщение «Применена», и ничего на экране не менялось.

const game = { gv: '', xtreme: false, fake: '', fakes: [] }
const state = {
    installed: true, running: true, enabled: true, version: '72.20260307', curl: true,
    strategies: 3, updated: Math.floor(Date.now() / 1000) - 3600,
    active: 'v5', drifted: false, game,
    layers: { youtube: '03', discord: '' },
}
const cat = {
    active: 'v5',
    updated: state.updated,
    strategies: [
        { name: 'v5', family: 'v' as const, layer: 'main' as const },
        { name: 'Yv01', family: 'yv' as const, layer: 'youtube' as const },
        { name: 'Yv03', family: 'yv' as const, layer: 'youtube' as const },
    ],
    outputs: [],
}

describe('Zapret: слой YouTube всего роутера', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'zapretState').mockResolvedValue(state as never)
        vi.spyOn(rpc, 'zapretStrategies').mockResolvedValue(cat as never)
        vi.spyOn(rpc, 'zapretResults').mockResolvedValue({ at: 0, targets: 0, baseline: 0, scope: 'all', results: [] } as never)
        vi.spyOn(rpc, 'zapretTest').mockResolvedValue({ state: 'idle', running: false, results_at: 0 } as never)
    })

    it('применённый слой назван в кнопке «Весь роутер»', async () => {
        render(<Zapret />)
        const chip = await waitFor(() => screen.getByRole('button', { name: /Весь роутер/ }))
        expect(chip.textContent).toContain('v5')
        expect(chip.textContent).toContain('Yv03')
    })

    it('и отмечен в своём семействе: «применена», галочка, «Применить» не нажимается', async () => {
        render(<Zapret />)
        const fam = await waitFor(() => screen.getByRole('button', { name: /развернуть YouTube/ }))
        expect(fam.textContent).toContain('применена Yv03')
        fireEvent.click(fam)
        const row = (name: string) => screen.getByRole('button', { name }).closest('div')!.parentElement!
        await waitFor(() => expect(row('Yv03').className).toContain('bg-primary/10'))
        expect(row('Yv01').className).not.toContain('bg-primary/10')
        const apply = (name: string) =>
            row(name).querySelector('button:last-of-type') as HTMLButtonElement
        expect(apply('Yv03').disabled).toBe(true)
        expect(apply('Yv01').disabled).toBe(false)
    })
})

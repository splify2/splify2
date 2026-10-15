import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RulesTab from '@/components/tabs/RulesTab'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { type Spec } from '@/lib/model'
import { live } from './fixtures'

// Приложение для ПК (board): правило правится черновиком. На роутер (pending.edit → применение)
// уходит только «Сохранить»/«Создать»; стрелка назад и уход по рельсу (размонтирование) черновик
// отбрасывают, новое правило без «Создать» не заводится.

const OUT = { name: 'awg', kind: 'interface' as const, device: 'awg0', on_fail: 'drop' as const }
const BASE: Spec = {
    outputs: { awg: OUT, direct: { name: 'direct', kind: 'direct' } },
    channels: [{ name: 'YouTube', out: 'awg', match: { prefixes_files: ['/etc/steer/lists/yt.lst'] } }],
} as unknown as Spec

function mount(props: Record<string, unknown>) {
    vi.spyOn(rpc, 'manifest').mockResolvedValue({} as never)
    vi.spyOn(rpc, 'localLists').mockResolvedValue({ files: {} } as never)
    vi.spyOn(rpc, 'leases').mockResolvedValue({ leases: [] } as never)
    vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
    vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
    vi.spyOn(pending, 'load').mockResolvedValue(BASE as never)
    const edits: Spec[] = []
    vi.spyOn(pending, 'edit').mockImplementation(((s: Spec) => { edits.push(s) }) as never)
    const closed = vi.fn()
    const r = render(<RulesTab live={live({ status: { outputs: BASE.outputs } as never })} board onClosed={closed} {...props} />)
    return { edits, closed, ...r }
}

const nameInput = () => screen.getByDisplayValue('YouTube') as HTMLInputElement

describe('черновик правила в приложении для ПК', () => {
    beforeEach(() => { vi.restoreAllMocks() })

    it('правка без «Сохранить» на роутер не уходит; стрелка назад её отбрасывает', async () => {
        const { edits, closed } = mount({ editNow: 0, onEditUsed: () => {} })
        await waitFor(() => nameInput())
        fireEvent.input(nameInput(), { target: { value: 'YouTube 2' } })
        await new Promise((r) => setTimeout(r, 30))
        expect(edits).toHaveLength(0)
        fireEvent.click(screen.getByRole('button', { name: /все правила|назад/i }))
        await new Promise((r) => setTimeout(r, 30))
        expect(edits).toHaveLength(0)
        expect(closed).toHaveBeenCalled()
    })

    it('«Сохранить» записывает правку одним разом', async () => {
        const { edits } = mount({ editNow: 0, onEditUsed: () => {} })
        await waitFor(() => nameInput())
        fireEvent.input(nameInput(), { target: { value: 'Видео' } })
        fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
        await waitFor(() => expect(edits).toHaveLength(1))
        expect(edits[0].channels[0].name).toBe('Видео')
    })

    it('уход по рельсу (размонтирование) не сохраняет', async () => {
        const { edits, unmount } = mount({ editNow: 0, onEditUsed: () => {} })
        await waitFor(() => nameInput())
        fireEvent.input(nameInput(), { target: { value: 'X' } })
        unmount()
        await new Promise((r) => setTimeout(r, 30))
        expect(edits).toHaveLength(0)
    })

    it('новое правило заводится только «Создать»', async () => {
        const { edits } = mount({ addNow: true, onAddUsed: () => {} })
        await waitFor(() => screen.getByRole('button', { name: 'Создать' }))
        await new Promise((r) => setTimeout(r, 30))
        expect(edits).toHaveLength(0)
        fireEvent.click(screen.getByRole('button', { name: 'Создать' }))
        await waitFor(() => expect(edits).toHaveLength(1))
        expect(edits[0].channels).toHaveLength(2)
    })

    it('«Удалить» у нового правила ничего не пишет', async () => {
        const { edits, closed } = mount({ addNow: true, onAddUsed: () => {} })
        await waitFor(() => screen.getByRole('button', { name: 'Создать' }))
        fireEvent.click(screen.getByRole('button', { name: /Удалить/ }))
        await new Promise((r) => setTimeout(r, 30))
        expect(edits).toHaveLength(0)
        expect(closed).toHaveBeenCalled()
    })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import type { Spec } from '@/lib/model'

// Карточка подписки: своё название, одна кнопка «Проверить все» на все протоколы, выход на узлах
// подписки (кнопка и сам по себе после добавления), подписанные поля формы. Всё, что ходит в
// сеть роутера, — только по нажатию.

const notify = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notify', () => ({ notify }))

const { default: VlessScreen } = await import('@/components/VlessScreen')

const PATH = '/etc/steer/subs/sub1.txt'
const ROW = { name: 'sub1', title: 'Панель', kind: 'url' as const, url: 'https://p.example/s', path: PATH, present: true, used: 0 }
const SPEC: Spec = { outputs: { direct: { name: 'direct', kind: 'direct' } }, channels: [] }

const node = (index: number, name: string) => ({
    index, name, type: 'vless', host: 'h', port: 443, mode: 'tcp', security: 'tls', vision: false,
})
const probeOk = (index: number, ms: number) => ({ results: [{ index, name: '', type: 'vless', ok: true, handshake_ms: ms, ttfb_ms: ms, why: '' }] })
const probeBad = (index: number, why: string) => ({ results: [{ index, name: '', type: 'vless', ok: false, handshake_ms: -1, ttfb_ms: -1, why }] })

describe('карточка подписки', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        notify.mockClear()
        window.localStorage.clear()
        pending.saved = structuredClone(SPEC)
        pending.applied = structuredClone(SPEC)
        pending.dirty = false
        vi.spyOn(pending, 'edit').mockImplementation((s) => {
            pending.saved = s
            ;(pending as unknown as { emit: () => void }).emit()
        })
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [ROW], hwid: '' } as never)
        vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue({ nodes: [node(0, 'A'), node(1, 'B'), node(2, 'C')], usable: 3, skipped: 0, foreign: 2 } as never)
        vi.spyOn(rpc, 'hysteria2NodesOfSub').mockResolvedValue({ nodes: [{ ...node(0, 'H'), type: 'hysteria2' }], usable: 1, skipped: 0, foreign: 0 } as never)
        vi.spyOn(rpc, 'proxyNodesOfSub').mockRejectedValue(new Error('нужен пакет'))
    })

    it('поля формы добавления подписаны видимыми подписями', async () => {
        render(<VlessScreen />)
        expect(await screen.findByText('Название (необязательно)')).toBeInTheDocument()
        expect(screen.getByText('Ссылка подписки или узлов')).toBeInTheDocument()
        expect(screen.getByText('Прокси HTTP(S) — если есть')).toBeInTheDocument()
    })

    it('переименование: уходит в sub_rename и перечитывает список', async () => {
        const rename = vi.spyOn(rpc, 'subRename').mockResolvedValue({ ok: true, name: 'sub1', title: 'Моя' })
        render(<VlessScreen />)
        const field = await screen.findByLabelText('Название sub1')
        expect(field).toHaveValue('Панель')
        const save = () => screen.getByText('Сохранить название').closest('button')!
        expect(save()).toBeDisabled()
        fireEvent.input(field, { target: { value: ' Моя ' } })
        await waitFor(() => expect(save()).not.toBeDisabled())
        fireEvent.click(save())
        await waitFor(() => expect(rename).toHaveBeenCalledWith('sub1', 'Моя'))
        await waitFor(() => expect(rpc.subList).toHaveBeenCalledTimes(2))
    })

    it('«Проверить все»: один нажим проверяет узлы всех протоколов своим методом и даёт итог', async () => {
        const v = vi.spyOn(rpc, 'vlessProbeOfSub').mockImplementation(async (_s: string, i: number) =>
            (i === 2 ? probeBad(i, 'таймаут') : probeOk(i, i === 0 ? 120 : 45)) as never)
        const h = vi.spyOn(rpc, 'hysteria2ProbeOfSub').mockResolvedValue(probeOk(0, 300) as never)
        render(<VlessScreen />)
        expect(v).not.toHaveBeenCalled() // при открытии экрана ничего не меряется
        fireEvent.click(await screen.findByText('Проверить все'))
        await screen.findByText(/Ответили 3 из 4/)
        expect(v).toHaveBeenCalledTimes(3)
        expect(h).toHaveBeenCalledTimes(1)
        expect(screen.getByText(/лучший — B, 45 мс/)).toBeInTheDocument()
    })

    it('никто не ответил — сказано, и причина названа', async () => {
        vi.spyOn(rpc, 'vlessProbeOfSub').mockImplementation(async (_s: string, i: number) => probeBad(i, 'сервер закрыт') as never)
        vi.spyOn(rpc, 'hysteria2ProbeOfSub').mockResolvedValue(probeBad(0, 'сервер закрыт') as never)
        render(<VlessScreen />)
        fireEvent.click(await screen.findByText('Проверить все'))
        await screen.findByText(/ни один не ответил/)
        expect(screen.getByText(/причина: сервер закрыт/)).toBeInTheDocument()
    })

    it('«Сделать выходом» заводит выход на подписке; кнопка после этого пропадает', async () => {
        render(<VlessScreen />)
        fireEvent.click(await screen.findByText('Сделать выходом'))
        await waitFor(() => expect(pending.edit).toHaveBeenCalled())
        const made = (pending.edit as unknown as { mock: { calls: Spec[][] } }).mock.calls[0][0]
        const out = Object.values(made.outputs).filter((o) => o.sub_file === PATH)
        /* В подписке два протокола — пул из частей по протоколу под одним выходом. */
        expect(out.map((o) => o.kind).sort()).toEqual(['hysteria2', 'vless'])
        expect(Object.keys(made.outputs)).toContain('sub1')
        await screen.findByText('выход на узлах подписки есть')
        expect(screen.queryByText('Сделать выходом')).toBeNull()
    })

    it('после добавления подписки выход появляется сам', async () => {
        vi.spyOn(rpc, 'subList').mockResolvedValueOnce({ subs: [], hwid: '' } as never)
            .mockResolvedValue({ subs: [ROW], hwid: '' } as never)
        vi.spyOn(rpc, 'subSet').mockResolvedValue({ ok: true, kind: 'url', usable: 5 } as never)
        render(<VlessScreen />)
        fireEvent.input(await screen.findByLabelText('ссылка подписки'), { target: { value: 'https://p.example/s' } })
        fireEvent.click(screen.getByText('Добавить'))
        await waitFor(() => expect(pending.edit).toHaveBeenCalled())
        const made = (pending.edit as unknown as { mock: { calls: Spec[][] } }).mock.calls[0][0]
        expect(Object.values(made.outputs).some((o) => o.sub_file === PATH)).toBe(true)
        expect(notify).toHaveBeenCalledWith(expect.stringContaining('создан'), 'info')
    })

    it('в подписке нет пригодных узлов — выхода сама не заводит', async () => {
        vi.spyOn(rpc, 'subSet').mockResolvedValue({ ok: true, kind: 'url', usable: 0 } as never)
        render(<VlessScreen />)
        fireEvent.input(await screen.findByLabelText('ссылка подписки'), { target: { value: 'https://p.example/s' } })
        fireEvent.click(screen.getByText('Добавить'))
        await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('пригодных узлов'), 'warning'))
        expect(pending.edit).not.toHaveBeenCalled()
    })
})

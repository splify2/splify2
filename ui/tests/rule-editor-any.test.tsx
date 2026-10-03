import { render, screen } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RuleEditor from '@/components/tabs/RuleEditor'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { type Channel } from '@/lib/model'

// QEMU-стенд после перехода 26.9.2 → 26.10: правило «Ноутбук напрямую» (весь трафик одного
// устройства — исключение) открывалось с шапкой «Что перенаправляем · ничего не выбрано» и строкой
// «сервис не выбран», то есть читалось пустым правилом.

const OUTPUTS = { direct: { kind: 'direct', up: true } } as never

function mount(c: Channel) {
    render(<RuleEditor ch={c} index={0} services={[]} local={{}} outputs={OUTPUTS} clash={null} rulesTotal={1}
        coveredBy={[]} onChange={() => {}} onClose={() => {}} onDelete={() => {}} />)
}

beforeEach(() => {
    vi.restoreAllMocks()
    pending.saved = null
    vi.spyOn(rpc, 'leases').mockResolvedValue({ leases: [] } as never)
    vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
})

describe('редактор правила «весь трафик»', () => {
    it('шапка говорит «весь трафик», а не «ничего не выбрано»', () => {
        mount({ name: 'Ноутбук напрямую', out: 'direct', from: ['192.168.1.50'], scope: 'device', match: { any: true } } as Channel)
        expect(screen.getByText('весь трафик')).toBeInTheDocument()
        expect(screen.queryByText('ничего не выбрано')).toBeNull()
        expect(screen.queryByText(/сервис не выбран/)).toBeNull()
    })

    it('пустое правило — по-прежнему «ничего не выбрано»', () => {
        mount({ name: 'Новое', out: 'direct', match: {} } as Channel)
        expect(screen.getByText('ничего не выбрано')).toBeInTheDocument()
    })
})

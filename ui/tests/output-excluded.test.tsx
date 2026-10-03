import { render, screen } from '@testing-library/preact'
import { describe, expect, it } from 'vitest'
import { LooseBlock } from '@/components/OutputCards'
import type { OutputStatus } from '@/lib/model'

// Все кандидаты выхода исключены («Не брать»): ядро говорит probe.state `excluded`. Строка
// выхода называет состояние и действие, а не «в подписке нет пригодных узлов» (узлы есть, их не
// велено брать) и не «нет соединения».

describe('выход без кандидатов из-за исключения', () => {
    it('состояние excluded — «Все узлы исключены» и что сделать', () => {
        const st = { kind: 'vless', device: 'vl', up: false, probe: { state: 'excluded', total: 5 } } as unknown as OutputStatus
        render(<LooseBlock name="vl" st={st} />)
        expect(screen.getByText('Все узлы исключены')).toBeInTheDocument()
        expect(screen.getByText(/Не брать/)).toBeInTheDocument()
        expect(screen.queryByText(/в подписке нет пригодных узлов/)).toBeNull()
        expect(screen.queryByText('Нет соединения')).toBeNull()
    })

    it('failed с нулём остаётся про подписку', () => {
        const st = { kind: 'vless', device: 'vl', up: false, probe: { state: 'failed', total: 0 } } as unknown as OutputStatus
        render(<LooseBlock name="vl" st={st} />)
        expect(screen.getByText(/в подписке нет пригодных узлов/)).toBeInTheDocument()
        expect(screen.queryByText('Все узлы исключены')).toBeNull()
    })
})

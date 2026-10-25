import { render, screen } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SubBlock, TunnelBlock } from '@/components/OutputCards'
import { rpc } from '@/lib/rpc'
import type { OutputStatus } from '@/lib/model'

// Ядро 2.0 различает две беды выхода, у которого устройство ЕСТЬ: `failed` — сторож признал его
// неработающим и поставил on_fail (тогда `up: false`), и `node_down` — клиент туннеля потерял узел
// за устройством. Снято с QEMU-стенда: выход reserve (sbx0) — `up:false, failed:true`, и главная
// говорила «выход reserve не поднят: устройства нет», хотя устройство стоит. По такому тексту
// идут создавать устройство, а чинить надо туннель или сервер за ним.

const failed = (on_fail: OutputStatus['on_fail']): OutputStatus =>
    ({ name: 'reserve', kind: 'interface', device: 'sbx0', up: false, failed: true, on_fail }) as OutputStatus

describe('выход с устройством, который не отвечает', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        vi.spyOn(rpc, 'subQuota').mockRejectedValue(new Error('не спрашиваем'))
        vi.spyOn(rpc, 'vlessNodes').mockRejectedValue(new Error('не спрашиваем'))
    })

    it('сторож поставил on_fail — «не отвечает» и куда идёт трафик, а не «устройства нет»', () => {
        render(<TunnelBlock name="reserve" st={failed('direct')} />)
        expect(screen.getByText('Выход не отвечает')).toBeInTheDocument()
        expect(screen.getByText(/идёт напрямую, пока выход не ответит/)).toBeInTheDocument()
        expect(screen.queryByText(/устройства нет/)).toBeNull()
    })

    it('on_fail=drop — сказано, что трафик остановлен', () => {
        render(<TunnelBlock name="reserve" st={failed('drop')} />)
        expect(screen.getByText(/остановлен, пока выход не ответит/)).toBeInTheDocument()
    })

    it('узел потерян при поднятом устройстве — беда, а не прошлая страна', () => {
        const st = {
            name: 'vl', kind: 'vless', device: 'vl', up: true,
            node_down: { why: 'TCP не соединился', since: 1790000000 },
        } as OutputStatus
        render(<SubBlock outs={[{ name: 'vl', st, facts: { geo: { cc: 'NL' }, ping: { ms: 42, state: 'ok' } } }]} />)
        expect(screen.getByText('Узел не отвечает')).toBeInTheDocument()
        expect(screen.getByText(/вернётся сам/)).toBeInTheDocument()
        // Причина — техническое пояснение клиента: на экран не выводится.
        expect(screen.queryByText(/TCP/)).toBeNull()
        expect(screen.queryByText('42 мс')).toBeNull()
    })

    it('поля нет — прежний вид «устройства нет»', () => {
        render(<TunnelBlock name="wg" st={{ name: 'wg', kind: 'interface', device: 'wg0', up: false } as OutputStatus} />)
        expect(screen.getByText(/выход wg не поднят: устройства нет/)).toBeInTheDocument()
    })
})

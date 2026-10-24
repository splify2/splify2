import { render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '@/components/sections/Home'
import { rpc } from '@/lib/rpc'
import type { Status } from '@/lib/model'
import { live } from './fixtures'

// Скорость правила считается в lib/live.ts из разницы двух опросов и до сих пор на экран не
// выходила. Показываем её рядом со счётчиком; нет замера — нет и строки (нуль был бы неправдой).

const status = {
    outputs: { vless: { kind: 'vless', device: 'vless', up: true, mark: '0x00100000', table: 300 } },
    channels: [{ name: 'Youtube', out: 'vless', kind: 'domains', live: true, bytes: 2048, down_bytes: 4096 }],
} as unknown as Status

function open(speed: ReturnType<typeof live>['speed']) {
    render(<Home live={live({ status, speed })} onSection={() => undefined} onAddRule={() => undefined} />)
}

describe('обзор: скорость правила', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'specGet').mockResolvedValue({
            schema: 1,
            outputs: { vless: { name: 'vless', kind: 'vless' } },
            channels: [{ name: 'Youtube', out: 'vless', match: { domains_files: ['/a.lst'] } }],
        } as never)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue({ schema: 1, outputs: {}, channels: [] } as never)
        vi.spyOn(rpc, 'subList').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'subQuota').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'outboundGeo').mockRejectedValue(new Error('нет метода'))
    })

    it('есть замер — ↓/↑ рядом с трафиком', async () => {
        open({ ch: { Youtube: { down: '1,2 Мбит/с', up: '300 кбит/с' } }, dev: {} })
        await waitFor(() => expect(screen.getAllByText('↓ 1,2 Мбит/с').length).toBeGreaterThan(0))
        expect(screen.getAllByText('↑ 300 кбит/с').length).toBeGreaterThan(0)
    })

    it('замера нет (первый опрос, нули) — строки скорости нет', async () => {
        open({ ch: { Youtube: { down: null, up: null } }, dev: {} })
        await waitFor(() => expect(screen.getAllByText('Youtube').length).toBeGreaterThan(0))
        expect(screen.queryByTitle('скорость сейчас')).toBeNull()
        expect(document.body.textContent).not.toMatch(/бит\/с/)
    })

    it('одно направление — только оно', async () => {
        open({ ch: { Youtube: { down: '5 кбит/с', up: null } }, dev: {} })
        await waitFor(() => expect(screen.getAllByText('↓ 5 кбит/с').length).toBeGreaterThan(0))
        expect(screen.queryByText(/↑ \d/)).toBeNull()
    })
})

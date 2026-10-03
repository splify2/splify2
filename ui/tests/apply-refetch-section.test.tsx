import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Spec } from '@/lib/model'

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

import Dns from '@/components/sections/Dns'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { decodeSpec } from '@/lib/specv2'
import { S } from '@/copy'

// Раздел держит свою копию спеки в состоянии: правка вырастает из неё, а хранилище записывает её
// целиком. После «Применить» хранилище берёт с роутера спеку, в которую бэкенд мог вписать
// вылеченные ключи (`ipv6`), — и копия раздела обязана подхватить подмену. Иначе первая же правка
// раздела записала бы поверх роутерной ту, с которой раздел открылся: ключи пропали бы, хотя
// хранилище про них знает (lib/speccopy.ts).

const FIXTURE: Spec = {
    outputs: { direct: { name: 'direct', kind: 'direct' }, wg0: { name: 'wg0', kind: 'interface', device: 'wg0' } },
    channels: [],
    dns: { upstreams: { google: { url: 'https://dns.google/dns-query', out: 'wg0' } }, upstream: 'google', cache: 512 },
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

let disk: Spec
let snapshot: Spec
let set: ReturnType<typeof vi.spyOn>

/** Спека, как её записала страница, — `ipv6` лежит у выхода. */
function sent(n = -1): { outputs: Record<string, { ipv6?: string }>; dns?: { mode?: string } } {
    return JSON.parse(set.mock.calls.at(n)![0] as string)
}

beforeEach(async () => {
    vi.restoreAllMocks()
    disk = clone(FIXTURE)
    snapshot = clone(FIXTURE)
    vi.spyOn(rpc, 'dnsLog').mockResolvedValue({ running: true, upstreams: [], cache: undefined } as never)
    vi.spyOn(rpc, 'specGet').mockImplementation(async () => clone(disk))
    vi.spyOn(rpc, 'appliedGet').mockImplementation(async () => clone(snapshot))
    set = vi.spyOn(rpc, 'specSet').mockImplementation((async (json: string) => {
        disk = decodeSpec(JSON.parse(json))
        return { ok: true }
    }) as never)
    // Бэкенд: apply вылечивает выходы-интерфейсы без ключа и снимает снимок с вылеченного файла.
    vi.spyOn(rpc, 'apply').mockImplementation((async () => {
        disk = clone(disk)
        for (const o of Object.values(disk.outputs)) if (o.kind === 'interface' && !o.ipv6) o.ipv6 = 'nat'
        snapshot = clone(disk)
        return { ok: true, output: 'splify2: выходам без ключа ipv6 записан ipv6: nat (у туннеля есть адрес IPv6): wg0' }
    }) as never)
    // @ts-expect-error — сброс внутреннего состояния между проверками
    pending.saved = null; pending.applied = null; pending.dirty = false; pending.applying = false
})

describe('раздел после применения', () => {
    it('правит свежую спеку: вылеченный ключ после правки на месте', async () => {
        render(<Dns />)
        await screen.findByLabelText('имя сервера google')
        await pending.apply()
        fireEvent.click(screen.getByText('Настоящие адреса'))
        await pending.flush()
        expect(set).toHaveBeenCalledTimes(1)
        const out = sent()
        expect(out.dns?.mode).toBe('realip')
        expect(out.outputs.wg0.ipv6).toBe('nat')
        // …и страница после перезагрузки счёт не покажет: на роутере лежит ровно то, что применено,
        // плюс одна правка.
        expect(pending.count()).toBe(1)
    })

    it('правка, сделанная за время применения, не теряется и не прячет вылеченный ключ', async () => {
        let finish!: () => void
        const real = vi.mocked(rpc.apply).getMockImplementation()!
        vi.mocked(rpc.apply).mockImplementation(((...a: unknown[]) => new Promise((r) => {
            finish = () => r(real(...a))
        })) as never)
        render(<Dns />)
        await screen.findByLabelText('имя сервера google')
        const run = pending.apply()
        await waitFor(() => expect(finish).toBeTypeOf('function'))
        fireEvent.click(screen.getByText('Настоящие адреса'))
        // Полсекунды дебаунса прошли бы, но запись ждёт конца применения.
        await new Promise((r) => setTimeout(r, 700))
        expect(set).not.toHaveBeenCalled()
        finish()
        await run
        await waitFor(() => expect(set).toHaveBeenCalledTimes(1))
        const out = sent()
        expect(out.dns?.mode).toBe('realip')
        expect(out.outputs.wg0.ipv6).toBe('nat')
        // Правка за время применения — неприменённая, и пилюля скажет об этом.
        expect(pending.count()).toBe(1)
        // А копия раздела после слияния — свежая: следующая правка вылеченный ключ тоже не стирает.
        fireEvent.click(screen.getByText(S.dns.poddelnyeAdresa))
        await pending.flush()
        expect(set).toHaveBeenCalledTimes(2)
        expect(sent().outputs.wg0.ipv6).toBe('nat')
    })
})

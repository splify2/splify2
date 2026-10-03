import { render, screen } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '@/components/sections/Home'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { type Live } from '@/lib/live'
import type { Spec, Status } from '@/lib/model'

// Снято со второго стенда QEMU после перехода 26.9.2 → 26.10.0: оба туннеля подняты (зелёные
// точки в «Выходах», трафик идёт), а строки правил говорили «nl не поднят». Страны и отклика у
// выхода не было (curl ушёл вместе с https-dns-proxy), устройство зовётся как выход — сказать было
// нечего, и строка падала в «не поднят» независимо от `up`.

const SPEC: Spec = {
    outputs: {
        direct: { name: 'direct', kind: 'direct' },
        nl: { name: 'nl', kind: 'tunnel', protocol: 'vless', sub_file: '/etc/steer/sub.txt', device: 'nl' },
    },
    channels: [{ name: 'YouTube', match: { domains_files: ['/etc/steer/lists/yt.lst'], mode: 'fakeip' }, out: 'nl' }],
} as unknown as Spec

function live(up: boolean): Live {
    return {
        status: {
            outputs: { direct: { kind: 'direct' }, nl: { kind: 'tunnel', protocol: 'vless', device: 'nl', up, mark: '0x00100000', table: 300, on_fail: 'drop' } },
            channels: [{ name: 'nl_dom', out: 'nl', kind: 'domains', live: true, channels: ['YouTube'] }],
        } as unknown as Status,
        devices: {}, devs: {},
        net: { uptime: 1200, active_clients: 1 },
        diag: { checks: [], warn: 0, fail: 0 },
        build: { present: true, version: '2.0.0' },
        releases: [], selfUpdate: { current: '26.10.0' },
        phase: null, refresh: () => undefined,
    } as unknown as Live
}

describe('строка правила без страны и отклика', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        pending.saved = SPEC
        pending.applied = SPEC
        vi.spyOn(rpc, 'specGet').mockResolvedValue(SPEC as never)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue(SPEC as never)
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
        vi.spyOn(rpc, 'subQuota').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'outboundGeo').mockResolvedValue({ output: 'nl', curl: false } as never)
        vi.spyOn(rpc, 'outboundProbe').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'vlessNodes').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
    })

    it('туннель поднят — «работает», а не «не поднят»', async () => {
        render(<Home live={live(true)} onSection={() => undefined} />)
        const row = (await screen.findByText('YouTube')).closest('li')!
        expect(row).toHaveTextContent('работает')
        expect(row).not.toHaveTextContent('не поднят')
    })

    it('туннель не поднят — так и сказано', async () => {
        render(<Home live={live(false)} onSection={() => undefined} />)
        const row = (await screen.findByText('YouTube')).closest('li')!
        expect(row).toHaveTextContent('не поднят')
    })
})

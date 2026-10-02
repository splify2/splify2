import { render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SubBlock } from '@/components/OutputCards'
import PoolList from '@/components/PoolList'
import { pending } from '@/lib/pending'
import { live } from './fixtures'
import { missingModule } from '@/lib/engine'
import { outExtras } from '@/lib/outstate'
import { rpc } from '@/lib/rpc'
import type { OutputStatus, Spec } from '@/lib/model'

// Состояние выходов прокси steer-proxy и hysteria2 на экранах. Ядро печатает у живого клиента
// объект `proxy` (node, protocol, up) или `hysteria2` (node, up, …) — так и называется узел,
// который выход держит. Список узлов VLESS у такого выхода спрашивать нельзя: vless_nodes по
// нему отвечает отказом, и строка локации оставалась без страны продавца.

describe('выход прокси на экранах', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'subInfo').mockResolvedValue({ kind: 'links', path: '/etc/steer/sub.txt', present: true } as never)
    })

    it('локация trojan называет страну узла из объекта proxy и не спрашивает узлы VLESS', async () => {
        const vn = vi.spyOn(rpc, 'vlessNodes')
        const st: OutputStatus = {
            name: 'tr', kind: 'trojan', device: 'tr', up: true,
            proxy: { node: '🇳🇱 Амстердам-1', protocol: 'trojan', up: true },
        }
        render(<SubBlock outs={[{ name: 'tr', st }]} />)
        await waitFor(() => expect(screen.getByText('Нидерланды')).toBeInTheDocument())
        expect(vn).not.toHaveBeenCalled()
    })

    it('локация hysteria2 — так же, по объекту hysteria2', async () => {
        const vn = vi.spyOn(rpc, 'vlessNodes')
        const st: OutputStatus = {
            name: 'hy', kind: 'hysteria2', device: 'hy', up: true,
            hysteria2: { node: '🇫🇮 Хельсинки', up: true, hs_ms: 40, cc: 'bbr', udp: true },
        }
        render(<SubBlock outs={[{ name: 'hy', st }]} />)
        await waitFor(() => expect(screen.getByText('Финляндия')).toBeInTheDocument())
        expect(vn).not.toHaveBeenCalled()
    })

    it('список выходов: у выхода прокси протокол назван бейджем, без модуля — нужен пакет steer-proxy', async () => {
        const spec: Spec = {
            outputs: {
                tr: { name: 'tr', kind: 'trojan', sub_file: '/etc/steer/sub.txt', on_fail: 'drop' },
                vm: { name: 'vm', kind: 'vmess', sub_file: '/etc/steer/sub.txt', on_fail: 'drop' },
            },
            channels: [],
        }
        pending.saved = spec
        pending.applied = spec
        vi.spyOn(rpc, 'outboundGeo').mockRejectedValue(new Error('нет'))
        render(<PoolList live={live({ build: { modules: ['vless'] } })} />)
        await waitFor(() => expect(screen.getByText('tr')).toBeInTheDocument())
        expect(screen.getAllByText('нужен пакет steer-proxy').length).toBe(2)
        document.body.innerHTML = ''
        render(<PoolList live={live({ build: { modules: ['vless', 'proxy'] } })} />)
        /* Протокол — бейджем конфигурации под строкой (lib/badges.ts), подпись — «подписка». */
        await waitFor(() => expect(screen.getByRole('button', { name: /^tr.*подписка.*Trojan/ })).toBeInTheDocument())
        expect(screen.getByRole('button', { name: /^vm.*подписка.*VMess/ })).toBeInTheDocument()
    })

    it('insecure у trojan (ядро его в status не печатает) — «сертификат не проверяется» по спеке', () => {
        const st: OutputStatus = { name: 'tr', kind: 'trojan', up: true }
        expect(outExtras({ name: 'tr', kind: 'trojan', insecure: true }, st).words).toContain('сертификат не проверяется')
        expect(outExtras({ name: 'tr', kind: 'trojan' }, st).words).not.toContain('сертификат не проверяется')
        /* У shadowsocks ключа нет вовсе: модель его не пишет, и строка о нём не говорит. */
        expect(outExtras({ name: 'ss', kind: 'shadowsocks', insecure: true }, { ...st, kind: 'shadowsocks' }).words)
            .not.toContain('сертификат не проверяется')
    })

    it('выход прокси без модуля просит пакет steer-proxy, с модулем — ничего', () => {
        for (const kind of ['trojan', 'shadowsocks', 'socks', 'http', 'vmess']) {
            expect(missingModule({ kind }, ['vless'])).toBe('proxy')
            expect(missingModule({ kind }, ['vless', 'proxy'])).toBeNull()
        }
    })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isProxyLinks, isSubSource } from '@/lib/validate'

// Ссылки прокси steer-proxy (trojan://, ss://, socks*://, vmess://) — вставкой в поле адреса,
// как vless://. Прокси http(s):// — ОТДЕЛЬНЫМ полем (решение владельца 2026-10-02): по виду
// `https://адрес:порт` от адреса панели его не отличить, и в общем поле он скачивался бы как
// подписка. Ссылки синтетические.

const h = vi.hoisted(() => ({
    subList: vi.fn(),
    subInfo: vi.fn(),
    subSet: vi.fn(),
    subDel: vi.fn(),
    notify: vi.fn(),
}))
vi.mock('@/lib/rpc', () => ({
    rpc: { subList: h.subList, subInfo: h.subInfo, subSet: h.subSet, subDel: h.subDel },
}))
vi.mock('@/lib/notify', () => ({ notify: h.notify }))

const { default: VlessScreen } = await import('@/components/VlessScreen')

async function mount() {
    h.subList.mockResolvedValue({ subs: [], hwid: '' })
    render(<VlessScreen />)
    await waitFor(() => expect(h.subList).toHaveBeenCalled())
}
const type = (label: string, value: string) =>
    fireEvent.input(screen.getByLabelText(label), { target: { value } })

describe('ссылки прокси в подписке', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        h.subSet.mockResolvedValue({ ok: true, kind: 'links', usable: 2 })
    })

    it('проверка поля: trojan, ss, socks, vmess — ссылки узлов; прокси http — только «адрес:порт»', () => {
        expect(isSubSource('trojan://p@h:443#t ss://YWVz@h:1#s socks5://h:1080 vmess://eyJ9')).toBe(true)
        expect(isSubSource('ftp://h/x')).toBe(false)
        expect(isProxyLinks('http://u:p@h:3128#ht https://h:443?sni=x')).toBe(true)
        expect(isProxyLinks('https://panel.example/sub/abc')).toBe(false)
    })

    it('trojan:// вставкой уходит в поле адреса, как vless://', async () => {
        await mount()
        type('ссылка подписки', 'trojan://p@h:443#t')
        fireEvent.click(screen.getByText('Добавить'))
        await waitFor(() => expect(h.subSet).toHaveBeenCalledWith('trojan://p@h:443#t', 'sub1', ''))
        expect(h.notify).not.toHaveBeenCalledWith(expect.anything(), 'warning')
    })

    it('прокси http — своим полем, уходит параметром links', async () => {
        await mount()
        type('ссылка прокси HTTP(S)', 'http://u:p@h:3128#ht')
        fireEvent.click(screen.getByText('Добавить'))
        await waitFor(() => expect(h.subSet).toHaveBeenCalledWith('', 'sub1', '', 'http://u:p@h:3128#ht'))
    })

    it('адрес панели в поле прокси — предупреждение, а не подписка из ссылки в никуда', async () => {
        await mount()
        type('ссылка прокси HTTP(S)', 'https://panel.example/sub/abc')
        fireEvent.click(screen.getByText('Добавить'))
        await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.stringContaining('адрес:порт'), 'warning'))
        expect(h.subSet).not.toHaveBeenCalled()
    })

    it('адрес подписки и прокси разом — предупреждение: это две подписки', async () => {
        await mount()
        type('ссылка подписки', 'https://panel.example/sub/abc')
        type('ссылка прокси HTTP(S)', 'http://h:3128')
        fireEvent.click(screen.getByText('Добавить'))
        await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.stringContaining('разными подписками'), 'warning'))
        expect(h.subSet).not.toHaveBeenCalled()
    })
})

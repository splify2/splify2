import { type Upstream } from '@/lib/model'

/** Готовые серверы DNS: карточки вкладки DNS и выбор «Сервер DNS» в правиле (приложение для ПК).
 *  Имя — ключ сервера в dns.upstreams, когда профиль выбран; название для человека — в
 *  S.dns.presetTitles. */
export const PRESETS: { name: string; up: Upstream }[] = [
    { name: 'cloudflare', up: { url: 'https://cloudflare-dns.com/dns-query', ips: ['1.1.1.1', '1.0.0.1'] } },
    { name: 'cloudflare-dot', up: { url: 'tls://cloudflare-dns.com', ips: ['1.1.1.1', '1.0.0.1'] } },
    { name: 'cloudflare-sec', up: { url: 'https://security.cloudflare-dns.com/dns-query', ips: ['1.1.1.2', '1.0.0.2'] } },
    { name: 'cloudflare-fam', up: { url: 'https://family.cloudflare-dns.com/dns-query', ips: ['1.1.1.3', '1.0.0.3'] } },
    { name: 'google', up: { url: 'https://dns.google/dns-query', ips: ['8.8.8.8', '8.8.4.4'] } },
    { name: 'google-dot', up: { url: 'tls://dns.google', ips: ['8.8.8.8', '8.8.4.4'] } },
    { name: 'quad9-doh', up: { url: 'https://dns.quad9.net/dns-query', ips: ['9.9.9.9', '149.112.112.112'] } },
    { name: 'quad9', up: { url: 'tls://dns.quad9.net', ips: ['9.9.9.9', '149.112.112.112'] } },
    { name: 'quad9-doq', up: { url: 'quic://dns.quad9.net', ips: ['9.9.9.9', '149.112.112.112'] } },
    { name: 'adguard-doh', up: { url: 'https://dns.adguard-dns.com/dns-query', ips: ['94.140.14.14', '94.140.15.15'] } },
    { name: 'adguard-dot', up: { url: 'tls://dns.adguard-dns.com', ips: ['94.140.14.14', '94.140.15.15'] } },
    { name: 'adguard', up: { url: 'quic://dns.adguard-dns.com', ips: ['94.140.14.14', '94.140.15.15'] } },
    { name: 'adguard-fam', up: { url: 'https://family.adguard-dns.com/dns-query', ips: ['94.140.14.15', '94.140.15.16'] } },
    { name: 'adguard-fam-doq', up: { url: 'quic://family.adguard-dns.com', ips: ['94.140.14.15', '94.140.15.16'] } },
    { name: 'yandex', up: { url: 'https://common.dot.dns.yandex.net/dns-query', ips: ['77.88.8.8', '77.88.8.1'] } },
    { name: 'yandex-dot', up: { url: 'tls://common.dot.dns.yandex.net', ips: ['77.88.8.8', '77.88.8.1'] } },
    { name: 'yandex-safe', up: { url: 'https://safe.dot.dns.yandex.net/dns-query', ips: ['77.88.8.88', '77.88.8.2'] } },
    { name: 'opendns', up: { url: 'https://doh.opendns.com/dns-query', ips: ['208.67.222.222', '208.67.220.220'] } },
    { name: 'opendns-dot', up: { url: 'tls://dns.opendns.com', ips: ['208.67.222.222', '208.67.220.220'] } },
    { name: 'controld', up: { url: 'https://freedns.controld.com/p0', ips: ['76.76.2.0', '76.76.10.0'] } },
    { name: 'comss', up: { url: 'https://dns.comss.one/dns-query', ips: ['83.220.169.155', '212.109.195.93'] } },
    { name: 'comss-dot', up: { url: 'tls://dns.comss.one', ips: ['83.220.169.155', '212.109.195.93'] } },
    { name: 'comss-doq', up: { url: 'quic://dns.comss.one', ips: ['83.220.169.155', '212.109.195.93'] } },
    { name: 'xbox-dns', up: { url: 'https://xbox-dns.ru/dns-query', ips: ['111.88.96.50', '111.88.96.51'] } },
    { name: 'xbox-dns-dot', up: { url: 'tls://xbox-dns.ru', ips: ['111.88.96.50', '111.88.96.51'] } },
    { name: 'malw', up: { url: 'https://dns.malw.link/dns-query', ips: ['193.23.209.189'] } },
    { name: 'yo1nk', up: { url: 'https://dns.yo1nk.app/dns-query', ips: ['109.120.137.190'] } },
    { name: 'yo1nk-dot', up: { url: 'tls://dns.yo1nk.app', ips: ['109.120.137.190'] } },
]

/** Протокол сервера по адресу — как его называет ядро в `dns_log`. */
export function protoOfUrl(url: string): string {
    if (url.startsWith('https://')) return 'doh'
    if (url.startsWith('h3://')) return 'doh3'
    if (url.startsWith('tls://')) return 'dot'
    if (url.startsWith('quic://')) return 'doq'
    if (url.startsWith('tcp://')) return 'tcp'
    return 'udp'
}

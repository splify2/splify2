'use strict'
// Установка splify2 на роутер из мастера первого запуска — по SSH.
//
// ПОЧЕМУ SSH, А НЕ UBUS. Через ubus произвольную команду не запустить: `file exec` пускает только
// команды, перечисленные в ACL пакетов, оболочки среди них нет. SSH (dropbear) на OpenWrt есть
// всегда и пускает root по тому же паролю, что LuCI. Команда установки — та же, что в README:
// установщик без терминала берёт умолчания (install.sh, `[ -t 0 ]`), вопросов не задаёт.
//
// Ключ сервера принимается без проверки: это первое знакомство с роутером, который человек сам
// выбрал в своей сети, — сравнивать не с чем.

const { Client } = require('ssh2')

const INSTALL = process.env.SPLIFY_DESKTOP_INSTALL_CMD ||
    'wget -O /tmp/splify2-install.sh https://gitlab.com/xyzmean/splify2/-/raw/main/install.sh && sh /tmp/splify2-install.sh'

function hostOf(address) {
    const a = String(address).trim()
    if (/^https?:\/\//i.test(a)) return new URL(a).hostname.replace(/^\[|\]$/g, '')
    // «host:порт» — порт отбрасывается; у IPv6 без скобок двоеточий много, и «:1» в конце — часть адреса.
    const bracket = /^\[([^\]]+)\]/.exec(a)
    if (bracket) return bracket[1]
    return a.split(':').length === 2 ? a.replace(/:\d+$/, '') : a
}

/** Команда на роутере; вывод — строками в onLine. Пустой пароль — как у свежей OpenWrt. */
function run(address, password, command, onLine = () => {}, timeoutMs = 20 * 60 * 1000) {
    return new Promise((resolve, reject) => {
        const c = new Client()
        let buf = ''
        let done = false
        const finish = (fn, v) => { if (done) return; done = true; clearTimeout(t); c.end(); fn(v) }
        const t = setTimeout(() => finish(reject, Object.assign(new Error('Роутер не ответил вовремя'), { code: 'timeout' })), timeoutMs)
        const flush = (chunk, end) => {
            buf += chunk
            const lines = buf.split(/\r?\n/)
            buf = end ? '' : lines.pop()
            for (const l of lines) if (l.trim()) onLine(l)
        }
        c.on('ready', () => {
            c.exec(command, (err, stream) => {
                if (err) return finish(reject, err)
                stream.on('data', (d) => flush(d.toString('utf8'), false))
                stream.stderr.on('data', (d) => flush(d.toString('utf8'), false))
                stream.on('close', (code) => { flush('', true); finish(resolve, { code: code ?? 0 }) })
            })
        })
        c.on('error', (e) => {
            const msg = e.level === 'client-authentication' ? 'Неверный пароль роутера'
                : /ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|Timed out/i.test(String(e.message)) ? 'Роутер не пускает по SSH'
                : e.message
            finish(reject, Object.assign(new Error(msg), { code: e.level === 'client-authentication' ? 'bad_password' : 'ssh' }))
        })
        c.on('keyboard-interactive', (_n, _i, _l, prompts, reply) => reply(prompts.map(() => password)))
        c.connect({
            host: hostOf(address),
            port: 22,
            username: 'root',
            password,
            tryKeyboard: true,
            readyTimeout: 10000,
            hostVerifier: () => true,
        })
    })
}

/** Что стоит на роутере: версия OpenWrt, splify2 и ядра steer. */
async function inspect(address, password) {
    const lines = []
    await run(address, password,
        '. /etc/openwrt_release 2>/dev/null; echo "release=$DISTRIB_RELEASE"; echo "arch=$DISTRIB_ARCH"; ' +
        '{ apk list -I 2>/dev/null || opkg list-installed 2>/dev/null; } | grep -E "^(luci-app-splify2|steer-core)[- ]"',
        (l) => lines.push(l), 30000)
    const out = { release: '', arch: '', splify2: null, steer: null }
    for (const l of lines) {
        let m
        if ((m = l.match(/^release=(.*)$/))) out.release = m[1]
        else if ((m = l.match(/^arch=(.*)$/))) out.arch = m[1]
        else if ((m = l.match(/^luci-app-splify2[- ](?:- )?(\d[\w.]*)/))) out.splify2 = m[1]
        else if ((m = l.match(/^steer-core[- ](?:- )?(\d[\w.]*)/))) out.steer = m[1]
    }
    return out
}

function install(address, password, onLine) {
    return run(address, password, INSTALL, onLine)
}

module.exports = { inspect, install, hostOf }

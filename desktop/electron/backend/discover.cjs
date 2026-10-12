'use strict'
// Поиск роутера для мастера первого запуска.
//
// Кандидаты — шлюз по умолчанию компьютера (почти всегда это и есть роутер), адреса .1 своих
// сетей и несколько типичных адресов OpenWrt. Каждого спрашиваем: есть ли API splify2
// (/v1/info), а если нет — отвечает ли LuCI. Спрашиваем разом и коротко: человек ждёт на экране.

const os = require('node:os')
const fs = require('node:fs')
const { execFile } = require('node:child_process')

const PROBE_MS = 2500
const COMMON = ['192.168.1.1', '192.168.0.1', '192.168.31.1', '192.168.8.1', '10.0.0.1']

function hexIp(h) {
    // /proc/net/route пишет адрес в порядке байт машины (на x86 — младший первым).
    const n = parseInt(h, 16)
    return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255].join('.')
}

function gateways() {
    return new Promise((resolve) => {
        if (process.platform === 'linux') {
            try {
                const rows = fs.readFileSync('/proc/net/route', 'utf8').trim().split('\n').slice(1)
                resolve(rows.map((r) => r.trim().split(/\s+/)).filter((c) => c[1] === '00000000' && c[2] !== '00000000').map((c) => hexIp(c[2])))
            } catch { resolve([]) }
            return
        }
        if (process.platform === 'win32') {
            const ps = "Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | ForEach-Object { $_.NextHop }"
            execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 5000, windowsHide: true }, (err, out) => {
                resolve(err ? [] : String(out).split(/\r?\n/).map((s) => s.trim()).filter((s) => /^\d+\.\d+\.\d+\.\d+$/.test(s) && s !== '0.0.0.0'))
            })
            return
        }
        resolve([])
    })
}

/** Адреса .1 сетей компьютера — запас, если шлюз по умолчанию не роутер (VPN на компьютере). */
function ownNets() {
    const out = []
    for (const list of Object.values(os.networkInterfaces())) {
        for (const a of list || []) {
            if (a.family !== 'IPv4' || a.internal) continue
            const p = a.address.split('.')
            if (p[0] === '169' && p[1] === '254') continue
            out.push(`${p[0]}.${p[1]}.${p[2]}.1`)
        }
    }
    return out
}

async function get(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(PROBE_MS), redirect: 'manual' })
    let text = ''
    try { text = await r.text() } catch { /* тело не дочитали — статус всё равно есть */ }
    return { status: r.status, text }
}

/** Что отвечает по адресу: splify2 с API, OpenWrt без него или ничего (null). */
async function probe(address) {
    const base = /^https?:\/\//i.test(address) ? address.replace(/\/+$/, '') : `http://${address}`
    try {
        const r = await get(`${base}/cgi-bin/splify2-api/v1/info`)
        if (r.status === 200) {
            const j = JSON.parse(r.text)
            if (j?.product === 'splify2') return { address, kind: 'splify2', version: j.version, hostname: j.hostname || '' }
        }
    } catch { /* нет API — смотрим LuCI */ }
    try {
        const r = await get(`${base}/cgi-bin/luci/`)
        if ([200, 302, 403].includes(r.status) && /luci|openwrt/i.test(r.text)) return { address, kind: 'openwrt', hostname: '' }
    } catch { /* не отвечает */ }
    return null
}

async function discover() {
    const gw = await gateways()
    const seen = new Set()
    const cands = [...gw, ...ownNets(), ...COMMON].filter((a) => !seen.has(a) && seen.add(a))
    const found = await Promise.all(cands.map((a) => probe(a).catch(() => null)))
    return found.filter(Boolean).map((f) => ({ ...f, gateway: gw.includes(f.address) }))
}

module.exports = { discover, probe }

'use strict'
// Иконки приложения из логотипа панели (ui/public/favicon.svg): растр рисует сам Electron, ICO
// собирается здесь же из PNG. Запуск: `npm run icons` (без экрана — через xvfb-run). Результат
// лежит в resources/ под git, сборке пакета этот шаг не нужен.

const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'resources')
const SVG = fs.readFileSync(path.join(ROOT, '..', 'ui', 'public', 'favicon.svg'))
// Значок трея «есть сбой»: тот же логотип с красной точкой в углу (цвет --an-danger).
const SVG_ALERT = Buffer.from(SVG.toString().replace('</svg>',
    '<circle cx="50" cy="14" r="12" fill="#f5365c" stroke="#16121f" stroke-width="4"></circle></svg>'))

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()

/** Все размеры — на одной странице, по одному снимку: окно меньше ~100 px Electron не открывает. */
async function renderAll(sizes, alertSizes = []) {
    const W = 1024, H = 1024
    const win = new BrowserWindow({
        width: W, height: H, show: false, frame: false, transparent: true,
        useContentSize: true, webPreferences: { offscreen: true },
    })
    const src = (svg) => 'data:image/svg+xml;base64,' + svg.toString('base64')
    let x = 0, y = 0, row = 0
    const at = {}
    const items = [...sizes.map((s) => [String(s), s, SVG]), ...alertSizes.map((s) => ['a' + s, s, SVG_ALERT])]
    const imgs = items.map(([key, s, svg]) => {
        if (x + s > W) { x = 0; y += row; row = 0 }
        at[key] = { x, y, s }
        const tag = `<img src="${src(svg)}" width="${s}" height="${s}" style="position:absolute;left:${x}px;top:${y}px">`
        x += s
        row = Math.max(row, s)
        return tag
    }).join('')
    const html = `<html><body style="margin:0;background:transparent">${imgs}</body></html>`
    await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
    await new Promise((r) => setTimeout(r, 300))
    const shot = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H })
    win.destroy()
    const out = {}
    for (const [key, a] of Object.entries(at)) out[key] = shot.crop({ x: a.x, y: a.y, width: a.s, height: a.s }).toPNG()
    return out
}

/** ICO с PNG внутри — так его читают Windows Vista и новее, для любого размера. */
function ico(entries) {
    const head = Buffer.alloc(6 + 16 * entries.length)
    head.writeUInt16LE(0, 0)
    head.writeUInt16LE(1, 2)
    head.writeUInt16LE(entries.length, 4)
    let offset = head.length
    entries.forEach(([size, png], i) => {
        const o = 6 + 16 * i
        head.writeUInt8(size >= 256 ? 0 : size, o)
        head.writeUInt8(size >= 256 ? 0 : size, o + 1)
        head.writeUInt8(0, o + 2)
        head.writeUInt8(0, o + 3)
        head.writeUInt16LE(1, o + 4)
        head.writeUInt16LE(32, o + 6)
        head.writeUInt32LE(png.length, o + 8)
        head.writeUInt32LE(offset, o + 12)
        offset += png.length
    })
    return Buffer.concat([head, ...entries.map(([, png]) => png)])
}

app.whenReady().then(async () => {
    fs.mkdirSync(OUT, { recursive: true })
    const sizes = [512, 256, 128, 64, 48, 40, 32, 24, 20, 16]
    const png = await renderAll(sizes, [48, 40, 32, 24, 20, 16])
    fs.writeFileSync(path.join(OUT, 'icon.png'), png[512])
    fs.writeFileSync(path.join(OUT, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((s) => [s, png[s]])))
    fs.writeFileSync(path.join(OUT, 'tray.ico'), ico([16, 20, 24, 32, 40, 48].map((s) => [s, png[s]])))
    fs.writeFileSync(path.join(OUT, 'tray-16.png'), png[16])
    fs.writeFileSync(path.join(OUT, 'tray-32.png'), png[32])
    fs.writeFileSync(path.join(OUT, 'tray-alert.ico'), ico([16, 20, 24, 32, 40, 48].map((s) => [s, png['a' + s]])))
    fs.writeFileSync(path.join(OUT, 'tray-alert-32.png'), png.a32)
    console.log('иконки:', fs.readdirSync(OUT).join(', '))
    app.quit()
})

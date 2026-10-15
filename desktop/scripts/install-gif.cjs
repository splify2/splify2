'use strict'
// Анимация установщика Windows (Squirrel loadingGif) — resources/install.gif: буква «S» логотипа
// сама рисуется на тёмной подложке, держится с мягкой пульсацией и стирается — петля 2,4 с.
// Кадры рисует Electron (как иконки, scripts/icons.cjs), склейку в GIF делает scripts/install-gif.py
// (PIL). Запуск: `npm run install-gif` (без экрана — через xvfb-run -a). Результат лежит под git,
// сборке пакета этот шаг не нужен.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { app, BrowserWindow } = require('electron')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'resources', 'install.gif')
const SIZE = 320      // сторона кадра
const FRAMES = 40
const DELAY_MS = 60   // 40 × 60 мс = 2,4 с

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()

// Подложка и знак — как в ui/public/favicon.svg (#16121f и #8b7cf6), знак крупнее: viewBox 76×76
// на 320 px. Состояние кадра задаёт frame(t), t от 0 до 1 — без таймеров, кадры точные.
const HTML = `<html><body style="margin:0;background:#16121f">
<svg id="s" width="${SIZE}" height="${SIZE}" viewBox="-6 -6 76 76" style="position:absolute;left:0;top:0">
  <defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2"/></filter></defs>
  <rect x="-6" y="-6" width="76" height="76" fill="#16121f"/>
  <path id="glow" d="M46 13 H31 a9.5 9.5 0 0 0 0 19 h2 a9.5 9.5 0 0 1 0 19 H18" stroke="#8b7cf6" stroke-width="7"
        fill="none" stroke-linecap="round" filter="url(#g)" opacity="0"/>
  <path id="p" d="M46 13 H31 a9.5 9.5 0 0 0 0 19 h2 a9.5 9.5 0 0 1 0 19 H18" stroke="#8b7cf6" stroke-width="7"
        fill="none" stroke-linecap="round"/>
</svg>
<script>
const p = document.getElementById('p'), glow = document.getElementById('glow')
const L = p.getTotalLength()
const ease = (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
function frame(t) {
  let from = 0, to = 0, pulse = 0
  if (t < .5) { to = ease(t / .5) }                                        // рисуется
  else if (t < .8) { to = 1; pulse = Math.sin((t - .5) / .3 * Math.PI) }   // держится, пульс
  else { from = ease((t - .8) / .2); to = 1 }                              // стирается с начала
  const len = Math.max(to - from, 0) * L
  for (const e of [p, glow]) {
    e.style.strokeDasharray = len + ' ' + (L + 10)
    e.style.strokeDashoffset = String(-from * L)
  }
  // у круглого колпачка нулевая длина всё равно даёт точку — не рисуем совсем
  p.style.opacity = len < .5 ? 0 : 1
  glow.style.opacity = len < .5 ? 0 : String(.15 + .55 * pulse)
}
</script></body></html>`

app.whenReady().then(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-gif-'))
    // Окно меньше ~100 px Electron не открывает: рисуем в большом, снимаем верхний левый угол.
    const win = new BrowserWindow({
        width: 1024, height: 1024, show: false, frame: false, useContentSize: true,
        webPreferences: { offscreen: true },
    })
    await win.loadURL('data:text/html;base64,' + Buffer.from(HTML).toString('base64'))
    const shot = async () => {
        await new Promise((r) => setTimeout(r, 60))
        return win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
    }
    for (let i = 0; i < FRAMES; i++) {
        await win.webContents.executeJavaScript(`frame(${i / FRAMES})`)
        await shot() // первый снимок после смены может быть прежним кадром — берём второй
        const img = await shot()
        fs.writeFileSync(path.join(tmp, String(i).padStart(3, '0') + '.png'), img.toPNG())
    }
    win.destroy()
    execFileSync('python3', [path.join(__dirname, 'install-gif.py'), tmp, OUT, String(DELAY_MS)], { stdio: 'inherit' })
    fs.rmSync(tmp, { recursive: true, force: true })
    app.quit()
})

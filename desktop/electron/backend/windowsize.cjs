'use strict'
// Размер окна приложения. Окно фиксированное (1120×740, не больше 85 % рабочей области), но
// панель переходит с рельса на нижнюю полосу разделов, когда её ширина в CSS-пикселях меньше
// LG_PX, а ширина страницы — это ширина окна, делённая на масштаб (zoom × BASE_ZOOM). Без
// поправки масштаб 125 и 150 % рвал раскладку: рельса нет, полоса внизу накрывает подпись.

const BASE_W = 1120
const BASE_H = 740
/** Ширина, с которой панель держит рельс (lg у Tailwind — 1024), и небольшой запас. */
const LG_PX = 1024
const MARGIN_PX = 8

/** `factor` — масштаб страницы (zoom/100 × BASE_ZOOM); `waW`, `waH` — рабочая область экрана. */
function windowSize(factor, waW, waH) {
    const need = Math.ceil((LG_PX + MARGIN_PX) * factor)
    // Обычная ширина — не больше 85 % экрана; выросшая ради рельса — не больше 95 %: на таком
    // экране иначе не поместиться, и тогда остаётся нижняя полоса.
    const w = Math.max(Math.min(BASE_W, Math.round(waW * 0.85)), Math.min(need, Math.round(waW * 0.95)))
    const h = Math.min(BASE_H, Math.round(waH * 0.85))
    return [w, h]
}

module.exports = { windowSize, BASE_W, BASE_H }

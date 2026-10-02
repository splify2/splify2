/** rem → px на сборке.
 *
 *  rem считается от размера шрифта корня ДОКУМЕНТА, а корень — территория темы LuCI: у одной
 *  16 px, у другой 13. Все отступы, размеры и кегли Tailwind заданы в rem, и пульт под разными
 *  темами получался разного масштаба. Перевод по 16 px даёт ровно те значения, под которые
 *  нарисован дизайн-пак, и делает их независимыми от темы. */
const remToPx = () => ({
  postcssPlugin: 'splify-rem-to-px',
  Declaration(decl) {
    if (!decl.value.includes('rem')) return
    decl.value = decl.value.replace(/(-?\d*\.?\d+)rem\b/g, (_, n) => `${+(parseFloat(n) * 16).toFixed(3)}px`)
  },
})
remToPx.postcss = true

export default {
  plugins: [
    (await import('tailwindcss')).default,
    remToPx,
    (await import('autoprefixer')).default,
  ],
}

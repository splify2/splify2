import { describe, expect, it } from 'vitest'
import { ccFromName, plainName } from '@/lib/nodename'

/* Значки продавца — ⚡ «быстрый», ⭐ «избранный», 📱 «мобильный», ✅ «торрент разрешён» — несут
 * смысл, и другие клиенты их показывают (жалоба из чата splify2 на подписку StressKVN). Убирается
 * только флаг: его мы рисуем картинкой сами. */
describe('plainName', () => {
    it('оставляет значки продавца', () => {
        expect(plainName('⚡ ⭐ Великобритания')).toBe('⚡ ⭐ Великобритания')
        expect(plainName('📱 Германия #4')).toBe('📱 Германия #4')
        expect(plainName('Польша | Torrent ✅')).toBe('Польша | Torrent ✅')
    })

    it('не рвёт последовательности с селектором начертания и соединителем', () => {
        expect(plainName('⭐️ ⚡️ Нидерланды')).toBe('⭐️ ⚡️ Нидерланды')
        expect(plainName('👨‍💻 Офис')).toBe('👨‍💻 Офис')
    })

    it('убирает флаг, который рисуется отдельно', () => {
        expect(plainName('🇩🇪 Германия')).toBe('Германия')
        expect(plainName('⚡ 🇳🇱 Нидерланды')).toBe('⚡ Нидерланды')
        expect(ccFromName('⚡ 🇳🇱 Нидерланды')).toBe('NL')
    })

    it('пустое и одни флаги', () => {
        expect(plainName('')).toBe('')
        expect(plainName(undefined)).toBe('')
        expect(plainName('🇫🇮')).toBe('')
    })
})

import { render, screen } from '@testing-library/preact'
import { describe, expect, it } from 'vitest'
import EngineCard from '@/components/EngineCard'

// Интерфейс 26.9 опирается на умения движка, появившиеся после выпуска 1.3.0 (sub-fetch,
// srs-read, выход kind=zapret, dev-id, схема спеки 2), а обновление интерфейса из его же
// карточки движок не трогает. До этой карточки человек с 1.3.0 узнавал об этом по одному
// отказу за раз — «подписка не скачалась» без причины. Минимум называет бэкенд полем
// min_version; бэкенд старее интерфейса его не пришлёт, и тогда карточка молчит.

const RELEASES = { arch: 'aarch64_cortex-a53', versions: ['1.5.3', '1.3.0'] }
const noop = () => {}
const card = (engine: Parameters<typeof EngineCard>[0]['engine']) => (
    <EngineCard engine={engine} releases={RELEASES} onInstalled={noop} />
)

describe('движок старее того, под который собран интерфейс', () => {
    it('младше минимума — заголовок и перечень того, что не заработает, с нужной версией', () => {
        render(card({ present: true, vless: true, version: '1.3.0', min_version: '1.5.3' }))
        expect(screen.getByText('Ядро устарело')).toBeInTheDocument()
        expect(screen.getByText(/собран под ядро 1\.5\.3 и новее/)).toBeInTheDocument()
        expect(screen.getByText(/подписка по ссылке/)).toBeInTheDocument()
    })

    it('ровно минимум — обычная карточка', () => {
        render(card({ present: true, vless: true, version: '1.5.3', min_version: '1.5.3' }))
        expect(screen.getByText('Ядро')).toBeInTheDocument()
        expect(screen.queryByText(/собран под ядро/)).toBeNull()
    })

    it('сравнение по числам, а не по строкам: 1.10.0 новее 1.5.3', () => {
        render(card({ present: true, vless: true, version: '1.10.0', min_version: '1.5.3' }))
        expect(screen.queryByText('Ядро устарело')).toBeNull()
    })

    it('бэкенд старее интерфейса минимума не прислал — карточка ничего не утверждает', () => {
        render(card({ present: true, vless: true, version: '1.3.0' }))
        expect(screen.queryByText('Ядро устарело')).toBeNull()
        expect(screen.queryByText(/собран под ядро/)).toBeNull()
    })

    it('устаревший важнее базового: базовый нужного возраста работает, устаревший — нет', () => {
        render(card({ present: true, vless: false, version: '1.3.0', min_version: '1.5.3' }))
        expect(screen.getByText('Ядро устарело')).toBeInTheDocument()
        expect(screen.queryByText('Установлено базовое ядро')).toBeNull()
    })
})

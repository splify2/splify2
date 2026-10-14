import { render, screen } from '@testing-library/preact'
import { describe, expect, it } from 'vitest'
import Rail from '@/components/Rail'
import { live } from './fixtures'

// Ссылки в подвале рельса (STEER-CORE-803): сообщить о проблеме, поддержать, чат.
// Открываются во внешнем окне, поэтому target и rel проверяются вместе с адресом.

const noop = () => {}

const LINKS = [
    { name: 'Сообщить о проблеме', href: 'https://t.me/splifybugbot' },
    { name: 'Поддержать проект', href: 'https://pay.cloudtips.ru/p/fb925110' },
    { name: 'Чат в Telegram', href: 'https://t.me/ssplify' },
]

describe('ссылки в подвале рельса', () => {
    for (const { name, href } of LINKS) {
        it(`«${name}» ведёт на ${href} во внешнем окне`, () => {
            render(<Rail live={live({})} section="home" onSection={noop} counts={{}} />)
            const links = screen.getAllByRole('link', { name })
            // ссылка только в широком рельсе, в нижней панели её нет
            expect(links).toHaveLength(1)
            expect(links[0]).toHaveAttribute('href', href)
            expect(links[0]).toHaveAttribute('target', '_blank')
            expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer')
        })
    }
})

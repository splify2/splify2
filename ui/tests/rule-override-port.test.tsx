import { fireEvent, render, screen } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RuleEditor from '@/components/tabs/RuleEditor'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { decodeSpec, encodeSpec } from '@/lib/specv2'
import { S } from '@/copy'
import type { Channel, Spec } from '@/lib/model'

// Подмена порта у доменов правила (`override_port` списка спеки v2) — решение владельца: поле
// «порт» в редакторе правила для доменных списков в режиме fakeip. Ядро принимает её только у
// списка имён и только в fakeip (spec-v2.md, `lists`; generate.c — отказ при realip), поэтому
// поле есть только там, а смена режима на realip подмену снимает.

const DOM = '/etc/steer/lists/youtube.lst'
const PFX = '/etc/steer/lists/youtube-ip.lst'
const OUTPUTS = { direct: { kind: 'direct', up: true } } as never

function mount(ch: Channel) {
    const changes: Channel[] = []
    render(
        <RuleEditor ch={ch} index={0} services={[]} local={{}} outputs={OUTPUTS} clash={null} rulesTotal={1}
            coveredBy={[]} onChange={(c) => changes.push(c)} onClose={() => {}} onDelete={() => {}} />,
    )
    return changes
}

const base: Channel = { name: 'yt', out: 'direct', match: { domains_files: [DOM], prefixes_files: [PFX], mode: 'fakeip' } } as Channel

beforeEach(() => {
    vi.restoreAllMocks()
    pending.saved = null
    vi.spyOn(rpc, 'leases').mockResolvedValue({ leases: [] } as never)
    vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
})

describe('порт назначения у доменов правила', () => {
    it('fakeip: поле есть, число уходит в override_port доменных файлов, подсети не трогаются', () => {
        const changes = mount(base)
        fireEvent.input(screen.getByLabelText(S.ruleEditor.portNaznacheniya), { target: { value: '8443' } })
        const ch = changes.at(-1)!
        expect(ch.file_extra).toEqual({ [DOM]: { override_port: 8443 } })
        // В спеке — отдельный список имён с подменой (подсети рядом её не несут), и обратно
        // правило читается тем же.
        const spec = { outputs: { direct: { name: 'direct', kind: 'direct' } }, channels: [ch] } as Spec
        const doc = encodeSpec(spec)
        const lists = Object.values(doc.lists as Record<string, Record<string, unknown>>)
        expect(lists).toContainEqual({ domains_file: [DOM], override_port: 8443 })
        expect(lists).toContainEqual({ prefixes_file: [PFX] })
        const back = decodeSpec(doc).channels
        expect(back).toHaveLength(1)
        expect(back[0].file_extra).toEqual({ [DOM]: { override_port: 8443 } })
    })

    it('пустое поле снимает подмену', () => {
        const changes = mount({ ...base, file_extra: { [DOM]: { override_port: 8443 } } })
        const box = screen.getByLabelText(S.ruleEditor.portNaznacheniya) as HTMLInputElement
        expect(box.value).toBe('8443')
        fireEvent.input(box, { target: { value: '' } })
        expect(changes.at(-1)!.file_extra).toBeUndefined()
    })

    it('порт вне 1..65535 не пишется и называется', () => {
        const changes = mount(base)
        fireEvent.input(screen.getByLabelText(S.ruleEditor.portNaznacheniya), { target: { value: '70000' } })
        expect(changes).toHaveLength(0)
        expect(screen.getByText(S.ruleEditor.portOt1Do65535)).toBeInTheDocument()
    })

    it('realip: поля нет', () => {
        mount({ ...base, match: { ...base.match, mode: 'realip' } })
        expect(screen.queryByLabelText(S.ruleEditor.portNaznacheniya)).toBeNull()
    })

    it('правило без доменов: поля нет', () => {
        mount({ ...base, match: { prefixes_files: [PFX] } })
        expect(screen.queryByLabelText(S.ruleEditor.portNaznacheniya)).toBeNull()
    })

    it('смена режима на realip снимает подмену — иначе ядро не примет правило', () => {
        const changes = mount({ ...base, file_extra: { [DOM]: { override_port: 8443 } } })
        fireEvent.click(screen.getByText(S.ruleEditor.realIpDeshevle))
        const ch = changes.at(-1)!
        expect(ch.match.mode).toBe('realip')
        expect(ch.file_extra).toBeUndefined()
    })
})

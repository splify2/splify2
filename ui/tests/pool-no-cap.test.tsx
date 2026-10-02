import { render, screen } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PoolEditor from '@/components/PoolEditor'
import { rpc } from '@/lib/rpc'
import { type Output, type Spec } from '@/lib/model'
import { live } from './fixtures'

// Пределов на число частей пула в ядре steer 2.0 нет (src/model/spec.h: «пределов по числу …
// членов группы и узлов в спеке нет»; единственный настоящий — метки выходов, его называет само
// ядро с числом). Редактор пула отказывал на семнадцатой части словами «таков предел ядра», а
// имя новой части перебирал только до «-9» и на занятом «-9» затирал чужой выход.

const SUBS = [
    { name: 'main', title: 'Riot', path: '/etc/steer/sub.txt', present: true, kind: 'url' },
    { name: 'blue', title: 'Blue', path: '/etc/steer/subs/blue.txt', present: true, kind: 'url' },
]
const NODES: Record<string, { index: number; name: string }[]> = {
    '/etc/steer/sub.txt': [{ index: 0, name: 'Германия' }],
    '/etc/steer/subs/blue.txt': [{ index: 0, name: 'Амстердам' }],
}
const withPools = live({
    status: { schema: 1, features: ['lan_devices', 'nodes', 'pool'], outputs: {}, channels: [] },
})
const click = async (name: RegExp | string) => {
    ;(await screen.findByRole('button', { name })).click()
    await new Promise((r) => setTimeout(r, 10))
}

function build(spec: Spec, name?: string) {
    let saved: Spec | null = null
    render(<PoolEditor spec={spec} name={name} live={withPools} onCancel={() => {}} onSave={(n) => { saved = n }} />)
    return () => saved
}

describe('у пула нет предела частей', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] })
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: SUBS } as never)
        vi.spyOn(rpc, 'vlessNodesOfSub').mockImplementation(
            (async (path: string) => ({
                output: '', sub_file: path, node: -1, chosen: [], usable: 0, skipped: 0, foreign: 0,
                nodes: NODES[path] || [],
            })) as never,
        )
    })

    it('восемнадцать частей сохраняются', async () => {
        /* Части чередуют подписки, поэтому соседние в одну не сливаются. */
        const outputs: Record<string, Output> = {}
        const devices: string[] = []
        for (let i = 1; i <= 18; i++) {
            const n = `big-${i}`
            outputs[n] = { name: n, kind: 'vless', sub_file: SUBS[i % 2].path, node: 0, on_fail: 'drop', part_of: 'big' }
            devices.push(n)
        }
        outputs.big = { name: 'big', kind: 'interface', devices, device: devices[0], on_fail: 'drop' }
        const saved = build({ schema: 1, outputs, channels: [] }, 'big')
        await screen.findByRole('button', { name: 'убрать строку 18' })
        await click(/Сохранить выход/)
        expect(saved()?.outputs.big.devices).toEqual(devices)
    })

    it('имя новой части не упирается в «-9» и не затирает занятое', async () => {
        const outputs: Record<string, Output> = {}
        for (let i = 1; i <= 9; i++) outputs[`vpn-${i}`] = { name: `vpn-${i}`, kind: 'interface', device: `wg${i}` }
        const saved = build({ schema: 1, outputs, channels: [] })
        const title = screen.getByLabelText('имя выхода') as HTMLInputElement
        title.value = 'vpn'
        title.dispatchEvent(new Event('input', { bubbles: true }))
        await click(/Германия/)
        await click(/Амстердам/)
        await click(/Сохранить выход/)
        const out = saved()!.outputs
        for (let i = 1; i <= 9; i++) expect(out[`vpn-${i}`]).toEqual(outputs[`vpn-${i}`])
        const parts = out.vpn.devices!
        expect(parts).toHaveLength(2)
        expect(new Set(parts).size).toBe(2)
        for (const p of parts) {
            expect(out[p]).toMatchObject({ kind: 'vless', part_of: 'vpn' })
            expect(p.length).toBeLessThanOrEqual(15)
        }
    })
})

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Block, CardHead } from '@/components/ui/layout'
import { inputCls } from '@/components/formbits'
import { notify } from '@/lib/notify'
import { rpc } from '@/lib/rpc'
import { useRemembered } from '@/lib/cache'
import { isDevice, isDeviceAll, vpnOutputs, withDeviceAll } from '@/lib/devicevpn'
import type { Spec } from '@/lib/model'

import { S } from '@/copy'
/** «Весь трафик устройства — в VPN»: карточка на экране правил. Выбрать устройство из аренд (в правило
 *  ложится MAC: адрес по DHCP меняется, MAC живёт вместе с устройством) или набрать адрес, выбрать
 *  выход — и всё его соединение с интернетом идёт через выход. Логика правила — lib/devicevpn.ts. */
export default function DeviceVpn({ spec, onSpec, onClose, onGoOutbounds }: {
    spec: Spec
    onSpec: (next: Spec) => void
    onClose: () => void
    onGoOutbounds?: () => void
}) {
    const leases = useRemembered('leases', () => rpc.leases().then((r) => r.leases || [])) ?? []
    const outs = vpnOutputs(spec.outputs)
    const [picked, setPicked] = useState('')
    const [typed, setTyped] = useState('')
    const [out, setOut] = useState(outs[0] ?? '')
    const device = (typed.trim() || picked).trim()
    const bad = !!typed.trim() && !isDevice(typed)
    const lease = leases.find((l) => l.mac === device || l.ip === device)
    const label = lease?.name || lease?.ip || device
    const chosen = outs.includes(out) ? out : outs[0]
    /* Устройства, которым уже назначено «всё в выход»: видно, что есть, и повторный выбор правит выход. */
    const have = spec.channels.filter(isDeviceAll)

    function go() {
        if (!device || bad || !chosen) return
        const was = have.find((c) => c.from![0].toLowerCase() === device.toLowerCase())
        onSpec(withDeviceAll(spec, device, label, chosen))
        notify(was && was.out === chosen && was.enabled !== false ? S.deviceVpn.uzheEst(label, chosen) : S.deviceVpn.vklyucheno(label, chosen))
        onClose()
    }

    return (
        <Block>
            <CardHead title={S.deviceVpn.zagolovok}
                      action={<Button variant="ghost" size="sm" onClick={onClose}>{S.deviceVpn.zakryt}</Button>} />
            {outs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    {S.deviceVpn.netVyhoda}{' '}
                    {onGoOutbounds && (
                        <button type="button" onClick={onGoOutbounds} className="text-primary underline decoration-dotted">
                            {S.rulesTab.nastroitVyhodVpn}</button>
                    )}
                </p>
            ) : (
                <>
                    <div className="space-y-1">
                        <div className="text-xs text-subtle">{S.deviceVpn.ustroystvo}</div>
                        {leases.length > 0 ? (
                            <div role="radiogroup" aria-label={S.deviceVpn.ustroystvo} className="max-h-48 divide-y divide-border overflow-y-auto">
                                {leases.map((l) => (
                                    <label key={l.mac} className="flex min-h-[44px] cursor-pointer items-center gap-3 py-1.5 text-sm">
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate">{l.name || l.ip}</span>
                                            <span className="block truncate font-mono text-xs text-muted-foreground">{l.ip} · {l.mac}</span>
                                        </span>
                                        <input type="radio" name="device-vpn" checked={!typed.trim() && picked === l.mac}
                                               onChange={() => { setPicked(l.mac); setTyped('') }} className="shrink-0" />
                                    </label>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground">{S.deviceVpn.netUstroystv}</p>
                        )}
                    </div>
                    <label className="flex flex-col gap-1.5 text-xs text-subtle">
                        {S.deviceVpn.svoyAdres}
                        <input value={typed} onChange={(e) => setTyped(e.currentTarget.value)}
                               placeholder={S.deviceVpn.adresPlaceholder} className={`${inputCls} font-mono`} />
                    </label>
                    {bad && <p className="text-xs text-destructive">{S.deviceVpn.neUstroystvo}</p>}
                    <label className="flex flex-col gap-1.5 text-xs text-subtle">
                        {S.deviceVpn.vyhod}
                        <select value={chosen} onChange={(e) => setOut(e.currentTarget.value)} className={`${inputCls} w-full`}>
                            {outs.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </label>
                    <Button onClick={go} disabled={!device || bad} className="w-full">{S.deviceVpn.vklyuchit}</Button>
                </>
            )}
            {have.length > 0 && (
                <ul className="divide-y divide-border text-sm">
                    {have.map((c) => (
                        <li key={c.name} className="flex gap-2 py-1.5">
                            <span className="min-w-0 flex-1 truncate">{leases.find((l) => l.mac.toLowerCase() === c.from![0].toLowerCase())?.name || c.from![0]}</span>
                            <span className="text-muted-foreground">{S.deviceVpn.cherez} {c.out}{c.enabled === false ? S.rulesTab.vyklyucheno : ''}</span>
                        </li>
                    ))}
                </ul>
            )}
        </Block>
    )
}

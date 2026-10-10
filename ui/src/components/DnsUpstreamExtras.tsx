import { ToggleRow } from '@/components/ui/layout'
import { fragmentApplies, withFragment } from '@/lib/dnsurl'
import type { Upstream } from '@/lib/model'
import { S } from '@/copy'

/** Под адресом сервера DNS: выключатель «Делить первый пакет» (только `tls://` и `https://`) и
 *  отказ для `h3://` на ядре, которое такого адреса не знает. Выключатель без умения ядра
 *  виден, только если ключ уже стоит в спеке, — чтобы его можно было снять. */
export default function DnsUpstreamExtras({ up, onChange, fragmentOk, h3Ok }: {
    up: Upstream
    onChange: (next: Upstream) => void
    fragmentOk: boolean
    h3Ok: boolean
}) {
    const showToggle = fragmentApplies(up.url) && (fragmentOk || !!up.fragment)
    const h3Bad = /^h3:\/\//i.test(up.url.trim()) && !h3Ok
    return (
        <>
            {showToggle && (
                <ToggleRow
                    label={S.dns.delitPervyyPaket}
                    on={!!up.fragment}
                    onToggle={() => onChange(withFragment(up, !up.fragment))}
                />
            )}
            {h3Bad && <p className="text-xs text-destructive">{S.dns.h3NuzhnoNovoeYadro}</p>}
        </>
    )
}

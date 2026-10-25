import { ToggleRow } from '@/components/ui/layout'
import { fragmentApplies, withFragment } from '@/lib/dnsurl'
import type { Upstream } from '@/lib/model'
import { S } from '@/copy'

/** Под адресом сервера DNS: выключатель «Делить первый пакет» (только `tls://` и `https://`). */
export default function DnsUpstreamExtras({ up, onChange }: {
    up: Upstream
    onChange: (next: Upstream) => void
}) {
    if (!fragmentApplies(up.url)) return null
    return (
        <ToggleRow
            label={S.dns.delitPervyyPaket}
            on={!!up.fragment}
            onToggle={() => onChange(withFragment(up, !up.fragment))}
        />
    )
}

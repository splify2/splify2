import { useEffect, useMemo, useState } from 'react'
import { rpc } from '@/lib/rpc'
import { customServices, toAllowDomainsServices, toCatalog, type ServiceEntry } from '@/lib/model'

/** Сервисы каталога и свои списки — для подписей правил. Тот же порядок, что у вкладки правил
 *  (RulesTab): манифест первого издателя, без него — второй (allow-domains), плюс свои списки
 *  с роутера. Ошибки молчат: без каталога правило подписывается файлами, а не сервисами. */
export function useServices(): ServiceEntry[] {
    const [catalog, setCatalog] = useState<ServiceEntry[]>([])
    const [local, setLocal] = useState<Record<string, { count: number; mtime: number }>>({})
    useEffect(() => {
        rpc.manifest()
            .then((m) => {
                const c = toCatalog(m)
                if (!c.services.length) throw new Error('empty catalog')
                setCatalog(c.services)
            })
            .catch(() =>
                rpc.allowDomains()
                    .then((a) => setCatalog(toAllowDomainsServices(a)))
                    .catch(() => setCatalog([])),
            )
        rpc.localLists().then((d) => setLocal(d.files || {})).catch(() => setLocal({}))
    }, [])
    return useMemo(() => [...catalog, ...customServices(local)], [catalog, local])
}

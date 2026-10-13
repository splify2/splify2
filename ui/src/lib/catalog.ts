import { useMemo } from 'react'
import { rpc } from '@/lib/rpc'
import { useRemembered } from '@/lib/cache'
import { customServices, toAllowDomainsServices, toCatalog, type ServiceEntry } from '@/lib/model'

/** Сервисы каталога и свои списки — для подписей правил. Тот же порядок, что у вкладки правил
 *  (RulesTab): манифест первого издателя, без него — второй (allow-domains), плюс свои списки
 *  с роутера. Ошибки молчат: без каталога правило подписывается файлами, а не сервисами. */
export function useServices(): ServiceEntry[] {
    const catalog = useCatalog() ?? []
    const local = useLocalLists() ?? {}
    return useMemo(() => [...catalog, ...customServices(local)], [catalog, local])
}

/** Сервисы каталога — сразу из памяти (lib/cache.ts), свежие — когда ответит роутер. */
export function useCatalog(): ServiceEntry[] | null {
    return useRemembered('catalog-services', () =>
        rpc.manifest()
            .then((m) => {
                const c = toCatalog(m)
                if (!c.services.length) throw new Error('empty catalog')
                return c.services
            })
            .catch(() => rpc.allowDomains().then((a) => toAllowDomainsServices(a))))
}

/** Свои списки роутера (имя → число записей, время) — сразу из памяти. */
export function useLocalLists(): Record<string, { count: number; mtime: number }> | null {
    return useRemembered('local-lists', () => rpc.localLists().then((d) => d.files || {}))
}

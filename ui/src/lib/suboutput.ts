import { notify } from '@/lib/notify'
import { pending } from '@/lib/pending'
import { addSubOutput } from '@/lib/ruleout'
import { subProtos } from '@/lib/subnodes'
import type { Spec } from '@/lib/model'

import { S } from '@/copy'
/** Есть ли в спеке выход (в том числе часть пула), читающий файл этой подписки. */
export function hasSubOutput(spec: Spec | null, path: string): boolean {
    return !!spec && Object.values(spec.outputs).some((o) => o.sub_file === path)
}

/** Завести выход на узлах подписки и записать правку (применяется само: lib/autoapply.ts).
 *  Возвращает имя выхода или null, если завести нечем: спека не загружена или набор не собирается. */
export async function makeSubOutput(sub: { name: string; path: string }): Promise<string | null> {
    if (!pending.saved) return null
    let protos: Awaited<ReturnType<typeof subProtos>> = []
    try { protos = await subProtos(sub.path) } catch { /* протоколы не названы — VLESS, как в мастере */ }
    /* Спека читается ПОСЛЕ ожидания: за время вопроса к роутеру человек мог править. */
    const cur = pending.saved
    if (!cur) return null
    const r = addSubOutput(cur, { path: sub.path, base: sub.name }, protos)
    if (!r) return null
    if (r.created) pending.edit(r.spec)
    notify(r.created ? S.vlessScreen.vyhodSozdan(r.name) : S.vlessScreen.vyhodUzheEst(r.name), 'info')
    return r.name
}


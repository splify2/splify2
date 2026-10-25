import { useEffect } from 'react'
import { useConfirm, type ConfirmRequest } from '@/components/ui/confirm'

/** Диалог подтверждения панели для плагинов (`host.confirm`): компонент стоит в оболочке один раз и
 *  отдаёт функцию вызова модулю; без оболочки (стенд) подтверждение отклоняется — безопасный ответ. */
let ask: ((req: ConfirmRequest) => Promise<boolean>) | null = null

export function confirmFromPlugin(req: ConfirmRequest): Promise<boolean> {
    return ask ? ask(req) : Promise.resolve(false)
}

export function ConfirmHost() {
    const [confirm, dialog] = useConfirm()
    useEffect(() => {
        ask = confirm
        return () => { if (ask === confirm) ask = null }
    }, [confirm])
    return <>{dialog}</>
}

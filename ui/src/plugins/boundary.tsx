import { Component, type ReactNode } from 'react'
import { S } from '@/copy'

/** Предохранитель слота: ошибка отрисовки плагина не роняет панель (host-api.md, «Слоты»).
 *
 *  На месте упавшего слота — строка «Плагин X не отрисовался» и действие «Отключить». Сброс — по
 *  смене `reset` (например, плагин перезагрузили). Ошибка уходит и в консоль: плагин пишет
 *  его автор, и ему нужен стек. */
interface Props {
    /** Имя плагина для человека. */
    name: string
    /** Отключить плагин (в этой сессии и на роутере); нет — действия нет. */
    onDisable?: () => void
    reset?: unknown
    /** Что показать вместо упавшего: по умолчанию строка с действием. Плитки на доске обходятся без неё. */
    quiet?: boolean
    children?: ReactNode
}

export class PluginGuard extends Component<Props, { error: unknown; reset: unknown }> {
    state = { error: null as unknown, reset: this.props.reset }

    static getDerivedStateFromError(error: unknown) {
        return { error: error ?? new Error('render failed') }
    }

    static getDerivedStateFromProps(props: Props, state: { error: unknown; reset: unknown }) {
        return props.reset !== state.reset ? { error: null, reset: props.reset } : null
    }

    componentDidCatch(error: unknown) {
        console.error(`[plugin ${this.props.name}]`, error)
    }

    render() {
        if (this.state.error === null) return this.props.children
        if (this.props.quiet) return null
        return (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm">
                <span className="min-w-0 flex-1">{S.plugins.neOtrisovalsya(this.props.name)}</span>
                {this.props.onDisable && (
                    <button type="button" className="text-primary underline decoration-dotted" onClick={this.props.onDisable}>
                        {S.plugins.otklyuchit}
                    </button>
                )}
            </div>
        )
    }
}

/** Вызов `render` плагина ВНУТРИ дерева предохранителя: исключение, брошенное при вызове, поймано
 *  им же. Вызов `slot.render(...)` в теле родителя ловить было бы нечем. */
export function SlotView({ render }: { render: () => unknown }): ReactNode {
    return render() as ReactNode
}

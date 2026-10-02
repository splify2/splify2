import React from "react";
import type { HTMLAttributes, ReactNode, CSSProperties } from "react";
/**
 * Строка списка объектов. Номер и ручка появляются, когда порядок значит приоритет.
 *
 * @startingPoint section="Data" subtitle="Строка списка с порядком и действиями" viewport="700x150"
 */
export interface ListRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "style" | "title"> {
    /** Порядковый номер: показывайте только там, где порядок влияет на поведение. */
    index?: number | null;
    handle?: boolean;
    title?: ReactNode;
    subtitle?: ReactNode;
    /** Выключенный объект: 50% прозрачности, но остаётся на месте. */
    dimmed?: boolean;
    actions?: ReactNode;
    children?: ReactNode;
    style?: CSSProperties;
}
export declare function ListRow({ index, handle, title, subtitle, dimmed, actions, children, style, ...rest }: ListRowProps): React.JSX.Element;

import React from "react";
import type { CSSProperties, ReactNode } from "react";
export interface TableColumn<T = any> {
    key: string;
    title: ReactNode;
    align?: "left" | "right";
    width?: number | string;
    render?: (row: T) => ReactNode;
    sortable?: boolean;
    nowrap?: boolean;
}
/**
 * Таблица чисел: рейтинг, помесячные итоги, цели. Числа — вправо и табличными цифрами,
 * заголовок — капсом 11px, строки разделены мягкой линией, сортировка по клику на заголовок.
 *
 * @startingPoint section="Analytics" subtitle="Таблица чисел с сортировкой" viewport="700x150"
 */
export interface TableProps<T = any> {
    columns?: TableColumn<T>[];
    rows?: T[];
    rowKey?: (row: T, index: number) => string | number;
    sortKey?: string | null;
    onSort?: (key: string) => void;
    dense?: boolean;
    caption?: ReactNode;
    /** Ниже этой ширины таблица не сжимается, а прокручивается — иначе столбцы давятся до букв. */
    minWidth?: number;
    style?: CSSProperties;
}
export declare function Table({ columns, rows, rowKey, sortKey, onSort, dense, caption, minWidth, style }: TableProps): React.JSX.Element;

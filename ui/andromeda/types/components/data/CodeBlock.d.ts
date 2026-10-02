import React from "react";
import type { ReactNode, CSSProperties } from "react";
/** Дословный вывод движка: логи, ответ «куда пойдёт запрос», команды. Ничего не переводим. */
export interface CodeBlockProps {
    children?: ReactNode;
    maxHeight?: number;
    style?: CSSProperties;
}
export declare function CodeBlock({ children, maxHeight, style }: CodeBlockProps): React.JSX.Element;

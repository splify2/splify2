import React from "react";
import type { ReactNode, CSSProperties } from "react";


/** Дословный вывод движка: логи, ответ «куда пойдёт запрос», команды. Ничего не переводим. */
export interface CodeBlockProps {
  children?: ReactNode;
  maxHeight?: number;
  style?: CSSProperties;
}

export function CodeBlock({ children, maxHeight = 220, style }: CodeBlockProps) {
  return (
    <pre
      style={{
        margin: 0,
        padding: "12px 14px",
        maxHeight,
        overflow: "auto",
        borderRadius: "var(--an-radius-block)",
        border: "1px solid var(--an-border)",
        background: "var(--an-surface-field)",
        color: "var(--an-text)",
        font: "var(--an-text-code)",
        whiteSpace: "pre-wrap",
        ...style,
      }}
    >
      {children}
    </pre>
  );
}

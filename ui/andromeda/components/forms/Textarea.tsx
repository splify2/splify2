import React from "react";
import type { TextareaHTMLAttributes, CSSProperties } from "react";


/** Многострочный ввод: свои списки доменов и подсетей, по одной записи в строке. */
export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "style"> {
  rows?: number;
  /** По умолчанию моношрифт: сюда вставляют данные, а не прозу. */
  mono?: boolean;
  style?: CSSProperties;
}

export function Textarea({ rows = 4, mono = true, style, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: "var(--an-radius-control)",
        border: "1px solid var(--an-border)",
        background: "var(--an-surface-input)",
        color: "var(--an-text)",
        font: mono ? "var(--an-text-code)" : "var(--an-text-body)",
        resize: "vertical",
        ...style,
      }}
      {...rest}
    />
  );
}

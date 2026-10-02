import React from "react";
import type { TextareaHTMLAttributes, CSSProperties } from "react";
/** Многострочный ввод: свои списки доменов и подсетей, по одной записи в строке. */
export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "style"> {
    rows?: number;
    /** По умолчанию моношрифт: сюда вставляют данные, а не прозу. */
    mono?: boolean;
    style?: CSSProperties;
}
export declare function Textarea({ rows, mono, style, ...rest }: TextareaProps): React.JSX.Element;

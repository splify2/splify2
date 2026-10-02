import React from "react";
import type { LabelHTMLAttributes, ReactNode, CSSProperties } from "react";
/** Обёртка поля: подпись сверху, подсказка или ошибка снизу. Ошибка вытесняет подсказку. */
export interface FieldProps extends Omit<LabelHTMLAttributes<HTMLLabelElement>, "style"> {
    label?: ReactNode;
    /** Пишите только то, без чего можно сделать неверное действие. */
    hint?: ReactNode;
    error?: ReactNode;
    children?: ReactNode;
    style?: CSSProperties;
}
export declare function Field({ label, hint, error, children, style, ...rest }: FieldProps): React.JSX.Element;

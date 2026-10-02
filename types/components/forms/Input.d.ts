import React from "react";
import type { InputHTMLAttributes, ReactNode, CSSProperties } from "react";
/**
 * Однострочное поле. Ведущая иконка — для поиска, mono — для адресов и ссылок.
 *
 * @startingPoint section="Forms" subtitle="Поля, поиск, состояние ошибки" viewport="700x150"
 */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "style"> {
    icon?: ReactNode;
    /** Счётчик или единица справа внутри рамки. */
    trailing?: ReactNode;
    /** Жёлтая рамка: значение введено, но роутер его не примет. */
    invalid?: boolean;
    mono?: boolean;
    style?: CSSProperties;
}
export declare function Input({ icon, trailing, invalid, mono, style, ...rest }: InputProps): React.JSX.Element;

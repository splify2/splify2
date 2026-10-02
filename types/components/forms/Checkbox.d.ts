import React from "react";
import type { ReactNode, CSSProperties } from "react";
/** Выбор нескольких из списка: сервисы в правиле, устройства из аренд DHCP. */
export interface CheckboxProps {
    checked?: boolean;
    onChange?: () => void;
    label?: ReactNode;
    /** Правый край строки: количество записей, тип, адрес. */
    meta?: ReactNode;
    children?: ReactNode;
    style?: CSSProperties;
}
export declare function Checkbox({ checked, onChange, label, meta, children, style }: CheckboxProps): React.JSX.Element;

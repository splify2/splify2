import React from "react";
import type { CSSProperties } from "react";
/**
 * Включатель объекта. Меняет состояние сразу — без «Сохранить» рядом.
 *
 * @startingPoint section="Forms" subtitle="Тумблеры, радио, чекбоксы, сегменты" viewport="700x150"
 */
export interface SwitchProps {
    checked?: boolean;
    onChange?: () => void;
    /** Обязателен, когда рядом нет видимой подписи. */
    label?: string;
    /** lg — для телефона: 48×28 при зоне нажатия 44px. */
    size?: "md" | "lg";
    disabled?: boolean;
    style?: CSSProperties;
}
export declare function Switch({ checked, onChange, label, size, disabled, style }: SwitchProps): React.JSX.Element;

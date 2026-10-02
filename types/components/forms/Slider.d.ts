import React from "react";
import type { CSSProperties } from "react";
/**
 * Ползунок с числом справа — для параметров с границами (полуспад, порог доверия).
 * Число редактируемо точно, ползунок — быстро; вместе они не дают выйти за разумное.
 */
export interface SliderProps {
    value?: number;
    min?: number;
    max?: number;
    step?: number;
    /** Единица после числа: «дней», «σ», «×». */
    unit?: string;
    onChange?: (value: number) => void;
    disabled?: boolean;
    /** Обязателен, когда рядом нет видимой подписи. */
    label?: string;
    style?: CSSProperties;
}
export declare function Slider({ value, min, max, step, unit, onChange, disabled, label, style }: SliderProps): React.JSX.Element;

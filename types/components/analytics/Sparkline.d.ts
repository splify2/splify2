import React from "react";
import type { CSSProperties } from "react";
/**
 * Микрографик тенденции без осей: форма ряда рядом с числом.
 * Показывает направление, а не значения — их читают из числа рядом.
 *
 * @startingPoint section="Analytics" subtitle="Графики: спарклайн, столбцы, линии, тепловая карта, легенда" viewport="700x150"
 */
export interface SparklineProps {
    /** Ряд по порядку; null — пропуск. */
    values?: Array<number | null>;
    width?: number;
    height?: number;
    /** accent — главный ряд; off — второстепенный; ink — нейтральный. */
    tone?: "accent" | "off" | "ink";
    /** Горизонтальная пунктирная линия уровня: цель, план. */
    reference?: number | null;
    style?: CSSProperties;
}
export declare function Sparkline({ values, width, height, tone, reference, style }: SparklineProps): React.JSX.Element;

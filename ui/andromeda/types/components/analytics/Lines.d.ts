import React from "react";
import type { CSSProperties } from "react";
import type { SeriesTone } from "./chart-core";
export interface LineSeries {
    /** Имя ряда — в подсказке по наведению. */
    label?: string;
    values: Array<number | null>;
    tone?: SeriesTone;
    /** Пунктир — всё прогнозное; факт всегда сплошной. */
    dashed?: boolean;
    width?: number;
    /** Точки на каждом значении (по умолчанию — только «где сейчас» у главного ряда). */
    points?: boolean;
    /** Индексы точек, нарисованных полыми: значение есть, но ему доверяют меньше. */
    hollow?: number[];
    /** Подписи значений над точками этого ряда (когда точек не больше 14). */
    valueLabels?: boolean;
}
/**
 * Линии по времени: факт и прогноз одного показателя, несколько рядов одного масштаба.
 * Одна ось Y от нуля; пунктир кодирует прогноз, чернила — план. Наведение показывает
 * все ряды в этой точке.
 */
export interface LinesProps {
    series?: LineSeries[];
    labels?: string[];
    height?: number;
    /** Формат оси Y и подписей значений. */
    format?: (v: number) => string;
    /** Формат чисел в подсказке (по умолчанию — `format`). */
    tipFormat?: (v: number) => string;
    yTicks?: number;
    /** Точка на последнем значении сплошных рядов: «где сейчас». */
    markLast?: boolean;
    /** Плавная монотонная кривая между точками (не создаёт ложных горбов). */
    smooth?: boolean;
    /** Индексы категорий с подложкой: выходные, праздники. */
    bands?: number[];
    /** Горизонтальный уровень чернилами: план, цель. */
    reference?: number | null;
    /** Подпись уровня у правого края. */
    referenceLabel?: string;
    /** Подсказка по наведению. */
    tooltip?: boolean;
    style?: CSSProperties;
}
export declare function Lines({ series, labels, height, format, tipFormat, yTicks, markLast, smooth, bands, reference, referenceLabel, tooltip, style }: LinesProps): React.JSX.Element;

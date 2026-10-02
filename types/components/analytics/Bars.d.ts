import React from "react";
import type { CSSProperties } from "react";
import type { SeriesTone } from "./chart-core";
export interface BarSeries {
    /** Имя ряда — в подсказке по наведению. */
    label?: string;
    values: Array<number | null>;
    /** accent — главный ряд, off — второстепенный, soft — заливка ожидания. */
    tone?: SeriesTone;
    /** Плотность заливки: half — незавершённая часть (идущий час), ghost — ожидание пунктирным контуром.
     *  Один показатель в трёх состояниях — один цвет, различает их плотность. */
    fill?: "solid" | "half" | "ghost";
    /** В стопке — рисовать этот ряд отдельным столбцом рядом со стопкой (эталон рядом с фактом). */
    beside?: boolean;
}
export interface BarLine {
    label?: string;
    values: Array<number | null>;
    tone?: SeriesTone;
    dashed?: boolean;
    width?: number;
    /** Точки на значениях. */
    points?: boolean;
}
/**
 * Столбцы по категориям (дни, часы, месяцы). Группами или стопкой, с линиями того же
 * масштаба поверх. Одна ось; значения подписаны прямо на столбцах, когда их не больше 14,
 * иначе — ось слева и подсказка по наведению.
 */
export interface BarsProps {
    series?: BarSeries[];
    labels?: string[];
    stacked?: boolean;
    height?: number;
    /** auto — подписи значений при ≤14 категориях; all / none — принудительно. */
    valueLabels?: "auto" | "all" | "none";
    /** Какой ряд подписывать (индекс в `series`); по умолчанию — итог стопки или максимум группы. */
    labelSeries?: number;
    format?: (v: number) => string;
    /** Формат чисел в подсказке (по умолчанию — `format`). */
    tipFormat?: (v: number) => string;
    /** Ось Y слева: auto — когда подписи значений не показаны. */
    axis?: "auto" | "show" | "hide";
    /** Пунктирный контур ожидания за каждым столбцом (например, «обычный такой день»). */
    ghost?: Array<number | null> | null;
    ghostLabel?: string;
    /** Горизонтальный уровень чернилами: план, цель. */
    reference?: number | null;
    referenceLabel?: string;
    /** Линии того же масштаба поверх столбцов: эталон, прогноз источника. */
    lines?: BarLine[];
    /** Индексы категорий с подложкой: выходные. */
    bands?: number[];
    /** Итоговая строка в подсказке у стопки. */
    totalLabel?: string;
    tooltip?: boolean;
    style?: CSSProperties;
}
export declare function Bars({ series, labels, stacked, height, valueLabels, labelSeries, format, tipFormat, axis, ghost, ghostLabel, reference, referenceLabel, lines, bands, totalLabel, tooltip, style }: BarsProps): React.JSX.Element;

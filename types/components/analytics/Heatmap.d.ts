import React from "react";
import type { CSSProperties } from "react";
/**
 * Тепловая карта строки × столбцы (день недели × час). Одна тональная шкала от акцента —
 * заливка смешивается с цветом пустой клетки, поэтому читается в обеих темах.
 */
export interface HeatmapProps {
    rows?: string[];
    cols?: string[];
    /** values[row][col]; null — нет данных. Обычно индекс к среднему, 1 = обычно. */
    values?: Array<Array<number | null>>;
    /** thin[row][col] = true — клетка на малом числе наблюдений, приглушается. */
    thin?: Array<Array<boolean>> | null;
    format?: (v: number) => string;
    /** Шкала под картой обязательна: без неё цвет не расшифровывается, а наведения на телефоне нет. */
    legend?: boolean;
    cell?: number;
    style?: CSSProperties;
}
export declare function Heatmap({ rows, cols, values, thin, format, legend, cell, style }: HeatmapProps): React.JSX.Element;

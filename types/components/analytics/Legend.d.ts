import React from "react";
import type { CSSProperties, ReactNode } from "react";
import type { SeriesTone } from "./chart-core";
export interface LegendItem {
    label: ReactNode;
    /** Ряды графиков красятся не состояниями: accent — главный, off — второстепенный, ink — план/уровень.
     *  success/warn/danger допустимы только для оценочных зон («выше цели», «ниже — разобрать»). */
    tone?: SeriesTone | "success" | "warn" | "danger";
    /** Форма образца повторяет марку на графике. */
    kind?: "bar" | "line" | "tick" | "dot";
    dashed?: boolean;
    /** Плотность заливки столбика — как у ряда на Bars: half — идущий час, ghost — ожидание. */
    fill?: "solid" | "half" | "ghost";
}
/** Легенда графика: образец повторяет марку (столбик, линия, засечка), а не абстрактный квадрат. */
export interface LegendProps {
    items?: LegendItem[];
    style?: CSSProperties;
}
export declare function Legend({ items, style }: LegendProps): React.JSX.Element;

import React from "react";
import type { CSSProperties } from "react";
/**
 * Одна полоса на три величины: факт (заливка), прогноз (пунктирная надстройка), план (засечка).
 * Отвечает на «где мы, куда идём и где должны быть» без трёх отдельных чисел.
 */
export interface PlanMeterProps {
    fact?: number;
    forecast?: number | null;
    plan?: number | null;
    /** Единица для подписей: « млн», « чел». */
    unit?: string;
    /** 10 для главного показателя, 8 в списках. */
    height?: number;
    /** Строка легенды под полосой с числами и разницей прогноз/план. */
    labels?: boolean;
    animate?: boolean;
    style?: CSSProperties;
}
export declare function PlanMeter({ fact, forecast, plan, unit, height, labels, animate, style }: PlanMeterProps): React.JSX.Element;

import React from "react";
import type { CSSProperties } from "react";
/**
 * Изменение показателя: стрелка направления и величина без знака.
 * Цвет — оценка («лучше/хуже»), а не направление: падение брака — зелёное.
 *
 * @startingPoint section="Analytics" subtitle="Показатели: крупное число, изменение, план против факта" viewport="700x150"
 */
export interface DeltaProps {
    /** Изменение в единицах `format`: проценты, пункты или сырое значение. */
    value?: number | null;
    format?: "pct" | "pp" | "raw";
    /** Единица для `raw`: «₽», «чел». */
    unit?: string;
    /** false — для показателей, где рост это плохо (доля брака, время ожидания). */
    higherIsBetter?: boolean;
    /** Ширина полосы «без изменений»: внутри неё стрелка → и серый цвет. */
    neutralBand?: number;
    /** Оценка снаружи, когда её даёт не знак, а зона относительно цели. */
    tone?: "neutral" | "success" | "warn" | "danger";
    style?: CSSProperties;
}
export declare function Delta({ value, format, unit, higherIsBetter, neutralBand, tone: forcedTone, style }: DeltaProps): React.JSX.Element;

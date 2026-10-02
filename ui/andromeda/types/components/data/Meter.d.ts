import React from "react";
import type { CSSProperties } from "react";
/** Полоса доли: расход трафика, остаток подписки, вес выхода в общем потоке. */
export interface MeterProps {
    /** Процент 0–100. */
    value?: number;
    tone?: "accent" | "ok" | "warn" | "bad" | "off";
    /** 8 в списках, 10 для главного показателя. */
    height?: number;
    animate?: boolean;
    /** Задержка отрисовки в мс — для лестницы из нескольких полос. */
    delay?: number;
    style?: CSSProperties;
}
export declare function Meter({ value, tone, height, animate, delay, style }: MeterProps): React.JSX.Element;

import React from "react";
import type { CSSProperties, ReactNode } from "react";
/**
 * Счётчик: подпись сверху, число снизу. Так число не согласуется с подписью —
 * ни склонений после числительных, ни отдельного перевода фразы.
 *
 * @startingPoint section="Data" subtitle="Счётчики, полосы, точки состояния" viewport="700x150"
 */
export interface StatPairProps {
    /** Строчными: «устройств в сети», «правил включено». */
    label: ReactNode;
    value: ReactNode;
    meta?: ReactNode;
    /** Имя токена состояния без префикса: success | warn | danger. */
    tone?: "success" | "warn" | "danger";
    align?: "left" | "right";
    style?: CSSProperties;
}
export declare function StatPair({ label, value, meta, tone, align, style }: StatPairProps): React.JSX.Element;

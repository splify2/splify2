import React from "react";
import type { CSSProperties } from "react";
/** Кольцо ожидания. Появляется только там, где ответа ждут дольше ~300 мс. */
export interface SpinnerProps {
    size?: number;
    label?: string;
    style?: CSSProperties;
}
export declare function Spinner({ size, label, style }: SpinnerProps): React.JSX.Element;

import React from "react";
import type { ReactNode, CSSProperties } from "react";
/** Выбор одного из немногих. Может нести StatusDot — например состояние выхода. */
export interface RadioProps {
    checked?: boolean;
    onChange?: () => void;
    label?: ReactNode;
    meta?: ReactNode;
    /** Слот под StatusDot между кружком и подписью. */
    dot?: ReactNode;
    style?: CSSProperties;
}
export declare function Radio({ checked, onChange, label, meta, dot, style }: RadioProps): React.JSX.Element;

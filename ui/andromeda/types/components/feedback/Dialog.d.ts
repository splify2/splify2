import React from "react";
import type { ReactNode } from "react";
/** Подтверждение необратимого действия. Текст обязан назвать последствие, а не переспросить. */
export interface DialogProps {
    open?: boolean;
    tone?: "danger" | "accent";
    title?: ReactNode;
    children?: ReactNode;
    /** Глагол действия, не «ОК». */
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
}
export declare function Dialog({ open, tone, title, children, confirmLabel, cancelLabel, onConfirm, onCancel }: DialogProps): React.JSX.Element | null;

import React from "react";
import type { HTMLAttributes, ReactNode, CSSProperties } from "react";
/** Выбранное значение внутри поля: сервис в правиле, устройство, свой список. */
export interface ChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, "style"> {
    tone?: "accent" | "neutral";
    onRemove?: () => void;
    /** Пунктир — «добавить ещё», плейсхолдер, а не значение. */
    dashed?: boolean;
    children?: ReactNode;
    style?: CSSProperties;
}
export declare function Chip({ tone, onRemove, dashed, children, style, ...rest }: ChipProps): React.JSX.Element;

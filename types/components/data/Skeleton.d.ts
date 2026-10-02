import React from "react";
import type { CSSProperties } from "react";
/** Заглушка на время первой загрузки: держит раскладку той же высоты, что данные. */
export interface SkeletonProps {
    height?: number;
    radius?: string;
    count?: number;
    style?: CSSProperties;
}
export declare function Skeleton({ height, radius, count, style }: SkeletonProps): React.JSX.Element;

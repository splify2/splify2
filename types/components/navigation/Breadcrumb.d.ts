import React from "react";
import type { ReactNode, CSSProperties } from "react";
/** Путь внутри раздела: список → объект. Глубже двух уровней в Andromeda не бывает. */
export interface BreadcrumbProps {
    items?: Array<{
        label: ReactNode;
        onClick?: () => void;
    }>;
    /** Правый край: место в очереди, состояние сохранения. */
    meta?: ReactNode;
    style?: CSSProperties;
}
export declare function Breadcrumb({ items, meta, style }: BreadcrumbProps): React.JSX.Element;

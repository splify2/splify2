import React from "react";
import type { ReactNode, CSSProperties } from "react";
/** Два-три взаимоисключающих варианта в одну строку: фильтр списка, тема, тип данных. */
export interface SegmentedControlProps {
    items?: Array<{
        value: string;
        label: ReactNode;
    }>;
    value?: string;
    onChange?: (value: string) => void;
    size?: "md" | "sm";
    /** Растянуть на всю ширину родителя: варианты делят её поровну (рельс, телефон). */
    full?: boolean;
    style?: CSSProperties;
}
export declare function SegmentedControl({ items, value, onChange, size, full, style }: SegmentedControlProps): React.JSX.Element;

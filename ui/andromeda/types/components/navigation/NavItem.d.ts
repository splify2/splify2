import React from "react";
import type { ReactNode, CSSProperties } from "react";
/**
 * Пункт рельса разделов. count — сколько объектов внутри, badge — сколько требует внимания.
 *
 * @startingPoint section="Navigation" subtitle="Рельс разделов, крошки" viewport="700x150"
 */
export interface NavItemProps {
    icon?: ReactNode;
    label?: ReactNode;
    count?: number | null;
    /** Жёлтый счётчик: столько находок ждёт в разделе. Вытесняет count. */
    badge?: number | null;
    active?: boolean;
    onClick?: () => void;
    style?: CSSProperties;
}
export declare function NavItem({ icon, label, count, badge, active, onClick, style }: NavItemProps): React.JSX.Element;

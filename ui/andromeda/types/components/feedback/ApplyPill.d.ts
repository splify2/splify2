import React from "react";
import type { CSSProperties } from "react";
/**
 * Плавающая кнопка отложенного применения.
 *
 * КОНТРАКТ: changes — разница между текущей настройкой и ПРИМЕНЁННЫМ снимком,
 * а не число нажатий. Вернули тумблер в исходное — пилюля обязана исчезнуть.
 */
export interface ApplyPillProps {
    changes?: number;
    state?: "idle" | "busy" | "done";
    onApply?: () => void;
    /** Сдвиг центра, когда слева есть рельс: половина его ширины. */
    offset?: number;
    style?: CSSProperties;
}
export declare function ApplyPill({ changes, state, onApply, offset, style }: ApplyPillProps): React.JSX.Element | null;

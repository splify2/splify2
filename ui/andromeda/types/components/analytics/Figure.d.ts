import React from "react";
import type { CSSProperties, ReactNode } from "react";
/**
 * Крупный показатель: подпись сверху, число с единицей, изменение рядом, пояснение снизу.
 * Старший брат StatPair — для одного-четырёх главных чисел экрана, не для сеток.
 */
export interface FigureProps {
    /** Строчными: «оборот сегодня», «прогноз месяца». */
    label?: ReactNode;
    value: ReactNode;
    /** Единица отдельно от числа: «млн ₽», «чел», «%». */
    unit?: ReactNode;
    /** Обычно `<Delta …/>`. */
    delta?: ReactNode;
    /** Одна строка: к чему относится или откуда взято. */
    caption?: ReactNode;
    /** lg — одно число на экран (40px), md — ряд из трёх-четырёх (28px), sm — в карточке (20px). */
    size?: "lg" | "md" | "sm";
    /** Окраска самого числа токеном состояния: только когда число — это оценка. */
    tone?: "success" | "warn" | "danger";
    /** Пульсирующая точка перед подписью: значение обновляется само. */
    live?: boolean;
    style?: CSSProperties;
}
export declare function Figure({ label, value, unit, delta, caption, size, tone, live, style }: FigureProps): React.JSX.Element;

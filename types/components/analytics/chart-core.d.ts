import React from "react";
import type { CSSProperties, ReactNode } from "react";
/** Ширина берётся у контейнера: рисуем в пикселях, а не растягиваем viewBox —
 *  иначе подписи осей вытягиваются вместе с графиком. */
export declare function useWidth(fallback?: number): readonly [React.RefObject<HTMLDivElement | null>, number];
/** Тона рядов. У системы один акцент: accent — главный ряд, off — второстепенный
 *  (серый), ink — план и уровни, muted — вспомогательный контекст. cat1…cat7 —
 *  категориальная шкала для наборов вроде дней недели, где рядов заведомо семь
 *  и все они равноправны. Токены состояния (success/warn/danger) рядами не бывают. */
export type SeriesTone = "accent" | "soft" | "off" | "ink" | "muted" | "cat1" | "cat2" | "cat3" | "cat4" | "cat5" | "cat6" | "cat7";
export declare const TONE: Record<SeriesTone, string>;
export declare const toneColor: (t?: SeriesTone) => string;
export declare const nf: (v: number) => string;
export declare const FONT: CSSProperties;
/** «Красивый» потолок оси: 1, 2, 2.5, 5 × 10^k, не ниже max*1.06. */
export declare function niceCeil(max: number): number;
/** Ширина поля под подписи оси Y — по самой длинной подписи. */
export declare function axisWidth(ticks: number[], format: (v: number) => string): number;
/** Через сколько подписей оси X показывать одну: не чаще, чем раз в 44 px. */
export declare function labelStep(n: number, innerW: number, minGap?: number): number;
/** Показывать ли подпись категории i: каждая step-я и последняя, но не вплотную к последней. */
export declare function showLabel(i: number, n: number, step: number): boolean;
/** Число делений оси, при котором шаг «круглый» (5 → 5,10,15…, а не 8,3 / 16,7). */
export declare function niceTickCount(hi: number, preferred?: number): number;
/** Монотонный кубический сплайн (Fritsch–Carlson): не создаёт ложных горбов между точками. */
export declare function pathOf(points: Array<[number, number] | null>, smooth: boolean): string;
/** Одна строка подсказки: образец, имя, значение. */
export interface TipRow {
    label: ReactNode;
    value: string;
    tone?: SeriesTone;
    dashed?: boolean;
    /** bar — квадратик; line — чёрточка. */
    kind?: "bar" | "line";
    /** Плотность заливки образца: half — идущий час, ghost — ожидание. */
    fill?: "solid" | "half" | "ghost";
    /** Итоговая строка: отделяется линией, набрана жирнее. */
    total?: boolean;
}
/** Наведение по индексу категории: ближайшая колонка к курсору. */
export declare function useHover(n: number, xOf: (i: number) => number): {
    idx: number | null;
    svgRef: React.RefObject<SVGSVGElement | null>;
    onMove: (e: React.PointerEvent) => void;
    onLeave: () => void;
};
/** Подсказка рядом с курсором. Позиционируется относительно контейнера графика:
 *  справа от колонки, а у правого края — слева. */
export declare function Tooltip({ title, rows, x, width, top }: {
    title: ReactNode;
    rows: TipRow[];
    x: number;
    width: number;
    top: number;
}): React.DetailedReactHTMLElement<{
    role: "status";
    style: React.CSSProperties;
}, HTMLElement> | null;

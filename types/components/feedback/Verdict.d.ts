import React from "react";
import type { ReactNode, CSSProperties } from "react";
declare const STATE: {
    readonly running: {
        readonly tone: "ok";
        readonly live: true;
        readonly text: "Маршрутизация работает";
    };
    readonly broken: {
        readonly tone: "bad";
        readonly live: false;
        readonly text: "Есть поломки";
    };
    readonly silent: {
        readonly tone: "warn";
        readonly live: false;
        readonly text: "Движок не отвечает";
    };
    readonly loading: {
        readonly tone: "off";
        readonly live: true;
        readonly text: "Загрузка…";
    };
};
/**
 * Заголовок состояния системы. Текст берётся из закрытого списка четырёх строк —
 * интерфейс не собирает фразу из чисел, поэтому склонять нечего.
 *
 * @startingPoint section="Feedback" subtitle="Вердикт, плашка, тост, диалог" viewport="700x150"
 */
export interface VerdictProps {
    state?: "running" | "broken" | "silent" | "loading";
    /** Счётчики через разделитель: «устройств в сети: 9 · время работы 4 ч 12 мин». */
    meta?: ReactNode;
    style?: CSSProperties;
}
export declare function Verdict({ state, meta, style }: VerdictProps): React.JSX.Element;
export declare const VERDICT_STATES: Array<keyof typeof STATE>;
export {};

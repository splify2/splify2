/**
 * Токены как значения — для мест, где `var(--an-*)` недоступен: библиотеки
 * графиков, генераторы макетов, экспорт в PNG. Источник правды — CSS в этой же
 * папке; здесь ровно те же числа, и расхождение между ними ловит тест.
 */
export declare const RADIUS: {
    readonly card: 16;
    readonly block: 12;
    readonly control: 10;
    readonly inner: 9;
    readonly badge: 6;
};
export declare const SPACE: readonly [2, 4, 6, 8, 10, 12, 14, 16, 20, 22, 28, 40];
export declare const SIZE: {
    readonly control: 40;
    readonly controlSm: 34;
    readonly iconButton: 34;
    readonly touch: 44;
    readonly rail: 236;
};
export declare const DURATION: {
    readonly hover: 160;
    readonly control: 220;
    readonly enter: 260;
    readonly theme: 280;
    readonly collapse: 320;
    readonly pulse: 2400;
};
export declare const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
/** Состояния фиксированы в обеих темах: если «работает» и «отказ» перекрасить
 *  вместе с темой, цвет перестанет что-либо значить. */
export declare const STATE: {
    readonly success: "#2dce89";
    readonly warn: "#ffc107";
    readonly danger: "#f5365c";
    readonly ink: {
        readonly light: {
            readonly success: "#1c8f5f";
            readonly warn: "#7a5300";
            readonly danger: "#c0304f";
        };
        readonly dark: {
            readonly success: "#2dce89";
            readonly warn: "#e5b23c";
            readonly danger: "#ff6b86";
        };
    };
};
export declare const SURFACE: {
    readonly light: {
        readonly page: "#f6f7f9";
        readonly card: "#ffffff";
        readonly rail: "#fbfbfd";
        readonly field: "#f2f4f7";
        readonly border: "#eceef3";
        readonly borderSoft: "#f4f5f8";
        readonly text: "#22252e";
        readonly textSecondary: "#5b6478";
        readonly textMuted: "#6f778a";
        readonly knobOff: "#c3c9d6";
    };
    readonly dark: {
        readonly page: "#121317";
        readonly card: "#1b1d22";
        readonly rail: "#17181c";
        readonly field: "#23252b";
        readonly border: "#2a2c33";
        readonly borderSoft: "#232529";
        readonly text: "#e8eaf0";
        readonly textSecondary: "#b6bccb";
        readonly textMuted: "#8b93a7";
        readonly knobOff: "#6b7180";
    };
};
/**
 * Кодировка рядов на графиках — одна на всю систему. Акцент — главный ряд
 * (факт, продажи), серый — второстепенный, который не является достижением
 * (выдача, препрогноз), чернила — план и уровни, приглушённый — прогноз API и
 * эталон. Пунктир — всё прогнозное. Токены состояния в рядах не участвуют.
 */
export declare const SERIES: {
    readonly primary: "var(--an-accent)";
    readonly secondary: "var(--an-control-knob-off)";
    readonly ink: "var(--an-text)";
    readonly muted: "var(--an-text-muted)";
    readonly soft: "var(--an-accent-soft)";
};
export declare const CSS_VAR: {
    readonly accent: "var(--an-accent)";
    readonly accentPress: "var(--an-accent-press)";
    readonly accentSoft: "var(--an-accent-soft)";
    readonly accentLine: "var(--an-accent-line)";
    readonly onAccent: "var(--an-text-on-accent)";
    readonly success: "var(--an-success)";
    readonly warn: "var(--an-warn)";
    readonly danger: "var(--an-danger)";
    readonly successInk: "var(--an-success-ink)";
    readonly warnInk: "var(--an-warn-ink)";
    readonly dangerInk: "var(--an-danger-ink)";
    readonly successSoft: "var(--an-success-soft)";
    readonly warnSoft: "var(--an-warn-soft)";
    readonly dangerSoft: "var(--an-danger-soft)";
    readonly page: "var(--an-surface-page)";
    readonly card: "var(--an-surface-card)";
    readonly rail: "var(--an-surface-rail)";
    readonly field: "var(--an-surface-field)";
    readonly border: "var(--an-border)";
    readonly borderSoft: "var(--an-border-soft)";
    readonly text: "var(--an-text)";
    readonly textSecondary: "var(--an-text-secondary)";
    readonly textMuted: "var(--an-text-muted)";
};
/** Категориальная шкала для равноправных наборов (дни недели). */
export declare const CATEGORICAL: string[];

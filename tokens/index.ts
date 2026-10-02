/**
 * Токены как значения — для мест, где `var(--an-*)` недоступен: библиотеки
 * графиков, генераторы макетов, экспорт в PNG. Источник правды — CSS в этой же
 * папке; здесь ровно те же числа, и расхождение между ними ловит тест.
 */
export const RADIUS = { card: 16, block: 12, control: 10, inner: 9, badge: 6 } as const;
export const SPACE = [2, 4, 6, 8, 10, 12, 14, 16, 20, 22, 28, 40] as const;
export const SIZE = { control: 40, controlSm: 34, iconButton: 34, touch: 44, rail: 236 } as const;
export const DURATION = { hover: 160, control: 220, enter: 260, theme: 280, collapse: 320, pulse: 2400 } as const;
export const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

/** Состояния фиксированы в обеих темах: если «работает» и «отказ» перекрасить
 *  вместе с темой, цвет перестанет что-либо значить. */
export const STATE = {
  success: "#2dce89", warn: "#ffc107", danger: "#f5365c",
  ink: { light: { success: "#1c8f5f", warn: "#7a5300", danger: "#c0304f" },
         dark: { success: "#2dce89", warn: "#e5b23c", danger: "#ff6b86" } },
} as const;

export const SURFACE = {
  light: { page: "#f6f7f9", card: "#ffffff", rail: "#fbfbfd", field: "#f2f4f7", border: "#eceef3", borderSoft: "#f4f5f8",
           text: "#22252e", textSecondary: "#5b6478", textMuted: "#6f778a", knobOff: "#c3c9d6" },
  dark:  { page: "#121317", card: "#1b1d22", rail: "#17181c", field: "#23252b", border: "#2a2c33", borderSoft: "#232529",
           text: "#e8eaf0", textSecondary: "#b6bccb", textMuted: "#8b93a7", knobOff: "#6b7180" },
} as const;

/**
 * Кодировка рядов на графиках — одна на всю систему. Акцент — главный ряд
 * (факт, продажи), серый — второстепенный, который не является достижением
 * (выдача, препрогноз), чернила — план и уровни, приглушённый — прогноз API и
 * эталон. Пунктир — всё прогнозное. Токены состояния в рядах не участвуют.
 */
export const SERIES = {
  primary: "var(--an-accent)",
  secondary: "var(--an-control-knob-off)",
  ink: "var(--an-text)",
  muted: "var(--an-text-muted)",
  soft: "var(--an-accent-soft)",
} as const;

export const CSS_VAR = {
  accent: "var(--an-accent)", accentPress: "var(--an-accent-press)", accentSoft: "var(--an-accent-soft)",
  accentLine: "var(--an-accent-line)", onAccent: "var(--an-text-on-accent)",
  success: "var(--an-success)", warn: "var(--an-warn)", danger: "var(--an-danger)",
  successInk: "var(--an-success-ink)", warnInk: "var(--an-warn-ink)", dangerInk: "var(--an-danger-ink)",
  successSoft: "var(--an-success-soft)", warnSoft: "var(--an-warn-soft)", dangerSoft: "var(--an-danger-soft)",
  page: "var(--an-surface-page)", card: "var(--an-surface-card)", rail: "var(--an-surface-rail)", field: "var(--an-surface-field)",
  border: "var(--an-border)", borderSoft: "var(--an-border-soft)",
  text: "var(--an-text)", textSecondary: "var(--an-text-secondary)", textMuted: "var(--an-text-muted)",
} as const;

/** Категориальная шкала для равноправных наборов (дни недели). */
export const CATEGORICAL = [1, 2, 3, 4, 5, 6, 7].map((i) => `var(--an-cat-${i})`);

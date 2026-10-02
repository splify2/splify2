import React from "react";
import type { HTMLAttributes, ReactNode, CSSProperties } from "react";


/** Выбранное значение внутри поля: сервис в правиле, устройство, свой список. */
export interface ChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, "style"> {
  tone?: "accent" | "neutral";
  onRemove?: () => void;
  /** Пунктир — «добавить ещё», плейсхолдер, а не значение. */
  dashed?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}

export function Chip({ tone = "accent", onRemove, dashed = false, children, style, ...rest }: ChipProps) {
  const accent = tone === "accent";
  // Кликабельный чип (фильтр, переключатель) — настоящая кнопка: с клавиатуры
  // и для читалки он должен быть кнопкой, а не подписью с обработчиком.
  const Tag: any = rest.onClick ? "button" : "span";
  return (
    <Tag
      {...(Tag === "button" ? { type: "button", "aria-pressed": accent && !dashed } : {})}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--an-space-3)",
        height: 28,
        padding: "0 10px",
        borderRadius: "var(--an-radius-inner)",
        border: dashed ? "1px dashed var(--an-control-line)" : `1px solid ${accent ? "var(--an-accent-line)" : "var(--an-border)"}`,
        background: dashed ? "transparent" : accent ? "var(--an-accent-soft)" : "var(--an-surface-field)",
        color: accent && !dashed ? "var(--an-accent)" : "var(--an-text-secondary)",
        font: "var(--an-text-body-sm)",
        whiteSpace: "nowrap",
        lineHeight: 1,
        cursor: onRemove || rest.onClick ? "pointer" : "default",
        transition: "var(--an-transition-hover)",
        ...style,
      }}
      {...rest}
    >
      {children}
      {onRemove ? (
        <span onClick={onRemove} aria-hidden="true" style={{ opacity: 0.7 }}>
          ×
        </span>
      ) : null}
    </Tag>
  );
}

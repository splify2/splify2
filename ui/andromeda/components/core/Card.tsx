import React from "react";
import type { HTMLAttributes, ReactNode, CSSProperties, ElementType } from "react";


/**
 * Ограждённая область: 1px линия, радиус 16, без тени.
 *
 * @startingPoint section="Core" subtitle="Карточка с заголовком и мета-строкой" viewport="700x150"
 */
export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "style"> {
  heading?: ReactNode;
  /** Правый верхний угол: время, источник, счётчик. */
  meta?: ReactNode;
  tone?: "plain" | "warn";
  as?: ElementType;
  children?: ReactNode;
  style?: CSSProperties;
}

export function Card({ heading, meta, tone = "plain", as: Tag = "section", children, style, ...rest }: CardProps) {
  const toneStyle =
    tone === "warn"
      ? { border: "1px solid var(--an-warn-border)", background: "var(--an-warn-soft)" }
      : { border: "1px solid var(--an-border)", background: "var(--an-surface-card)" };

  return (
    <Tag
      style={{
        borderRadius: "var(--an-radius-card)",
        padding: "var(--an-pad-card)",
        transition: "var(--an-transition-theme)",
        ...toneStyle,
        ...style,
      }}
      {...rest}
    >
      {heading || meta ? (
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--an-space-6)" }}>
          {heading ? <h2 style={{ font: "var(--an-text-heading)" }}>{heading}</h2> : null}
          {meta ? <span style={{ font: "var(--an-text-caption)", color: "var(--an-text-muted)" }}>{meta}</span> : null}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}

/**
 * Составные части карточки — для случаев, когда заголовок и описание нужны как
 * разметка, а не как строки: с переносами, значками, действием справа. Анатомия
 * та же, что у `heading`/`meta`: заголовок 15/600, описание 12,5 приглушённым.
 * `className` пропускается, чтобы хост мог задать отступы своим инструментом.
 */
export function CardHeader({ children, style, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--an-space-2)", ...style }} {...rest}>{children}</div>
  );
}
export function CardTitle({ children, style, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 style={{ margin: 0, font: "var(--an-text-heading)", color: "var(--an-text)", ...style }} {...rest}>{children}</h2>;
}
export function CardDescription({ children, style, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p style={{ margin: 0, font: "var(--an-text-caption)", fontSize: 12.5, lineHeight: 1.5, color: "var(--an-text-muted)", ...style }} {...rest}>{children}</p>
  );
}
export function CardContent({ children, style, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div style={style} {...rest}>{children}</div>;
}

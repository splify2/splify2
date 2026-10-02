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
export declare function Card({ heading, meta, tone, as: Tag, children, style, ...rest }: CardProps): React.JSX.Element;
/**
 * Составные части карточки — для случаев, когда заголовок и описание нужны как
 * разметка, а не как строки: с переносами, значками, действием справа. Анатомия
 * та же, что у `heading`/`meta`: заголовок 15/600, описание 12,5 приглушённым.
 * `className` пропускается, чтобы хост мог задать отступы своим инструментом.
 */
export declare function CardHeader({ children, style, ...rest }: HTMLAttributes<HTMLDivElement>): React.JSX.Element;
export declare function CardTitle({ children, style, ...rest }: HTMLAttributes<HTMLHeadingElement>): React.JSX.Element;
export declare function CardDescription({ children, style, ...rest }: HTMLAttributes<HTMLParagraphElement>): React.JSX.Element;
export declare function CardContent({ children, style, ...rest }: HTMLAttributes<HTMLDivElement>): React.JSX.Element;

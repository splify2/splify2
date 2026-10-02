import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/* Размер и шрифт — Badge Andromeda (ui/andromeda/components/core/Badge.tsx): высота 20, мелкий
 * кегль 11 px средней жирности, радиус бейджа 6 (rounded-sm), без переноса внутри. Элемент —
 * <span>: бейдж стоит и внутри кнопки (строка узла в редакторе выхода), а <div> там незаконен.
 *
 * `proto`, `tag` и `warn` — бейджи конфигурации (lib/badges.ts, components/ConfBadges.tsx):
 * тонированные плашки, которые внутри стекла выглядят вложенным стеклом. Цвета — в index.css
 * (.sp-cb): тон протокола задаёт атрибут data-tone (категориальная шкала --an-cat-*). */
const badgeVariants = cva(
  "inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-sm border px-2 text-[11px] font-medium leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
        proto: "sp-cb sp-cb-proto px-1.5",
        tag: "sp-cb sp-cb-tag px-1.5",
        warn: "sp-cb sp-cb-warn px-1.5",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }

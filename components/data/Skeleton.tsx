import React from "react";
import type { CSSProperties } from "react";


/** Заглушка на время первой загрузки: держит раскладку той же высоты, что данные. */
export interface SkeletonProps {
  height?: number;
  radius?: string;
  count?: number;
  style?: CSSProperties;
}

export function Skeleton({ height = 66, radius = "var(--an-radius-block)", count = 1, style }: SkeletonProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--an-gap-row)", ...style }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            height,
            borderRadius: radius,
            background: "var(--an-skeleton)",
            backgroundSize: "420px 100%",
            animation: "an-shimmer 1.4s linear infinite",
          }}
        />
      ))}
    </div>
  );
}

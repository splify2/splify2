import React from "react";

const PATHS = {
  gauge: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 12a9 9 0 0 1 18 0",
  route: "M4 6h6l4 12h6",
  outputs: "M6 3v12M18 9v12M6 15a6 6 0 0 0 12-6",
  catalog: "M4 4h6v16H4zM14 4h6v16h-6z",
  diag: "M4 3v7a5 5 0 0 0 10 0V3M9 15v2a4 4 0 0 0 8 0v-1",
  system: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V22a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 20.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 2 15H2a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 3.8 7L3.7 7a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 2.6V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 22 9h.1a2 2 0 1 1 0 4H22a1.7 1.7 0 0 0-1.6 1z",
  plus: "M12 5v14M5 12h14",
  pencil: "m18 2 4 4-14 14H4v-4z",
  up: "M12 19V5M5 12l7-7 7 7",
  down: "M12 5v14M5 12l7 7 7-7",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  search: "M21 21l-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16",
  power: "M18.4 6.6a9 9 0 1 1-12.8 0M12 2v10",
  arrowRight: "M5 12h14M12 5l7 7-7 7",
  refresh: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
  spinner: "M21 12a9 9 0 1 1-6.2-8.6",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
};

export function Icon({ name, size = 16, style }: { name: string; size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d={PATHS[name] || PATHS.gauge} />
    </svg>
  );
}

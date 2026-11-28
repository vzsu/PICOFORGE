// Thin outline icons (1.5 px stroke, currentColor). Drawn for PicoForge; no icon font.

import type { ReactElement } from "react";

export type IconName =
  | "home" | "cube" | "runs" | "agent" | "gear"
  | "select" | "move" | "rotate" | "section" | "measure" | "capture"
  | "eye" | "eyeOff" | "chevronDown" | "chevronRight" | "sidebar" | "save" | "close";

const PATHS: Record<IconName, ReactElement> = {
  save: (
    <>
      <path d="M12 4v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 19h14" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  home: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  cube: (
    <>
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </>
  ),
  runs: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  agent: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
      <circle cx="12" cy="12" r="6.5" />
    </>
  ),
  select: <path d="M6 4l12 7.5-5.2 1.3L10 18z" />,
  move: <path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" />,
  rotate: (
    <>
      <path d="M19 12a7 7 0 1 1-2.05-4.95" />
      <path d="M19 4.5V8h-3.5" />
    </>
  ),
  section: (
    <>
      <path d="M4 8l8-4 8 4-8 4z" />
      <path d="M4 12l8 4 8-4M4 16l8 4 8-4" strokeDasharray="2 2" />
    </>
  ),
  measure: (
    <>
      <path d="M3.5 15.5 15.5 3.5l5 5-12 12z" />
      <path d="M7 12l1.8 1.8M10 9l1.8 1.8M13 6l1.8 1.8" />
    </>
  ),
  capture: (
    <>
      <path d="M4 8a1.5 1.5 0 0 1 1.5-1.5H8L9.5 4.5h5L16 6.5h2.5A1.5 1.5 0 0 1 20 8v10a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.7 3.4M6.5 7.6A15 15 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9" />
    </>
  ),
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </>
  ),
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The 3×3 dot-matrix glyph that sits before the PICOFORGE label. */
export function DotGlyph() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true" fill="currentColor">
      {[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => (
        <circle key={`${r}${c}`} cx={1.5 + c * 3} cy={1.5 + r * 3} r={(r + c) % 2 === 0 ? 1.1 : 0.7} />
      )))}
    </svg>
  );
}

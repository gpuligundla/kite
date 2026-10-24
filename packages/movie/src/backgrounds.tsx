import React from "react";
import type { components } from "../../client/src/contract";

type Palette = components["schemas"]["Palette"];
type Background = components["schemas"]["Scene"]["background"];

export const W = 1280;
export const H = 720;
// High enough that actors and their names stay above a three-line caption.
const HORIZON = 420;

interface Layers {
  far: React.ReactNode;
  mid: React.ReactNode;
  near: React.ReactNode;
}

const stars = Array.from({ length: 40 }, (_, i) => ({
  x: (i * 337) % W,
  y: (i * 211) % 420,
  r: 1 + (i % 3),
}));

const Stars = () => (
  <>
    {stars.map((s, i) => (
      <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={0.85} />
    ))}
  </>
);

const Cloud = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`} fill="#fff" opacity={0.9}>
    <ellipse cx="0" cy="0" rx="70" ry="28" />
    <ellipse cx="-40" cy="10" rx="45" ry="22" />
    <ellipse cx="45" cy="12" rx="50" ry="22" />
  </g>
);

const Hills = ({ color }: { color: string }) => (
  <path
    d={`M-200 ${HORIZON} Q100 ${HORIZON - 150} 400 ${HORIZON - 40} T1000 ${HORIZON - 60} T1500 ${HORIZON} V${H} H-200 Z`}
    fill={color}
    opacity={0.55}
  />
);

const Ground = ({ color }: { color: string }) => (
  <rect x={-200} y={HORIZON} width={W + 400} height={H - HORIZON + 100} fill={color} />
);

function layers(bg: Background, p: Palette): Layers {
  switch (bg) {
    case "space":
      return {
        far: <><rect x={-200} y={-100} width={W + 400} height={H + 200} fill={p.sky} /><Stars /></>,
        mid: <><circle cx="980" cy="170" r="90" fill="#ef9a9a" /><circle cx="300" cy="120" r="40" fill="#fff59d" /></>,
        near: <Ground color={p.ground} />,
      };
    case "ocean":
      return {
        far: <><rect x={-200} y={-100} width={W + 400} height={HORIZON} fill={p.sky} /><Cloud x={300} y={120} /><Cloud x={900} y={80} s={0.8} /></>,
        mid: <rect x={-200} y={HORIZON - 120} width={W + 400} height={400} fill="#1e88e5" opacity={0.85} />,
        near: <><rect x={-200} y={HORIZON + 40} width={W + 400} height={H} fill={p.ground} /><path d={`M-200 ${HORIZON + 40} q80 -30 160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0`} fill="#fff" opacity={0.6} /></>,
      };
    case "forest":
      return {
        far: <><rect x={-200} y={-100} width={W + 400} height={H + 200} fill={p.sky} /><Hills color={p.ground} /></>,
        mid: <>{[80, 330, 640, 900, 1180].map((x, i) => (
          <g key={i} transform={`translate(${x} ${HORIZON - 10})`}>
            <rect x="-14" y="-90" width="28" height="100" fill="#6d4c41" />
            <circle cx="0" cy={-130 - (i % 2) * 20} r="75" fill="#2e7d32" />
          </g>
        ))}</>,
        near: <Ground color={p.ground} />,
      };
    case "town":
      return {
        far: <><rect x={-200} y={-100} width={W + 400} height={H + 200} fill={p.sky} /><Cloud x={260} y={110} /><Cloud x={850} y={150} s={0.7} /></>,
        mid: <>{[60, 360, 700, 1000].map((x, i) => (
          <g key={i} transform={`translate(${x} ${HORIZON})`}>
            <rect x="0" y={-170 + (i % 2) * 40} width="200" height={170 - (i % 2) * 40} fill={["#ef9a9a", "#ffe082", "#90caf9", "#a5d6a7"][i]} />
            <polygon points={`-10,${-170 + (i % 2) * 40} 100,${-250 + (i % 2) * 40} 210,${-170 + (i % 2) * 40}`} fill="#8d6e63" />
            <rect x="80" y="-70" width="40" height="70" fill="#5d4037" />
          </g>
        ))}</>,
        near: <Ground color={p.ground} />,
      };
    case "classroom":
      return {
        far: <rect x={-200} y={-100} width={W + 400} height={H + 200} fill={p.sky} />,
        mid: <><rect x="240" y="90" width="800" height="300" rx="10" fill="#37474f" stroke="#8d6e63" strokeWidth="14" />
          <text x="640" y="260" fontSize="64" fontFamily="Arial" textAnchor="middle" fill="#eceff1" opacity={0.8}>ABC 123</text></>,
        near: <Ground color={p.ground} />,
      };
    case "sky":
    default:
      return {
        far: <><rect x={-200} y={-100} width={W + 400} height={H + 200} fill={p.sky} /><circle cx="1050" cy="140" r="60" fill="#fff59d" /><Cloud x={250} y={130} /><Cloud x={700} y={200} s={0.8} /></>,
        mid: <Hills color={p.ground} />,
        near: <Ground color={p.ground} />,
      };
  }
}

const TINT: Record<Palette["time_of_day"], { color: string; opacity: number }> = {
  morning: { color: "#ffcc80", opacity: 0.12 },
  day: { color: "#ffffff", opacity: 0 },
  evening: { color: "#ff7043", opacity: 0.25 },
  night: { color: "#0d1b4a", opacity: 0.55 },
};

/** `cx` is the camera shift in pixels. Far layers move least, near layers most. */
export const Background: React.FC<{ bg: Background; palette: Palette; cx: number; scale: number }> = ({ bg, palette, cx, scale }) => {
  const l = layers(bg, palette);
  const tint = TINT[palette.time_of_day];
  const layer = (factor: number, node: React.ReactNode) => <g transform={`translate(${-cx * factor} 0)`}>{node}</g>;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
      <g transform={`translate(${W / 2} ${H / 2}) scale(${scale}) translate(${-W / 2} ${-H / 2})`}>
        {layer(0.3, l.far)}
        {layer(0.6, l.mid)}
        {layer(1, l.near)}
      </g>
      <rect width={W} height={H} fill={tint.color} opacity={tint.opacity} />
    </svg>
  );
};

export const GROUND_Y = HORIZON + 15;

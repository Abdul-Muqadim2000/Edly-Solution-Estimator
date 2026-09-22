import type { PlanTask } from '@/types';

/** Bars as the timeline draws them, with the colour already resolved. */
export interface GanttBar {
  name: string;
  start: number;
  dur: number;
  hrs: number;
  color: string;
  span?: boolean;
}

const esc = (value: unknown): string => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * The timeline as a standalone SVG — the picture that goes into a deck.
 *
 * Deliberately not a snapshot of the DOM: the on-screen chart is interactive and sized to the
 * viewport, while this is a fixed 900px-wide canvas with its own header and footer.
 */
export function ganttSvg(bars: readonly GanttBar[], weeks: number, cap: number): string {
  const LW = 260;
  const CW = 900;
  const RH = 34;
  const top = 64;
  const width = LW + CW + 30;
  const height = top + bars.length * RH + 46;
  const wpx = CW / Math.max(1, weeks);

  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="background:#FFFFFF">`;
  out += `<text x="24" y="34" font-family="Arial" font-size="20" font-weight="bold" fill="#252525">edly — Delivery timeline</text>`;
  out += `<text x="24" y="52" font-family="Arial" font-size="11" fill="#6E6E6E">${esc(
    `${new Date().toDateString()} · team capacity ${cap} h/week · ${weeks} weeks`
  )}</text>`;

  for (let i = 0; i <= weeks; i += 1) {
    const x = LW + i * wpx;
    out += `<line x1="${x}" y1="${top}" x2="${x}" y2="${height - 30}" stroke="#ECECEA"/>`;
    if (i < weeks) {
      out += `<text x="${x + wpx / 2}" y="${top - 8}" font-family="Arial" font-size="10" fill="#9C9C9C" text-anchor="middle">W${i + 1}</text>`;
    }
  }

  bars.forEach((bar, index) => {
    const y = top + index * RH;
    const label = bar.name.length > 42 ? `${bar.name.slice(0, 42)}…` : bar.name;
    out += `<text x="24" y="${y + 21}" font-family="Arial" font-size="11.5" fill="#3C3C3C">${esc(label)}</text>`;
    out += `<rect x="${LW + bar.start * wpx}" y="${y + 7}" width="${Math.max(3, bar.dur * wpx - 2)}" height="18" rx="5" fill="${
      bar.color
    }"${bar.span ? ' opacity="0.35"' : ''}/>`;
    out += `<text x="${LW + bar.start * wpx + 6}" y="${y + 20}" font-family="Arial" font-size="9.5" fill="#FFFFFF" font-weight="bold">${Math.round(
      bar.hrs
    )}h</text>`;
  });

  out += `<text x="24" y="${height - 12}" font-family="Arial" font-size="9.5" fill="#8F8F8B">Engineering estimate only · Edly by Arbisoft · edly.io</text></svg>`;
  return out;
}

/** Rasterises the SVG at 2× and hands the browser a PNG to save. */
export function downloadGanttPng(bars: readonly GanttBar[], weeks: number, cap: number): void {
  if (bars.length === 0) return;
  const svg = ganttSvg(bars, weeks, cap);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = image.width * 2;
    canvas.height = image.height * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(2, 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, image.width, image.height);
    ctx.drawImage(image, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `Edly-Delivery-Timeline-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    });
  };
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export type { PlanTask };

interface RGB {
  r: number;
  g: number;
  b: number;
}

const LIGHT_PAPER = '#fffefb';
const DARK_PAPER = '#24272c';
const DARK_TEXT = '#202124';
const LIGHT_TEXT = '#ffffff';

function parseColor(value: string): RGB | null {
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/iu)?.[1];
  if (hex) {
    const expanded = hex.length === 3 ? [...hex].map((character) => character.repeat(2)).join('') : hex;
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
    };
  }
  const rgb = value.trim().match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/iu);
  if (!rgb) return null;
  return {
    r: Math.max(0, Math.min(255, Number(rgb[1]))),
    g: Math.max(0, Math.min(255, Number(rgb[2]))),
    b: Math.max(0, Math.min(255, Number(rgb[3]))),
  };
}

function toHex(color: RGB): string {
  return `#${[color.r, color.g, color.b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

function luminance(color: RGB): number {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundColor = parseColor(foreground);
  const backgroundColor = parseColor(background);
  if (!foregroundColor || !backgroundColor) return 1;
  const lighter = Math.max(luminance(foregroundColor), luminance(backgroundColor));
  const darker = Math.min(luminance(foregroundColor), luminance(backgroundColor));
  return (lighter + 0.05) / (darker + 0.05);
}

function accessibleColor(value: string, background: string, targetContrast = 4.5): string {
  const color = parseColor(value);
  const paper = parseColor(background);
  if (!color || !paper || contrastRatio(value, background) >= targetContrast) return value;
  const target: RGB = luminance(paper) > 0.5
    ? { r: 0, g: 0, b: 0 }
    : { r: 255, g: 255, b: 255 };
  for (let step = 1; step <= 20; step += 1) {
    const amount = step / 20;
    const candidate = toHex({
      r: color.r + (target.r - color.r) * amount,
      g: color.g + (target.g - color.g) * amount,
      b: color.b + (target.b - color.b) * amount,
    });
    if (contrastRatio(candidate, background) >= targetContrast) return candidate;
  }
  return toHex(target);
}

export function accessibleTextPreviews(value: string): { light: string; dark: string } {
  // Default DOCX ink must match unmarked text after reopening in dark mode.
  if (value.toLowerCase() === DARK_TEXT) return { light: DARK_TEXT, dark: '#f8f9fb' };
  return {
    light: accessibleColor(value, LIGHT_PAPER),
    dark: accessibleColor(value, DARK_PAPER, 7),
  };
}

export function highlightForeground(background: string): string {
  return contrastRatio(DARK_TEXT, background) >= contrastRatio(LIGHT_TEXT, background)
    ? DARK_TEXT
    : LIGHT_TEXT;
}

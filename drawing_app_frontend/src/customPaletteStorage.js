/**
 * Custom palette storage adapter (localStorage).
 *
 * Flow name: CustomPaletteFlow
 * Layer: Adapter / I-O (side effects isolated to localStorage)
 *
 * Contract:
 * - Stored shape: JSON stringified array of color strings (normalized "#rrggbb", lowercase)
 * - Inputs:
 *    - colors: string[]
 *    - color: string (hex)
 * - Outputs:
 *    - string[] normalized, unique, stable order
 * - Errors:
 *    - Never throws to callers; on malformed data or storage issues returns safe defaults.
 * - Side effects:
 *    - Reads/writes to window.localStorage at a single key.
 */

const STORAGE_KEY = "drawingStudio.customPalette.v1";
const MAX_COLORS = 24;

/**
 * Normalize a hex color to "#rrggbb" lowercase. Returns null if invalid.
 * Accepts "#RGB" and "#RRGGBB".
 */
function normalizeHexColor(input) {
  if (typeof input !== "string") return null;
  const raw = input.trim().toLowerCase();

  const m6 = raw.match(/^#([0-9a-f]{6})$/i);
  if (m6) return `#${m6[1].toLowerCase()}`;

  const m3 = raw.match(/^#([0-9a-f]{3})$/i);
  if (m3) {
    const [r, g, b] = m3[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  return null;
}

function safeParseJsonArray(value) {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function uniqStable(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function clampPalette(colors) {
  return colors.slice(0, MAX_COLORS);
}

// PUBLIC_INTERFACE
export function loadCustomPalette() {
  /** Load the custom palette from localStorage (safe; returns [] on errors). */
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) || "";
    const items = safeParseJsonArray(raw);
    const normalized = items.map(normalizeHexColor).filter(Boolean);
    return clampPalette(uniqStable(normalized));
  } catch {
    return [];
  }
}

// PUBLIC_INTERFACE
export function saveCustomPalette(colors) {
  /** Persist the provided palette to localStorage (safe; no-throw). */
  if (typeof window === "undefined") return;
  try {
    const normalized = (Array.isArray(colors) ? colors : [])
      .map(normalizeHexColor)
      .filter(Boolean);

    const finalColors = clampPalette(uniqStable(normalized));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(finalColors));
  } catch {
    // Intentionally swallow: storage may be unavailable (private mode / quota / disabled).
  }
}

// PUBLIC_INTERFACE
export function addColorToCustomPalette(currentColors, color) {
  /**
   * Add a color to the palette.
   * Invariant: returns a new array, normalized, unique, newest-first, max MAX_COLORS.
   */
  const c = normalizeHexColor(color);
  if (!c) return clampPalette(uniqStable((currentColors || []).map(normalizeHexColor).filter(Boolean)));

  const base = (currentColors || []).map(normalizeHexColor).filter(Boolean);
  // Newest-first: place at front; remove existing occurrences.
  const without = base.filter((x) => x !== c);
  return clampPalette([c, ...without]);
}

// PUBLIC_INTERFACE
export function removeColorFromCustomPalette(currentColors, color) {
  /**
   * Remove a color from the palette.
   * Invariant: returns a new array, normalized, unique.
   */
  const c = normalizeHexColor(color);
  const base = (currentColors || []).map(normalizeHexColor).filter(Boolean);
  if (!c) return clampPalette(uniqStable(base));
  return clampPalette(uniqStable(base.filter((x) => x !== c)));
}

// PUBLIC_INTERFACE
export function clearCustomPalette() {
  /** Remove palette key from localStorage (safe; no-throw). */
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // swallow
  }
}

// PUBLIC_INTERFACE
export function normalizePaletteForUi(colors) {
  /** Normalize arbitrary palette arrays for UI usage. */
  const base = (Array.isArray(colors) ? colors : []).map(normalizeHexColor).filter(Boolean);
  return clampPalette(uniqStable(base));
}

// PUBLIC_INTERFACE
export function isColorInPalette(colors, color) {
  /** Check whether a color is present (after normalization). */
  const c = normalizeHexColor(color);
  if (!c) return false;
  const base = (colors || []).map(normalizeHexColor).filter(Boolean);
  return base.includes(c);
}

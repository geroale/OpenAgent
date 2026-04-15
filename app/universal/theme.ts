/**
 * Shared color palette and design tokens.
 *
 * On the web/Electron renderer, scalar color tokens are exposed as CSS
 * custom-property references (`var(--oa-<key>)`) so that a theme toggle
 * simply flips `document.documentElement.dataset.theme` and the entire
 * UI updates without reloading. The raw hex palettes (`lightColors`,
 * `darkColors`) remain available for any code that needs actual color
 * values (e.g. graph canvas, gradient stops, color math).
 *
 * On native, no CSS var plumbing exists — `colors` holds hex values that
 * are mutated in place on `setTheme`. Native theme-change still needs the
 * containing screen to re-render to pick up module-scoped StyleSheets.
 */

export type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'openagent:theme';
const STYLE_ELEMENT_ID = 'oa-theme-vars';

const isWeb = typeof document !== 'undefined';

/**
 * Palette kept in sync with the marketing docs theme at
 * `docs/.vitepress/theme/custom.css`. Brand: `--vp-c-brand-1` (#d94841) →
 * `--vp-c-brand-3` (#f3a33a). Neutrals mirror `--vp-c-bg*` and
 * `--vp-c-text-*`; dark mode mirrors the `.dark` block verbatim so the
 * desktop app and web docs feel like one product.
 */
export const lightColors = {
  // Brand — accent reserved for primary actions
  primary: '#D94841',        // --vp-c-brand-1
  primaryEnd: '#F3A33A',     // --vp-c-brand-3
  primaryLight: '#FBECEC',   // rgba(217, 72, 65, 0.1) over #ffffff
  primaryMuted: '#E67A41',   // --vp-c-brand-2

  // Neutrals
  bg: '#F6F7F9',             // --vp-c-bg-alt
  surface: '#FFFFFF',        // --vp-c-bg / --vp-c-bg-elv
  sidebar: '#F1F3F5',
  border: '#E5E7EB',         // --vp-c-border
  borderLight: '#EEF0F3',
  inputBg: '#FFFFFF',

  // Text
  text: '#111827',           // --vp-c-text-1
  textSecondary: '#475467',  // --vp-c-text-2
  textMuted: '#667085',      // --vp-c-text-3
  textInverse: '#FFFFFF',

  // Status
  success: '#1F9D6A',
  error: '#C94A43',
  warning: '#D88B1F',

  // Soft/muted variants used for tool-status badges + error outlines.
  // Precomputed so we don't concatenate hex alpha at render time (that
  // pattern breaks under CSS var() references).
  successSoft: 'rgba(31, 157, 106, 0.14)',
  errorSoft: 'rgba(201, 74, 67, 0.14)',
  errorBorder: 'rgba(201, 74, 67, 0.38)',
  mutedSoft: 'rgba(102, 112, 133, 0.14)',

  // Graph canvas
  graphBg: '#F8FAFC',
  graphEdge: '#CBD5E1',
  graphLabel: '#334155',
  graphRing: '#F3A33A',
  graphNodeMuted: '#94A3B8',

  // Graph node palette
  graph: [
    '#D94841',
    '#F3A33A',
    '#2563EB',
    '#0F766E',
    '#7C3AED',
    '#475569',
    '#DC2626',
    '#EA580C',
    '#0284C7',
    '#4F46E5',
  ],

  // Code blocks
  codeBg: '#0F172A',
  codeText: '#E2E8F0',
  codeKeyword: '#F3A33A',
} as const;

export const darkColors: typeof lightColors = {
  // Brand — unchanged in docs `.dark`; brand-soft shifts to amber tint
  primary: '#D94841',        // --vp-c-brand-1
  primaryEnd: '#F3A33A',     // --vp-c-brand-3
  primaryLight: '#2A2119',   // rgba(243, 163, 58, 0.14) over #172033
  primaryMuted: '#E67A41',   // --vp-c-brand-2

  // Neutrals (match docs `.dark`)
  bg: '#0F172A',             // --vp-c-bg
  surface: '#172033',        // --vp-c-bg-elv
  sidebar: '#111827',        // --vp-c-bg-alt
  border: '#273247',         // --vp-c-border
  borderLight: '#1F2A3F',
  inputBg: '#172033',

  // Text
  text: '#F8FAFC',           // --vp-c-text-1
  textSecondary: '#CBD5E1',  // --vp-c-text-2
  textMuted: '#94A3B8',      // --vp-c-text-3
  textInverse: '#FFFFFF',

  // Status
  success: '#34C77B',
  error: '#E56A62',
  warning: '#EEB154',

  // Soft variants (higher alpha for dark surface legibility)
  successSoft: 'rgba(52, 199, 123, 0.18)',
  errorSoft: 'rgba(229, 106, 98, 0.18)',
  errorBorder: 'rgba(229, 106, 98, 0.45)',
  mutedSoft: 'rgba(148, 163, 184, 0.14)',

  // Graph canvas
  graphBg: '#0F172A',
  graphEdge: '#273247',
  graphLabel: '#CBD5E1',
  graphRing: '#F3A33A',
  graphNodeMuted: '#64748B',

  // Graph node palette
  graph: [
    '#D94841',
    '#F3A33A',
    '#60A5FA',
    '#2DD4BF',
    '#A78BFA',
    '#94A3B8',
    '#F87171',
    '#FB923C',
    '#38BDF8',
    '#818CF8',
  ],

  // Code blocks
  codeBg: '#0B1220',
  codeText: '#E2E8F0',
  codeKeyword: '#F3A33A',
};

/** Keys whose values are scalar color strings (not arrays). These are
 *  the ones we expose as `var(--oa-<key>)` references on web. */
const SCALAR_KEYS = (Object.keys(lightColors) as (keyof typeof lightColors)[])
  .filter((k) => !Array.isArray((lightColors as any)[k]));

function readInitialMode(): ThemeMode {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(THEME_STORAGE_KEY);
      if (v === 'dark') return 'dark';
    }
  } catch {
    /* ignore */
  }
  return 'light';
}

let currentMode: ThemeMode = readInitialMode();

/** Build the palette that consumers import as `colors`.
 *  - Web: scalar keys become CSS var references, arrays stay as arrays.
 *  - Native: scalar keys are the raw hex values for the current mode. */
function buildColors(mode: ThemeMode): typeof lightColors {
  const src = mode === 'dark' ? darkColors : lightColors;
  const out: any = {};
  for (const key of Object.keys(src)) {
    const v = (src as any)[key];
    if (isWeb && SCALAR_KEYS.includes(key as any)) {
      out[key] = `var(--oa-${key})`;
    } else {
      out[key] = v;
    }
  }
  return out;
}

/** Mutable, singleton palette. Mutate in place via `setTheme` so modules
 *  that captured references during `StyleSheet.create(...)` keep pointing
 *  at the same underlying object. On web the scalar values are all
 *  `var(--oa-*)` strings, which the browser resolves at paint time — so
 *  a theme toggle doesn't need JS to rewrite any bound styles. */
export const colors: { -readonly [K in keyof typeof lightColors]: (typeof lightColors)[K] } =
  buildColors(currentMode) as any;

/** Emit the `--oa-*` CSS variables for both themes and apply
 *  `data-theme` to <html>. Called once at startup on web. */
function ensureCssVariables(): void {
  if (!isWeb) return;
  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }
  const toBlock = (selector: string, palette: typeof lightColors) => {
    const lines = SCALAR_KEYS
      .map((k) => `  --oa-${k}: ${(palette as any)[k]};`)
      .join('\n');
    return `${selector} {\n${lines}\n}`;
  };
  el.textContent = [
    toBlock(':root, :root[data-theme="light"]', lightColors),
    toBlock(':root[data-theme="dark"]', darkColors),
  ].join('\n\n');
  document.documentElement.setAttribute('data-theme', currentMode);
}

ensureCssVariables();

export function getThemeMode(): ThemeMode {
  return currentMode;
}

/** Raw palette for the current theme — always actual hex values, never
 *  `var(--oa-*)` references. Use this in contexts that can't resolve CSS
 *  variables at paint time (Canvas 2D `fillStyle`/`strokeStyle`, gradient
 *  stop math, etc.). DOM styles should keep using `colors` so theme
 *  toggles re-paint without re-running JS. */
export function getRawColors(): typeof lightColors {
  return currentMode === 'dark' ? darkColors : lightColors;
}

/**
 * Switch theme. On web this just toggles the `data-theme` attribute
 * (browser re-resolves every `var(--oa-*)` instantly — no reload). We
 * also refresh the `colors.graph` array and any other non-scalar values
 * so code that reads them programmatically sees the right palette.
 * Persists the choice in localStorage.
 */
export function setTheme(mode: ThemeMode): void {
  if (mode === currentMode) return;
  currentMode = mode;
  const src = mode === 'dark' ? darkColors : lightColors;
  // Update non-scalar entries (arrays) in place. Scalars stay as
  // `var(--oa-*)` strings on web and are flipped via data-theme below.
  for (const key of Object.keys(src)) {
    if (!SCALAR_KEYS.includes(key as any)) {
      (colors as any)[key] = (src as any)[key];
    } else if (!isWeb) {
      // Native: actually replace the hex value so re-rendered screens
      // pick up the new color.
      (colors as any)[key] = (src as any)[key];
    }
  }
  if (isWeb) {
    document.documentElement.setAttribute('data-theme', mode);
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
  } catch {
    /* ignore */
  }
}

/** CSS gradient string for web backgrounds — uses raw brand hex so it
 *  renders correctly regardless of theme (brand gradient stays brand). */
export const primaryGradient = 'linear-gradient(135deg, #d94841 0%, #f3a33a 100%)';
export const primaryGradientStops = [lightColors.primary, lightColors.primaryEnd] as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  full: 9999,
} as const;

export const font = {
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
} as const;

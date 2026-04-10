/**
 * Shared color palette and design tokens.
 * Primary gradient: #ef4136 (red) → #fbb040 (amber/orange).
 */

export const colors = {
  // Brand — red-to-amber gradient endpoints
  primary: '#ef4136',        // main accent (buttons, active states)
  primaryEnd: '#fbb040',     // gradient end (amber)
  primaryLight: '#FFF0E4',   // tinted background
  primaryMuted: '#F4856E',   // softer red

  // Neutrals
  bg: '#FFF9F5',
  surface: '#FFFFFF',
  sidebar: '#FFF3EA',
  border: '#F2DED1',
  borderLight: '#F7E8DE',
  inputBg: '#FFF5EE',

  // Text
  text: '#1C1612',
  textSecondary: '#6E5A4B',
  textMuted: '#A48C7A',
  textInverse: '#FFFFFF',

  // Status
  success: '#4CAF50',
  error: '#D94F4F',
  warning: '#E5A100',

  // Graph canvas
  graphBg: '#FFF2E8',
  graphEdge: '#EFC4A6',
  graphLabel: '#6D3920',
  graphRing: '#F7A24C',
  graphNodeMuted: '#E97A5A',

  // Graph node palette (red → amber gradient steps)
  graph: [
    '#ef4136',  // red
    '#f15a3a',  // red-orange
    '#f3733e',  // orange-red
    '#f58b42',  // orange
    '#f7a346',  // amber-orange
    '#fbb040',  // amber
    '#e84e3c',  // dark red
    '#f06940',  // warm orange
    '#f89744',  // golden
    '#d63a30',  // deep red
  ],

  // Code blocks
  codeBg: '#241912',
  codeText: '#E8DCD2',
  codeKeyword: '#f58b42',
} as const;

/** CSS gradient string for web backgrounds */
export const primaryGradient = 'linear-gradient(135deg, #ef4136 0%, #fbb040 100%)';
export const primaryGradientStops = [colors.primary, colors.primaryEnd] as const;

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

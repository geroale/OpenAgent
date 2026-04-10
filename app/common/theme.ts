/**
 * Shared color palette and design tokens.
 * All components import from here — single source of truth.
 */

export const colors = {
  // Brand
  primary: '#D97757',        // warm terracotta (accent, buttons, links)
  primaryLight: '#FFF3EE',   // tinted background
  primaryMuted: '#E8A48C',   // softer variant

  // Neutrals
  bg: '#FAFAFA',             // page background
  surface: '#FFFFFF',        // cards, panels, bubbles
  sidebar: '#F5F5F5',        // sidebar, header background
  border: '#EBEBEB',         // subtle borders
  borderLight: '#F0F0F0',    // very light separators
  inputBg: '#F5F5F5',        // input fields

  // Text
  text: '#1a1a1a',           // primary text
  textSecondary: '#666666',  // labels, descriptions
  textMuted: '#999999',      // placeholders, hints
  textInverse: '#FFFFFF',    // text on primary bg

  // Status
  success: '#4CAF50',        // connected, online
  error: '#D94F4F',          // errors, destructive
  warning: '#E5A100',        // warnings

  // Graph node palette (harmonized with primary)
  graph: [
    '#D97757',   // primary
    '#C47A5A',   // burnt sienna
    '#B8856C',   // tan
    '#A68B7B',   // warm gray
    '#D4976E',   // peach
    '#C2694D',   // rust
    '#DBA07A',   // sand
    '#BF7856',   // copper
    '#E8B796',   // light coral
    '#A0614A',   // deep terracotta
  ],

  // Code blocks
  codeBg: '#1E1E1E',
  codeText: '#D4D4D4',
  codeKeyword: '#C7402D',
} as const;

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

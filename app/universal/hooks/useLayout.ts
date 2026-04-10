/**
 * Responsive layout hook.
 * Returns isWide (>= 768px) for tablet/desktop vs mobile distinction.
 */

import { useWindowDimensions } from 'react-native';

const TABLET_BREAKPOINT = 768;

export function useIsWideScreen(): boolean {
  const { width } = useWindowDimensions();
  return width >= TABLET_BREAKPOINT;
}

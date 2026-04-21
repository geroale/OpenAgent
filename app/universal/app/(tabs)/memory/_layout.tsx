/**
 * Memory tab — Expo Router Stack.
 *
 * Opens on the graph dashboard (``index``). Tapping a note (in the
 * sidebar or on a graph node) pushes the editor onto this stack as
 * ``[...path]`` — catch-all so note paths with folder segments
 * (``docs/ideas.md``) work as-is.
 *
 * Mirrors ``mcps/_layout.tsx`` and ``workflows/_layout.tsx`` — same
 * pattern, same transitions, headers suppressed because each screen
 * renders its own title bar.
 */

import { Stack } from 'expo-router';

export default function MemoryStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[...path]" />
    </Stack>
  );
}

/**
 * Responsive sidebar — simple, no navigator dependency.
 *
 * Wide (>= 768px): fixed panel beside content.
 * Narrow (< 768px): overlay drawer toggled via Header hamburger.
 */

import { useState, useEffect, useRef } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useIsWideScreen } from '../hooks/useLayout';
import { useDrawer } from '../stores/drawer';

const SIDEBAR_WIDTH = 260;

interface Props {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export default function ResponsiveSidebar({ sidebar, children }: Props) {
  const isWide = useIsWideScreen();
  const toggleRequested = useDrawer((s) => s.toggleRequested);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const lastToggle = useRef(0);

  // Toggle drawer on hamburger press
  useEffect(() => {
    if (toggleRequested > 0 && toggleRequested !== lastToggle.current) {
      lastToggle.current = toggleRequested;
      setDrawerOpen((prev) => !prev);
    }
  }, [toggleRequested]);

  // Close drawer when switching to wide layout
  useEffect(() => {
    if (isWide) setDrawerOpen(false);
  }, [isWide]);

  if (isWide) {
    return (
      <View style={styles.row}>
        <View style={styles.fixedSidebar}>{sidebar}</View>
        <View style={styles.fill}>{children}</View>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      {children}
      {drawerOpen && (
        <>
          <Pressable style={styles.backdrop} onPress={() => setDrawerOpen(false)} />
          <View style={styles.drawer}>{sidebar}</View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  fill: { flex: 1 },
  fixedSidebar: {
    width: SIDEBAR_WIDTH,
    backgroundColor: '#F5F5F5',
    borderRightWidth: 1,
    borderRightColor: '#EBEBEB',
  },
  backdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    zIndex: 100,
  },
  drawer: {
    position: 'absolute',
    top: 0, left: 0, bottom: 0,
    width: SIDEBAR_WIDTH,
    backgroundColor: '#F5F5F5',
    borderRightWidth: 1,
    borderRightColor: '#EBEBEB',
    zIndex: 101,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
});

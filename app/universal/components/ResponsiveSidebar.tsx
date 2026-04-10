/**
 * Responsive sidebar: fixed panel on wide screens, slide-in drawer on mobile.
 *
 * Wide (>= 768px): renders as a fixed left panel beside children.
 * Narrow (< 768px): renders as an overlay drawer triggered by a hamburger
 * button. The drawer slides in from the left with a backdrop.
 */

import { useState } from 'react';
import {
  View, TouchableOpacity, Text, Pressable, StyleSheet, Animated,
} from 'react-native';
import { useIsWideScreen } from '../hooks/useLayout';

interface Props {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  sidebarWidth?: number;
}

export default function ResponsiveSidebar({ sidebar, children, sidebarWidth = 240 }: Props) {
  const isWide = useIsWideScreen();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (isWide) {
    // Fixed sidebar
    return (
      <View style={styles.row}>
        <View style={[styles.fixedSidebar, { width: sidebarWidth }]}>
          {sidebar}
        </View>
        <View style={styles.main}>{children}</View>
      </View>
    );
  }

  // Mobile: drawer overlay
  return (
    <View style={styles.fill}>
      {/* Hamburger button */}
      <TouchableOpacity
        style={styles.hamburger}
        onPress={() => setDrawerOpen(true)}
      >
        <Text style={styles.hamburgerText}>☰</Text>
      </TouchableOpacity>

      {/* Main content */}
      <View style={styles.fill}>{children}</View>

      {/* Drawer overlay */}
      {drawerOpen && (
        <>
          <Pressable
            style={styles.backdrop}
            onPress={() => setDrawerOpen(false)}
          />
          <View style={[styles.drawer, { width: sidebarWidth }]}>
            {sidebar}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  fill: { flex: 1 },
  fixedSidebar: {
    backgroundColor: '#F5F5F5',
    borderRightWidth: 1,
    borderRightColor: '#EBEBEB',
  },
  main: { flex: 1 },

  // Mobile hamburger
  hamburger: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 50,
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  hamburgerText: { fontSize: 18, color: '#666' },

  // Drawer overlay
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    zIndex: 100,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
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

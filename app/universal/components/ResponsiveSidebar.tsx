/**
 * Responsive sidebar using @react-navigation/drawer.
 *
 * Wide (>= 768px): permanently open sidebar.
 * Narrow (< 768px): slide-in drawer with gesture support.
 */

import { useEffect, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import {
  createDrawerNavigator,
  DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { NavigationIndependentTree, useNavigation } from '@react-navigation/native';
import { useIsWideScreen } from '../hooks/useLayout';
import { useDrawer } from '../stores/drawer';

const SIDEBAR_WIDTH = 260;
const Nav = createDrawerNavigator();

// Stable refs for content — avoids remounting on every render
let _sidebarRef: React.ReactNode = null;
let _childrenRef: React.ReactNode = null;

function DrawerContent(_props: DrawerContentComponentProps) {
  return <View style={styles.drawerContent}>{_sidebarRef}</View>;
}

function MainScreen() {
  const navigation = useNavigation<any>();
  const toggleRequested = useDrawer((s) => s.toggleRequested);
  const lastToggle = useRef(0);

  useEffect(() => {
    if (toggleRequested > 0 && toggleRequested !== lastToggle.current) {
      lastToggle.current = toggleRequested;
      navigation.toggleDrawer();
    }
  }, [toggleRequested, navigation]);

  return <View style={styles.fill}>{_childrenRef}</View>;
}

interface Props {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export default function ResponsiveSidebar({ sidebar, children }: Props) {
  const isWide = useIsWideScreen();

  // Update refs without causing component identity change
  _sidebarRef = sidebar;
  _childrenRef = children;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.createElement('style');
    style.textContent = `[style*="border-radius: 0px 16px"] { border-radius: 0px !important; }`;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  return (
    <NavigationIndependentTree>
      <Nav.Navigator
        screenOptions={{
          headerShown: false,
          drawerType: isWide ? 'permanent' : 'front',
          drawerStyle: {
            width: SIDEBAR_WIDTH,
            backgroundColor: '#F5F5F5',
            borderRightWidth: 1,
            borderRightColor: '#EBEBEB',
            borderRadius: 0,
          },
          sceneContainerStyle: { borderRadius: 0 } as any,
          sceneStyle: { borderRadius: 0 } as any,
          overlayColor: 'rgba(0,0,0,0.3)',
          swipeEnabled: !isWide,
          drawerStatusBarAnimation: 'none',
        }}
        drawerContent={DrawerContent}
      >
        <Nav.Screen name="__main__" component={MainScreen} />
      </Nav.Navigator>
    </NavigationIndependentTree>
  );
}

const styles = StyleSheet.create({
  drawerContent: { flex: 1 },
  fill: { flex: 1 },
});

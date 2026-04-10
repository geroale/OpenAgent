/**
 * Responsive sidebar using @react-navigation/drawer.
 *
 * Wide (>= 768px): permanently open sidebar.
 * Narrow (< 768px): slide-in drawer with gesture support.
 *
 * Listens to useDrawer.toggleRequested to open/close on narrow screens
 * (triggered by the hamburger button in the Header).
 */

import { useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  createDrawerNavigator,
  DrawerContentComponentProps,
  useDrawerStatus,
} from '@react-navigation/drawer';
import { NavigationIndependentTree, useNavigation } from '@react-navigation/native';
import { useIsWideScreen } from '../hooks/useLayout';
import { useDrawer } from '../stores/drawer';

const SIDEBAR_WIDTH = 260;

const Nav = createDrawerNavigator();

interface Props {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export default function ResponsiveSidebar({ sidebar, children }: Props) {
  const isWide = useIsWideScreen();

  const renderDrawerContent = useCallback(
    (_props: DrawerContentComponentProps) => (
      <View style={styles.drawerContent}>{sidebar}</View>
    ),
    [sidebar],
  );

  // Main screen component that listens for toggle events
  const MainScreen = useCallback(
    () => <DrawerToggleListener>{children}</DrawerToggleListener>,
    [children],
  );

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
          overlayColor: 'rgba(0,0,0,0.3)',
          swipeEnabled: !isWide,
        }}
        drawerContent={renderDrawerContent}
      >
        <Nav.Screen name="__main__" component={MainScreen} />
      </Nav.Navigator>
    </NavigationIndependentTree>
  );
}

/** Listens to the global drawer toggle store and opens/closes the drawer */
function DrawerToggleListener({ children }: { children: React.ReactNode }) {
  const navigation = useNavigation<any>();
  const toggleRequested = useDrawer((s) => s.toggleRequested);
  const lastToggle = useRef(0);

  useEffect(() => {
    if (toggleRequested > 0 && toggleRequested !== lastToggle.current) {
      lastToggle.current = toggleRequested;
      navigation.toggleDrawer();
    }
  }, [toggleRequested, navigation]);

  return <View style={styles.fill}>{children}</View>;
}

const styles = StyleSheet.create({
  drawerContent: { flex: 1 },
  fill: { flex: 1 },
});

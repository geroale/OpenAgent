/**
 * Responsive sidebar using @react-navigation/drawer.
 *
 * Wide (>= 768px): drawer permanently open (type="permanent").
 * Narrow (< 768px): drawer slides in/out with gesture + animation (type="front").
 *
 * Uses react-native-gesture-handler + react-native-reanimated for smooth
 * native-quality animations on all platforms.
 */

import { useRef, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { createDrawerNavigator, DrawerContentComponentProps } from '@react-navigation/drawer';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { useIsWideScreen } from '../hooks/useLayout';

const Drawer = createDrawerNavigator();

interface Props {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  sidebarWidth?: number;
}

export default function ResponsiveSidebar({ sidebar, children, sidebarWidth = 240 }: Props) {
  const isWide = useIsWideScreen();
  const navRef = useRef<NavigationContainerRef<any>>(null);

  const renderDrawerContent = useCallback(
    (_props: DrawerContentComponentProps) => (
      <View style={styles.drawerContent}>{sidebar}</View>
    ),
    [sidebar],
  );

  const MainScreen = useCallback(
    () => <View style={styles.fill}>{children}</View>,
    [children],
  );

  return (
    <NavigationContainer independent ref={navRef}>
      <Drawer.Navigator
        screenOptions={{
          headerShown: false,
          drawerType: isWide ? 'permanent' : 'front',
          drawerStyle: {
            width: sidebarWidth,
            backgroundColor: '#F5F5F5',
            borderRightWidth: 1,
            borderRightColor: '#EBEBEB',
          },
          overlayColor: 'rgba(0,0,0,0.3)',
          swipeEnabled: !isWide,
        }}
        drawerContent={renderDrawerContent}
      >
        <Drawer.Screen name="__main__" component={MainScreen} />
      </Drawer.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  drawerContent: { flex: 1 },
  fill: { flex: 1 },
});

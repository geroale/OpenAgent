/**
 * Responsive sidebar using @react-navigation/drawer.
 *
 * Wide (>= 768px): permanently open sidebar.
 * Narrow (< 768px): slide-in drawer with gesture support.
 *
 * Uses React Context to pass sidebar/children content to stable screen
 * components — avoids component identity changes that cause remounting.
 */

import { createContext, useContext, useEffect, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import {
  createDrawerNavigator,
  DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { NavigationIndependentTree, useNavigation } from '@react-navigation/native';
import { useIsWideScreen } from '../hooks/useLayout';
import { useDrawer } from '../stores/drawer';
import { colors } from '../theme';

const SIDEBAR_WIDTH = 260;
const Nav = createDrawerNavigator();

// Context to pass dynamic content without changing component identity
const ContentCtx = createContext<{ sidebar: React.ReactNode; children: React.ReactNode }>({
  sidebar: null,
  children: null,
});

// Stable components — never change identity, read content from context
function SidebarContent(_props: DrawerContentComponentProps) {
  const { sidebar } = useContext(ContentCtx);
  return <View style={styles.drawerContent}>{sidebar}</View>;
}

function MainScreen() {
  const { children } = useContext(ContentCtx);
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

interface Props {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export default function ResponsiveSidebar({ sidebar, children }: Props) {
  const isWide = useIsWideScreen();

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.createElement('style');
    style.textContent = `[style*="border-radius: 0px 16px"] { border-radius: 0px !important; }`;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  return (
    <ContentCtx.Provider value={{ sidebar, children }}>
      <NavigationIndependentTree>
        <Nav.Navigator
          screenOptions={{
            headerShown: false,
            drawerType: isWide ? 'permanent' : 'front',
            drawerStyle: {
              width: SIDEBAR_WIDTH,
              backgroundColor: colors.sidebar,
              borderRightWidth: 1,
              borderRightColor: colors.border,
              borderRadius: 0,
            },
            sceneStyle: { borderRadius: 0 } as any,
            overlayColor: 'rgba(0,0,0,0.3)',
            swipeEnabled: !isWide,
            drawerStatusBarAnimation: 'none',
          }}
          drawerContent={SidebarContent}
        >
          <Nav.Screen name="__main__" component={MainScreen} />
        </Nav.Navigator>
      </NavigationIndependentTree>
    </ContentCtx.Provider>
  );
}

const styles = StyleSheet.create({
  drawerContent: { flex: 1 },
  fill: { flex: 1 },
});

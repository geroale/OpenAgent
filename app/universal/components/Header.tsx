import { colors, font, radius } from '../theme';
/**
 * App header with drag area + account switcher.
 * Refined editorial style — subtle, minimal, readable at a glance.
 */

import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection } from '../stores/connection';
import { useIsWideScreen } from '../hooks/useLayout';
import { useDrawer } from '../stores/drawer';
import { useConfirm } from './ConfirmDialog';

function getDesktopPlatform(): 'darwin' | 'win32' | 'linux' | null {
  if (Platform.OS !== 'web') return null;
  const p = (window as any).desktop?.platform;
  if (p === 'darwin' || p === 'win32' || p === 'linux') return p;
  return null;
}

export default function Header() {
  const router = useRouter();
  const platform = getDesktopPlatform();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const isWide = useIsWideScreen();
  const requestToggle = useDrawer((s) => s.requestToggle);
  const confirm = useConfirm();

  const {
    accounts, activeAccountId, isConnected, agentName,
    disconnect, removeAccount,
  } = useConnection();

  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const displayName = activeAccount?.name || agentName || 'Not Connected';

  const handleSwitch = async (id: string) => {
    setDropdownOpen(false);
    if (id !== activeAccountId) {
      // Switching networks requires re-prompting for the password
      // (the cert may need refresh) — bounce through the login screen
      // so the user enters credentials cleanly. The login screen
      // remembers the selected account. Await the disconnect so the
      // login screen mounts with ``isConnected: false``.
      await disconnect();
      router.replace('/');
    }
  };

  const handleRemove = async (id: string, name: string) => {
    const confirmed = await confirm({
      title: 'Remove Agent',
      message: `Remove "${name}"? You can re-add it later.`,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;

    setDropdownOpen(false);
    if (id === activeAccountId) {
      // Same reason as handleSwitch: await before navigating so the
      // login screen never sees a stale ``isConnected: true``.
      await removeAccount(id);
      router.replace('/');
    } else {
      void removeAccount(id);
    }
  };

  const handleAdd = async () => {
    setDropdownOpen(false);
    // Await the disconnect so the login screen mounts AFTER
    // ``isConnected`` has flipped to false. Otherwise its
    // auto-redirect effect can re-fire and bounce the user back to
    // the chat tab, landing on an empty session.
    await useConnection.getState().disconnect();
    router.replace('/');
  };

  return (
    <View style={[
      styles.header,
      // @ts-ignore web CSS
      { WebkitAppRegion: 'drag' },
    ]}>
      {platform === 'darwin' && <View style={styles.macPadding} />}

      {!isWide && (
        <TouchableOpacity
          onPress={requestToggle}
          style={[
            styles.hamburgerBtn,
            // @ts-ignore
            { WebkitAppRegion: 'no-drag' },
          ]}
        >
          <Feather name="menu" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      )}

      <View style={styles.center}>
        <TouchableOpacity
          onPress={() => setDropdownOpen(!dropdownOpen)}
          style={[
            styles.switcherBtn,
            // @ts-ignore
            { WebkitAppRegion: 'no-drag' },
          ]}
        >
          <View style={[styles.statusDot, isConnected ? styles.dotGreen : styles.dotGray]} />
          <Text style={styles.accountName} numberOfLines={1}>{displayName}</Text>
          <Feather name="chevron-down" size={12} color={colors.textMuted} style={styles.chevron} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={handleAdd}
        style={[
          styles.addBtn,
          // @ts-ignore
          { WebkitAppRegion: 'no-drag' },
        ]}
      >
        <Feather name="plus" size={14} color={colors.textSecondary} />
      </TouchableOpacity>

      {platform && (
        <TouchableOpacity
          onPress={() => { void (window as any).desktop?.quit?.(); }}
          style={[
            styles.closeBtn,
            // @ts-ignore
            { WebkitAppRegion: 'no-drag' },
          ]}
          accessibilityLabel="Quit OpenAgent"
        >
          <Feather name="x" size={14} color={colors.textSecondary} />
        </TouchableOpacity>
      )}

      {(platform === 'win32' || platform === 'linux') && <View style={styles.winPadding} />}

      {dropdownOpen && (
        <>
          <Pressable
            style={styles.backdrop}
            onPress={() => setDropdownOpen(false)}
          />
          <View style={styles.dropdown}>
            {accounts.length === 0 && (
              <Text style={styles.emptyDropdown}>No saved accounts</Text>
            )}
            {accounts.map((acc) => (
              <View key={acc.id} style={styles.dropdownRow}>
                <TouchableOpacity
                  style={styles.dropdownItem}
                  onPress={() => handleSwitch(acc.id)}
                >
                  <Feather
                    name={acc.id === activeAccountId ? 'check-circle' : 'circle'}
                    size={13}
                    color={acc.id === activeAccountId ? colors.primary : colors.textMuted}
                    style={styles.radioBtn}
                  />
                  <View style={styles.dropdownInfo}>
                    <Text style={styles.dropdownName} numberOfLines={1}>{acc.name}</Text>
                    <Text style={styles.dropdownHost}>{acc.handle}@{acc.network}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { void handleRemove(acc.id, acc.name); }}
                  style={styles.removeBtn}
                >
                  <Feather name="x" size={13} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.dropdownAdd} onPress={handleAdd}>
              <View style={styles.dropdownAddContent}>
                <Feather name="plus" size={13} color={colors.primary} />
                <Text style={styles.dropdownAddText}>Add Agent</Text>
              </View>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.sidebar,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    position: 'relative',
    zIndex: 200,
  },
  macPadding: { width: 78 },
  winPadding: { width: 140 },
  hamburgerBtn: {
    width: 28, height: 28,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 8, borderRadius: radius.sm,
  },
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
  },
  switcherBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.sm,
  },
  statusDot: {
    width: 6, height: 6, borderRadius: 3, marginRight: 8,
  },
  dotGreen: { backgroundColor: colors.success },
  dotGray: { backgroundColor: colors.borderStrong },
  accountName: {
    fontSize: 12.5, fontWeight: '500', color: colors.text,
    maxWidth: 220, letterSpacing: -0.1,
  },
  chevron: { marginLeft: 4 },
  addBtn: {
    width: 24, height: 24, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 6,
  },
  closeBtn: {
    width: 24, height: 24, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 8,
  },
  themeBtn: {
    width: 24, height: 24, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 8,
  },
  backdrop: {
    position: 'absolute', top: 40, left: 0, right: 0, bottom: -1000,
    zIndex: 999,
  },
  dropdown: {
    position: 'absolute', top: 40, left: '50%',
    // @ts-ignore web transform
    transform: [{ translateX: -130 }],
    width: 260,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: 'rgba(0,0,0,0.12)',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 1, shadowRadius: 32,
    // @ts-ignore
    elevation: 8,
    zIndex: 1000,
    paddingVertical: 4,
    // @ts-ignore web className
    ...(Platform.OS === 'web' ? { className: 'oa-fade-in' } : {}),
  },
  dropdownRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingRight: 4,
  },
  dropdownItem: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, paddingHorizontal: 10,
  },
  radioBtn: { marginRight: 10 },
  dropdownInfo: { flex: 1 },
  dropdownName: {
    fontSize: 12.5, color: colors.text, fontWeight: '500',
    letterSpacing: -0.1,
  },
  dropdownHost: {
    fontSize: 10.5, color: colors.textMuted, marginTop: 1,
    fontFamily: font.mono,
  },
  removeBtn: { padding: 6 },
  emptyDropdown: {
    padding: 14, fontSize: 12, color: colors.textMuted, textAlign: 'center',
  },
  dropdownAdd: {
    borderTopWidth: 1, borderTopColor: colors.borderLight,
    paddingVertical: 8, paddingHorizontal: 10, marginTop: 2,
  },
  dropdownAddContent: { flexDirection: 'row', alignItems: 'center' },
  dropdownAddText: {
    fontSize: 12, color: colors.primary, fontWeight: '500', marginLeft: 8,
  },
});

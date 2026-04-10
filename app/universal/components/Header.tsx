import { colors } from '../theme';
/**
 * App header with drag area + account switcher.
 *
 * - macOS: 78px left padding for traffic light buttons
 * - Windows: ~140px right padding for window controls
 * - Linux: similar to Windows
 * - Entire bar is draggable; interactive elements are no-drag zones
 */

import { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection } from '../stores/connection';

// Detect desktop platform from preload bridge
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

  const {
    accounts, activeAccountId, isConnected, agentName,
    switchAccount, removeAccount,
  } = useConnection();

  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const displayName = activeAccount?.name || agentName || 'Not Connected';

  const handleSwitch = (id: string) => {
    setDropdownOpen(false);
    if (id !== activeAccountId) {
      switchAccount(id);
      router.replace('/(tabs)/chat');
    }
  };

  const handleRemove = (id: string, name: string) => {
    if (window.confirm(`Remove "${name}"? You can re-add it later.`)) {
      removeAccount(id);
      setDropdownOpen(false);
      if (id === activeAccountId) {
        router.replace('/');
      }
    }
  };

  const handleAdd = () => {
    setDropdownOpen(false);
    // Disconnect so the login screen doesn't auto-redirect back to tabs
    useConnection.getState().disconnect();
    router.replace('/');
  };

  return (
    <View style={[
      styles.header,
      // @ts-ignore web CSS
      { WebkitAppRegion: 'drag' },
    ]}>
      {/* macOS traffic light padding */}
      {platform === 'darwin' && <View style={styles.macPadding} />}

      {/* Center: account switcher */}
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
          <Text style={styles.chevron}>▾</Text>
        </TouchableOpacity>
      </View>

      {/* Add account button */}
      <TouchableOpacity
        onPress={handleAdd}
        style={[
          styles.addBtn,
          // @ts-ignore
          { WebkitAppRegion: 'no-drag' },
        ]}
      >
        <Text style={styles.addBtnText}>+</Text>
      </TouchableOpacity>

      {/* Windows/Linux window button padding */}
      {(platform === 'win32' || platform === 'linux') && <View style={styles.winPadding} />}

      {/* Dropdown */}
      {dropdownOpen && (
        <>
          {/* Backdrop to close on outside click */}
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
                  <Text style={styles.radioBtn}>
                    {acc.id === activeAccountId ? '●' : '○'}
                  </Text>
                  <View style={styles.dropdownInfo}>
                    <Text style={styles.dropdownName} numberOfLines={1}>{acc.name}</Text>
                    <Text style={styles.dropdownHost}>{acc.host}:{acc.port}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleRemove(acc.id, acc.name)}
                  style={styles.removeBtn}
                >
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.dropdownAdd} onPress={handleAdd}>
              <Text style={styles.dropdownAddText}>+ Add Agent</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderBottomWidth: 1,
    borderBottomColor: '#EBEBEB',
    position: 'relative',
    zIndex: 200,
  },
  macPadding: { width: 78 },
  winPadding: { width: 140 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switcherBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 7,
  },
  dotGreen: { backgroundColor: '#4CAF50' },
  dotGray: { backgroundColor: '#CCC' },
  accountName: {
    fontSize: 13,
    fontWeight: '500',
    color: '#333',
    maxWidth: 200,
  },
  chevron: {
    fontSize: 11,
    color: '#999',
    marginLeft: 5,
  },
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    backgroundColor: '#EBEBEB',
  },
  addBtnText: {
    fontSize: 18,
    color: '#666',
    fontWeight: '400',
    marginTop: -1,
  },

  // Dropdown
  backdrop: {
    position: 'absolute',
    top: 38,
    left: 0,
    right: 0,
    bottom: -1000,
    zIndex: 999,
  },
  dropdown: {
    position: 'absolute',
    top: 36,
    left: '50%',
    // @ts-ignore web transform
    transform: [{ translateX: -120 }],
    width: 240,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    // @ts-ignore
    elevation: 8,
    zIndex: 1000,
    paddingVertical: 4,
  },
  dropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
  },
  dropdownItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  radioBtn: {
    fontSize: 10,
    color: colors.primary,
    marginRight: 8,
    width: 14,
  },
  dropdownInfo: { flex: 1 },
  dropdownName: {
    fontSize: 13,
    color: '#1a1a1a',
    fontWeight: '500',
  },
  dropdownHost: {
    fontSize: 11,
    color: '#999',
    marginTop: 1,
  },
  removeBtn: {
    padding: 6,
  },
  removeBtnText: {
    fontSize: 11,
    color: '#CCC',
  },
  emptyDropdown: {
    padding: 12,
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
  },
  dropdownAdd: {
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 2,
  },
  dropdownAddText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '500',
  },
});

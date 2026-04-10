/**
 * Login screen — saved accounts list + add new connection form.
 */

import { colors } from '../theme';
import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection } from '../stores/connection';
import { useChat } from '../stores/chat';
import { useConfirm } from '../components/ConfirmDialog';
import PrimaryButton from '../components/PrimaryButton';

export default function LoginScreen() {
  const router = useRouter();
  const {
    accounts, isConnected, error, agentName, isLoading,
    saveAccount, switchAccount, removeAccount,
  } = useConnection();
  const createSession = useChat((s) => s.createSession);
  const confirm = useConfirm();

  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('8765');
  const [token, setToken] = useState('');

  const handleSaveAndConnect = () => {
    saveAccount({
      name: `${host}:${port}`,  // auto-updated from server on auth_ok
      host,
      port: parseInt(port, 10),
      token,
      isLocal: host === 'localhost' || host === '127.0.0.1',
    });
  };

  const handleQuickConnect = (accountId: string) => {
    switchAccount(accountId);
  };

  const handleRemove = async (id: string, accName: string) => {
    const confirmed = await confirm({
      title: 'Remove Agent',
      message: `Remove "${accName}"?`,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;
    removeAccount(id);
  };

  // Navigate on successful connection (in useEffect to avoid setState during render)
  useEffect(() => {
    if (isConnected && agentName) {
      createSession();
      router.replace('/(tabs)/chat');
    }
  }, [isConnected, agentName]);

  const hasSaved = accounts.length > 0;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.inner}>

        {/* ── Saved accounts ── */}
        {hasSaved && (
          <>
            <Text style={styles.sectionTitle}>Your Agents</Text>
            <View style={styles.card}>
              {accounts.map((acc, i) => (
                <View
                  key={acc.id}
                  style={[styles.accountRow, i > 0 && styles.accountRowBorder]}
                >
                  <TouchableOpacity
                    style={styles.accountInfo}
                    onPress={() => handleQuickConnect(acc.id)}
                  >
                    <Text style={styles.accountName}>{acc.name}</Text>
                    <Text style={styles.accountHost}>{acc.host}:{acc.port}</Text>
                  </TouchableOpacity>
                  <PrimaryButton
                    style={styles.connectBtn}
                    contentStyle={styles.connectBtnInner}
                    onPress={() => handleQuickConnect(acc.id)}
                  >
                    <Text style={styles.connectBtnText}>Connect</Text>
                  </PrimaryButton>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => { void handleRemove(acc.id, acc.name); }}
                  >
                    <Text style={styles.deleteBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ── Add new ── */}
        <Text style={[styles.sectionTitle, hasSaved && { marginTop: 28 }]}>
          {hasSaved ? 'Add New Agent' : 'OpenAgent'}
        </Text>
        {!hasSaved && (
          <Text style={styles.subtitle}>Connect to an agent instance</Text>
        )}

        <View style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.label}>Host</Text>
            <TextInput
              style={styles.input}
              value={host}
              onChangeText={setHost}
              placeholder="localhost"
              placeholderTextColor={colors.textMuted}
            />
          </View>
          <View style={styles.fieldRow}>
            <View style={[styles.field, { flex: 1, marginRight: 8 }]}>
              <Text style={styles.label}>Port</Text>
              <TextInput
                style={styles.input}
                value={port}
                onChangeText={setPort}
                placeholder="8765"
                keyboardType="numeric"
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={[styles.field, { flex: 2 }]}>
              <Text style={styles.label}>Token</Text>
              <TextInput
                style={styles.input}
                value={token}
                onChangeText={setToken}
                placeholder="(optional)"
                secureTextEntry
                placeholderTextColor={colors.textMuted}
              />
            </View>
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <PrimaryButton style={styles.button} onPress={handleSaveAndConnect}>
            <Text style={styles.buttonText}>{hasSaved ? 'Save & Connect' : 'Connect'}</Text>
          </PrimaryButton>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  inner: {
    width: 400,
    maxWidth: '100%',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
  },

  // Saved accounts
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  accountRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  accountHost: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  connectBtn: {
    marginLeft: 8,
  },
  connectBtnInner: {
    minHeight: 32,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  connectBtnText: {
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: '700',
  },
  deleteBtn: {
    padding: 8,
    marginLeft: 4,
  },
  deleteBtnText: {
    color: colors.textMuted,
    fontSize: 12,
  },

  // Form
  field: { marginBottom: 12 },
  fieldRow: { flexDirection: 'row' },
  label: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
    fontWeight: '500',
  },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    color: colors.text,
    fontSize: 14,
  },
  error: {
    color: colors.error,
    fontSize: 13,
    marginBottom: 8,
    textAlign: 'center',
  },
  button: {
    padding: 13,
    marginTop: 4,
  },
  buttonText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '700',
  },
});

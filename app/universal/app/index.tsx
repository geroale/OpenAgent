/**
 * Login screen — saved accounts list + add new connection form.
 */

import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection } from '../stores/connection';
import { useChat } from '../stores/chat';

export default function LoginScreen() {
  const router = useRouter();
  const {
    accounts, isConnected, error, agentName, isLoading,
    saveAccount, switchAccount, removeAccount,
  } = useConnection();
  const createSession = useChat((s) => s.createSession);

  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('8765');
  const [token, setToken] = useState('');
  const [name, setName] = useState('');

  const handleSaveAndConnect = () => {
    const displayName = name.trim() || `${host}:${port}`;
    saveAccount({
      name: displayName,
      host,
      port: parseInt(port, 10),
      token,
      isLocal: host === 'localhost' || host === '127.0.0.1',
    });
  };

  const handleQuickConnect = (accountId: string) => {
    switchAccount(accountId);
  };

  const handleRemove = (id: string, accName: string) => {
    if (window.confirm(`Remove "${accName}"?`)) {
      removeAccount(id);
    }
  };

  // Navigate on successful connection
  if (isConnected && agentName) {
    createSession();
    router.replace('/(tabs)/chat');
    return null;
  }

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
                  <TouchableOpacity
                    style={styles.connectBtn}
                    onPress={() => handleQuickConnect(acc.id)}
                  >
                    <Text style={styles.connectBtnText}>Connect</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleRemove(acc.id, acc.name)}
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
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="My Agent (optional)"
              placeholderTextColor="#999"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Host</Text>
            <TextInput
              style={styles.input}
              value={host}
              onChangeText={setHost}
              placeholder="localhost"
              placeholderTextColor="#999"
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
                placeholderTextColor="#999"
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
                placeholderTextColor="#999"
              />
            </View>
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity style={styles.button} onPress={handleSaveAndConnect}>
            <Text style={styles.buttonText}>
              {hasSaved ? 'Save & Connect' : 'Connect'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#FAFAFA',
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
    color: '#1a1a1a',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
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
    borderTopColor: '#F0F0F0',
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  accountHost: {
    fontSize: 12,
    color: '#999',
    marginTop: 1,
  },
  connectBtn: {
    backgroundColor: '#D97757',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 8,
  },
  connectBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  deleteBtn: {
    padding: 8,
    marginLeft: 4,
  },
  deleteBtnText: {
    color: '#CCC',
    fontSize: 12,
  },

  // Form
  field: { marginBottom: 12 },
  fieldRow: { flexDirection: 'row' },
  label: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
    fontWeight: '500',
  },
  input: {
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    padding: 10,
    color: '#1a1a1a',
    fontSize: 14,
  },
  error: {
    color: '#D94F4F',
    fontSize: 13,
    marginBottom: 8,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#D97757',
    borderRadius: 8,
    padding: 13,
    marginTop: 4,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});

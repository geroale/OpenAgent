/**
 * Settings screen — connection info + disconnect / remove account.
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection } from '../../stores/connection';

export default function SettingsScreen() {
  const router = useRouter();
  const { agentName, agentVersion, config, activeAccountId, accounts, disconnect, removeAccount } = useConnection();
  const activeAccount = accounts.find((a) => a.id === activeAccountId);

  const handleDisconnect = () => {
    disconnect();
    router.replace('/');
  };

  const handleRemoveAccount = () => {
    if (!activeAccountId) return;
    const name = activeAccount?.name || 'this account';
    if (window.confirm(`Remove "${name}"? You can re-add it later.`)) {
      removeAccount(activeAccountId);
      router.replace('/');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Connection</Text>
        <View style={styles.card}>
          <Row label="Account" value={activeAccount?.name || '—'} />
          <Row label="Agent" value={agentName || '—'} />
          <Row label="Version" value={agentVersion || '—'} />
          <Row label="Host" value={config ? `${config.host}:${config.port}` : '—'} />
        </View>

        <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
          <Text style={styles.disconnectText}>Disconnect</Text>
        </TouchableOpacity>

        {activeAccountId && (
          <TouchableOpacity style={styles.removeBtn} onPress={handleRemoveAccount}>
            <Text style={styles.removeText}>Remove Account</Text>
          </TouchableOpacity>
        )}

        <Text style={[styles.sectionTitle, { marginTop: 32 }]}>Configuration</Text>
        <View style={styles.card}>
          <Text style={styles.comingSoon}>
            YAML editor, MCP management, system prompt editor, scheduler — coming soon.
          </Text>
        </View>
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },
  content: { padding: 24, maxWidth: 600 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EBEBEB',
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  rowLabel: { fontSize: 14, color: '#666' },
  rowValue: { fontSize: 14, color: '#1a1a1a', fontWeight: '500' },
  disconnectBtn: {
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    padding: 12,
    alignItems: 'center',
  },
  disconnectText: { color: '#666', fontSize: 14, fontWeight: '500' },
  removeBtn: {
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D94F4F',
    padding: 12,
    alignItems: 'center',
  },
  removeText: { color: '#D94F4F', fontSize: 14, fontWeight: '500' },
  comingSoon: { fontSize: 14, color: '#999', lineHeight: 20 },
});

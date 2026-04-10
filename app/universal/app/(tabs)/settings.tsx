/**
 * Settings screen — agent identity, dream mode, auto-update, connection.
 */

import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Switch, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection } from '../../stores/connection';
import { useConfig } from '../../stores/config';
import { setBaseUrl } from '../../services/api';

export default function SettingsScreen() {
  const router = useRouter();
  const { agentName, agentVersion, config: connConfig, activeAccountId, accounts, disconnect, removeAccount } = useConnection();
  const { config: agentConfig, loadConfig, updateSection } = useConfig();
  const activeAccount = accounts.find((a) => a.id === activeAccountId);

  // Local form state
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [dreamEnabled, setDreamEnabled] = useState(false);
  const [dreamTime, setDreamTime] = useState('3:00');
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
  const [autoUpdateMode, setAutoUpdateMode] = useState('auto');
  const [autoUpdateInterval, setAutoUpdateInterval] = useState('17 */6 * * *');
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (connConfig) {
      setBaseUrl(connConfig.host, connConfig.port);
      loadConfig();
    }
  }, [connConfig]);

  // Populate from loaded config
  useEffect(() => {
    if (!agentConfig) return;
    setName(agentConfig.name || '');
    setSystemPrompt(agentConfig.system_prompt || '');
    setDreamEnabled(agentConfig.dream_mode?.enabled ?? false);
    setDreamTime(agentConfig.dream_mode?.time || '3:00');
    setAutoUpdateEnabled(agentConfig.auto_update?.enabled ?? false);
    setAutoUpdateMode(agentConfig.auto_update?.mode || 'auto');
    setAutoUpdateInterval(agentConfig.auto_update?.check_interval || '17 */6 * * *');
  }, [agentConfig]);

  const saveSection = async (section: string, data: any, label: string) => {
    const ok = await updateSection(section, data);
    if (ok) {
      setSaved(label);
      setTimeout(() => setSaved(null), 3000);
    }
  };

  const handleDisconnect = () => { disconnect(); router.replace('/'); };
  const handleRemove = () => {
    if (!activeAccountId) return;
    if (window.confirm(`Remove "${activeAccount?.name}"?`)) {
      removeAccount(activeAccountId);
      router.replace('/');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Agent Identity */}
      <Text style={styles.sectionTitle}>Agent Identity</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="my-agent"
          placeholderTextColor="#999"
        />
        <Text style={[styles.label, { marginTop: 12 }]}>System Prompt</Text>
        {Platform.OS === 'web' ? (
          <textarea
            value={systemPrompt}
            onChange={(e: any) => setSystemPrompt(e.target.value)}
            rows={6}
            style={{
              backgroundColor: '#F5F5F5', borderRadius: 8, border: '1px solid #E8E8E8',
              padding: 10, color: '#1a1a1a', fontSize: 13, fontFamily: 'monospace',
              resize: 'vertical', outline: 'none', width: '100%', boxSizing: 'border-box',
            } as any}
          />
        ) : (
          <TextInput
            style={[styles.input, { height: 120, textAlignVertical: 'top' }]}
            value={systemPrompt}
            onChangeText={setSystemPrompt}
            multiline
          />
        )}
        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => saveSection('name', name, 'identity').then(() =>
            saveSection('system_prompt', systemPrompt, 'identity')
          )}
        >
          <Text style={styles.saveBtnText}>
            {saved === 'identity' ? '✓ Saved' : 'Save Identity'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Dream Mode */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Dream Mode</Text>
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Enabled</Text>
          <Switch
            value={dreamEnabled}
            onValueChange={setDreamEnabled}
            trackColor={{ false: '#DDD', true: '#D97757' }}
            thumbColor="#FFF"
          />
        </View>
        <Text style={styles.label}>Time (HH:MM)</Text>
        <TextInput
          style={styles.input}
          value={dreamTime}
          onChangeText={setDreamTime}
          placeholder="3:00"
          placeholderTextColor="#999"
        />
        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => saveSection('dream_mode', { enabled: dreamEnabled, time: dreamTime }, 'dream')}
        >
          <Text style={styles.saveBtnText}>
            {saved === 'dream' ? '✓ Saved' : 'Save Dream Mode'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Auto-Update */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Auto-Update</Text>
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Enabled</Text>
          <Switch
            value={autoUpdateEnabled}
            onValueChange={setAutoUpdateEnabled}
            trackColor={{ false: '#DDD', true: '#D97757' }}
            thumbColor="#FFF"
          />
        </View>
        <Text style={styles.label}>Mode</Text>
        <View style={styles.segmented}>
          {['auto', 'notify', 'manual'].map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.segment, autoUpdateMode === m && styles.segmentActive]}
              onPress={() => setAutoUpdateMode(m)}
            >
              <Text style={[styles.segmentText, autoUpdateMode === m && styles.segmentTextActive]}>{m}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={[styles.label, { marginTop: 12 }]}>Check Interval (cron)</Text>
        <TextInput
          style={styles.input}
          value={autoUpdateInterval}
          onChangeText={setAutoUpdateInterval}
          placeholder="17 */6 * * *"
          placeholderTextColor="#999"
        />
        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => saveSection('auto_update', {
            enabled: autoUpdateEnabled, mode: autoUpdateMode, check_interval: autoUpdateInterval,
          }, 'auto_update')}
        >
          <Text style={styles.saveBtnText}>
            {saved === 'auto_update' ? '✓ Saved' : 'Save Auto-Update'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Connection */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Connection</Text>
      <View style={styles.card}>
        <Row label="Account" value={activeAccount?.name || '—'} />
        <Row label="Agent" value={agentName || '—'} />
        <Row label="Version" value={agentVersion || '—'} />
        <Row label="Host" value={connConfig ? `${connConfig.host}:${connConfig.port}` : '—'} />
      </View>

      <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
        <Text style={styles.disconnectText}>Disconnect</Text>
      </TouchableOpacity>
      {activeAccountId && (
        <TouchableOpacity style={styles.removeBtn} onPress={handleRemove}>
          <Text style={styles.removeText}>Remove Account</Text>
        </TouchableOpacity>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
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
  content: { padding: 24, maxWidth: 500, width: "100%", alignSelf: "center" },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  card: { backgroundColor: '#FFF', borderRadius: 10, borderWidth: 1, borderColor: '#EBEBEB', padding: 16 },
  label: { fontSize: 12, fontWeight: '600', color: '#666', marginBottom: 4 },
  input: {
    backgroundColor: '#F5F5F5', borderRadius: 8, borderWidth: 1, borderColor: '#E8E8E8',
    padding: 10, color: '#1a1a1a', fontSize: 14,
  },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  toggleLabel: { fontSize: 14, color: '#1a1a1a' },
  segmented: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#E8E8E8' },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: '#F5F5F5' },
  segmentActive: { backgroundColor: '#D97757' },
  segmentText: { fontSize: 12, color: '#666', fontWeight: '500' },
  segmentTextActive: { color: '#FFF' },
  saveBtn: { backgroundColor: '#D97757', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 16 },
  saveBtnText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  rowLabel: { fontSize: 14, color: '#666' },
  rowValue: { fontSize: 14, color: '#1a1a1a', fontWeight: '500' },
  disconnectBtn: { marginTop: 16, backgroundColor: '#FFF', borderRadius: 8, borderWidth: 1, borderColor: '#E0E0E0', padding: 12, alignItems: 'center' },
  disconnectText: { color: '#666', fontSize: 14, fontWeight: '500' },
  removeBtn: { marginTop: 8, backgroundColor: '#FFF', borderRadius: 8, borderWidth: 1, borderColor: '#D94F4F', padding: 12, alignItems: 'center' },
  removeText: { color: '#D94F4F', fontSize: 14, fontWeight: '500' },
});

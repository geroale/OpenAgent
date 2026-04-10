import { colors } from '../../theme';
/**
 * Settings screen — agent identity, channels, dream mode, auto-update, connection.
 */

import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection } from '../../stores/connection';
import { useConfig } from '../../stores/config';
import { setBaseUrl } from '../../services/api';
import { useConfirm } from '../../components/ConfirmDialog';
import PrimaryButton from '../../components/PrimaryButton';
import ThemedSwitch from '../../components/ThemedSwitch';

export default function SettingsScreen() {
  const router = useRouter();
  const { agentName, agentVersion, config: connConfig, activeAccountId, accounts, disconnect, removeAccount } = useConnection();
  const { config: agentConfig, loadConfig, updateSection } = useConfig();
  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const confirm = useConfirm();

  // Local form state
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [dreamEnabled, setDreamEnabled] = useState(false);
  const [dreamTime, setDreamTime] = useState('3:00');
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
  const [autoUpdateMode, setAutoUpdateMode] = useState('auto');
  const [autoUpdateInterval, setAutoUpdateInterval] = useState('17 */6 * * *');

  // Channel state
  const [tgToken, setTgToken] = useState('');
  const [tgUsers, setTgUsers] = useState('');
  const [dcToken, setDcToken] = useState('');
  const [dcUsers, setDcUsers] = useState('');
  const [waId, setWaId] = useState('');
  const [waToken, setWaToken] = useState('');
  const [waUsers, setWaUsers] = useState('');

  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (connConfig) {
      setBaseUrl(connConfig.host, connConfig.port);
      loadConfig();
    }
  }, [connConfig]);

  useEffect(() => {
    if (!agentConfig) return;
    setName(agentConfig.name || '');
    setSystemPrompt(agentConfig.system_prompt || '');
    setDreamEnabled(agentConfig.dream_mode?.enabled ?? false);
    setDreamTime(agentConfig.dream_mode?.time || '3:00');
    setAutoUpdateEnabled(agentConfig.auto_update?.enabled ?? false);
    setAutoUpdateMode(agentConfig.auto_update?.mode || 'auto');
    setAutoUpdateInterval(agentConfig.auto_update?.check_interval || '17 */6 * * *');

    // Channels
    const ch = agentConfig.channels || {};
    const tg = ch.telegram || {};
    setTgToken(tg.token || '');
    setTgUsers((tg.allowed_users || []).join(', '));
    const dc = ch.discord || {};
    setDcToken(dc.token || '');
    setDcUsers((dc.allowed_users || []).join(', '));
    const wa = ch.whatsapp || {};
    setWaId(wa.green_api_id || '');
    setWaToken(wa.green_api_token || '');
    setWaUsers((wa.allowed_users || []).join(', '));
  }, [agentConfig]);

  const saveSection = async (section: string, data: any, label: string) => {
    const ok = await updateSection(section, data);
    if (ok) {
      setSaved(label);
      setTimeout(() => setSaved(null), 3000);
    }
  };

  const saveChannels = async () => {
    const channels: any = { ...(agentConfig?.channels || {}) };

    // Telegram
    if (tgToken.trim()) {
      channels.telegram = {
        token: tgToken.trim(),
        allowed_users: tgUsers.split(',').map((s: string) => s.trim()).filter(Boolean),
      };
    } else {
      delete channels.telegram;
    }

    // Discord
    if (dcToken.trim()) {
      channels.discord = {
        token: dcToken.trim(),
        allowed_users: dcUsers.split(',').map((s: string) => s.trim()).filter(Boolean),
      };
    } else {
      delete channels.discord;
    }

    // WhatsApp
    if (waId.trim() && waToken.trim()) {
      channels.whatsapp = {
        green_api_id: waId.trim(),
        green_api_token: waToken.trim(),
        allowed_users: waUsers.split(',').map((s: string) => s.trim()).filter(Boolean),
      };
    } else {
      delete channels.whatsapp;
    }

    // Keep websocket config untouched
    await saveSection('channels', channels, 'channels');
  };

  const handleDisconnect = () => { disconnect(); router.replace('/'); };
  const handleRemove = async () => {
    if (!activeAccountId) return;
    const confirmed = await confirm({
      title: 'Remove Account',
      message: `Remove "${activeAccount?.name}"?`,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;
    removeAccount(activeAccountId);
    router.replace('/');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Agent Identity */}
      <Text style={styles.sectionTitle}>Agent Identity</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="my-agent" placeholderTextColor={colors.textMuted} />
        <Text style={[styles.label, { marginTop: 12 }]}>System Prompt</Text>
        {Platform.OS === 'web' ? (
          <textarea
            value={systemPrompt}
            onChange={(e: any) => setSystemPrompt(e.target.value)}
            rows={6}
            style={{
              backgroundColor: colors.inputBg, borderRadius: 8, border: `1px solid ${colors.border}`,
              padding: 10, color: colors.text, fontSize: 13, fontFamily: 'monospace',
              resize: 'vertical', outline: 'none', width: '100%', boxSizing: 'border-box',
            } as any}
          />
        ) : (
          <TextInput style={[styles.input, { height: 120, textAlignVertical: 'top' }]} value={systemPrompt} onChangeText={setSystemPrompt} multiline />
        )}
        <SaveBtn label="Save Identity" saved={saved === 'identity'} onPress={() => saveSection('name', name, 'identity').then(() => saveSection('system_prompt', systemPrompt, 'identity'))} />
      </View>

      {/* Channels */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Channels</Text>
      <View style={styles.card}>
        {/* Telegram */}
        <Text style={styles.channelTitle}>Telegram</Text>
        <Text style={styles.label}>Bot Token</Text>
        <TextInput style={styles.input} value={tgToken} onChangeText={setTgToken} placeholder="${TELEGRAM_BOT_TOKEN}" placeholderTextColor={colors.textMuted} secureTextEntry />
        <Text style={[styles.label, { marginTop: 8 }]}>Allowed User IDs (comma-separated)</Text>
        <TextInput style={styles.input} value={tgUsers} onChangeText={setTgUsers} placeholder="123456789, 987654321" placeholderTextColor={colors.textMuted} />

        <View style={styles.channelDivider} />

        {/* Discord */}
        <Text style={styles.channelTitle}>Discord</Text>
        <Text style={styles.label}>Bot Token</Text>
        <TextInput style={styles.input} value={dcToken} onChangeText={setDcToken} placeholder="${DISCORD_BOT_TOKEN}" placeholderTextColor={colors.textMuted} secureTextEntry />
        <Text style={[styles.label, { marginTop: 8 }]}>Allowed User IDs (comma-separated)</Text>
        <TextInput style={styles.input} value={dcUsers} onChangeText={setDcUsers} placeholder="123456789012345678" placeholderTextColor={colors.textMuted} />

        <View style={styles.channelDivider} />

        {/* WhatsApp */}
        <Text style={styles.channelTitle}>WhatsApp (Green API)</Text>
        <Text style={styles.label}>Instance ID</Text>
        <TextInput style={styles.input} value={waId} onChangeText={setWaId} placeholder="${GREEN_API_ID}" placeholderTextColor={colors.textMuted} />
        <Text style={[styles.label, { marginTop: 8 }]}>API Token</Text>
        <TextInput style={styles.input} value={waToken} onChangeText={setWaToken} placeholder="${GREEN_API_TOKEN}" placeholderTextColor={colors.textMuted} secureTextEntry />
        <Text style={[styles.label, { marginTop: 8 }]}>Allowed Users (comma-separated)</Text>
        <TextInput style={styles.input} value={waUsers} onChangeText={setWaUsers} placeholder="391234567890" placeholderTextColor={colors.textMuted} />

        <SaveBtn label="Save Channels" saved={saved === 'channels'} onPress={saveChannels} />
        <Text style={styles.restartHint}>Restart required after changes</Text>
      </View>

      {/* Dream Mode */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Dream Mode</Text>
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Enabled</Text>
          <ThemedSwitch value={dreamEnabled} onValueChange={setDreamEnabled} />
        </View>
        <Text style={styles.label}>Time (HH:MM)</Text>
        <TextInput style={styles.input} value={dreamTime} onChangeText={setDreamTime} placeholder="3:00" placeholderTextColor={colors.textMuted} />
        <SaveBtn label="Save Dream Mode" saved={saved === 'dream'} onPress={() => saveSection('dream_mode', { enabled: dreamEnabled, time: dreamTime }, 'dream')} />
      </View>

      {/* Auto-Update */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Auto-Update</Text>
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Enabled</Text>
          <ThemedSwitch value={autoUpdateEnabled} onValueChange={setAutoUpdateEnabled} />
        </View>
        <Text style={styles.label}>Mode</Text>
        <View style={styles.segmented}>
          {['auto', 'notify', 'manual'].map((m) => (
            <TouchableOpacity key={m} style={[styles.segment, autoUpdateMode === m && styles.segmentActive]} onPress={() => setAutoUpdateMode(m)}>
              <Text style={[styles.segmentText, autoUpdateMode === m && styles.segmentTextActive]}>{m}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={[styles.label, { marginTop: 12 }]}>Check Interval (cron)</Text>
        <TextInput style={styles.input} value={autoUpdateInterval} onChangeText={setAutoUpdateInterval} placeholder="17 */6 * * *" placeholderTextColor={colors.textMuted} />
        <SaveBtn label="Save Auto-Update" saved={saved === 'auto_update'} onPress={() => saveSection('auto_update', { enabled: autoUpdateEnabled, mode: autoUpdateMode, check_interval: autoUpdateInterval }, 'auto_update')} />
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
        <TouchableOpacity style={styles.removeBtn} onPress={() => { void handleRemove(); }}>
          <Text style={styles.removeText}>Remove Account</Text>
        </TouchableOpacity>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function SaveBtn({ label, saved, onPress }: { label: string; saved: boolean; onPress: () => void }) {
  return (
    <PrimaryButton style={styles.saveBtn} onPress={onPress}>
      <Text style={styles.saveBtnText}>{saved ? '✓ Saved' : label}</Text>
    </PrimaryButton>
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
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, maxWidth: 500, width: "100%", alignSelf: "center" },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 16 },
  label: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 4 },
  input: {
    backgroundColor: colors.inputBg, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    padding: 10, color: colors.text, fontSize: 14,
  },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  toggleLabel: { fontSize: 14, color: colors.text },
  segmented: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: colors.inputBg },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  segmentTextActive: { color: colors.textInverse },
  saveBtn: { marginTop: 16 },
  saveBtnText: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  rowLabel: { fontSize: 14, color: colors.textSecondary },
  rowValue: { fontSize: 14, color: colors.text, fontWeight: '500' },
  disconnectBtn: { marginTop: 16, backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 12, alignItems: 'center' },
  disconnectText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
  removeBtn: { marginTop: 8, backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.error, padding: 12, alignItems: 'center' },
  removeText: { color: colors.error, fontSize: 14, fontWeight: '500' },
  channelTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 8, marginTop: 4 },
  channelDivider: { height: 1, backgroundColor: colors.borderLight, marginVertical: 16 },
  restartHint: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 8 },
});

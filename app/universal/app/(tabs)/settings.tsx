import { colors, font, radius } from '../../theme';
/**
 * Settings screen — agent identity, channels, dream mode, auto-update, connection.
 * Uses a responsive sidebar to group settings into categories (fixed on desktop,
 * drawer on mobile), matching the pattern used on chat/memory.
 */

import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection } from '../../stores/connection';
import { useConfig } from '../../stores/config';
import { useThemeStore } from '../../stores/theme';
import { setBaseUrl, triggerUpdate, triggerRestart } from '../../services/api';
import { useConfirm } from '../../components/ConfirmDialog';
import Button from '../../components/Button';
import Card from '../../components/Card';
import CategorySidebar from '../../components/CategorySidebar';
import TabStrip from '../../components/TabStrip';
import ResponsiveSidebar from '../../components/ResponsiveSidebar';
import ThemedSwitch from '../../components/ThemedSwitch';

type CategoryId =
  | 'identity'
  | 'appearance'
  | 'channels'
  | 'dream'
  | 'auto_update'
  | 'controls'
  | 'connection';

interface Category {
  id: CategoryId;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  description: string;
}

const CATEGORIES: Category[] = [
  { id: 'identity', label: 'Agent Identity', icon: 'user', description: 'Name and system prompt' },
  { id: 'appearance', label: 'Appearance', icon: 'sun', description: 'Light and dark theme' },
  { id: 'channels', label: 'Channels', icon: 'message-square', description: 'Gateway, Telegram, Discord, WhatsApp' },
  { id: 'dream', label: 'Dream Mode', icon: 'moon', description: 'Nightly reflection' },
  { id: 'auto_update', label: 'Auto-Update', icon: 'refresh-cw', description: 'Release check cadence' },
  { id: 'controls', label: 'Controls', icon: 'sliders', description: 'Update and restart' },
  { id: 'connection', label: 'Connection', icon: 'link', description: 'Account and host' },
];

type ChannelTab = 'gateway' | 'telegram' | 'discord' | 'whatsapp';

interface ChannelTabSpec {
  id: ChannelTab;
  label: string;
  icon: keyof typeof Feather.glyphMap;
}

const CHANNEL_TABS: ChannelTabSpec[] = [
  { id: 'gateway', label: 'Gateway', icon: 'wifi' },
  { id: 'telegram', label: 'Telegram', icon: 'send' },
  { id: 'discord', label: 'Discord', icon: 'message-square' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'phone' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { agentName, agentVersion, config: connConfig, activeAccountId, accounts, disconnect, removeAccount } = useConnection();
  const { config: agentConfig, loadConfig, updateSection } = useConfig();
  const themeMode = useThemeStore((s) => s.mode);
  const setThemeMode = useThemeStore((s) => s.setMode);
  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const confirm = useConfirm();

  // Active category (drives what's rendered in the main area)
  const [activeCategory, setActiveCategory] = useState<CategoryId>('identity');
  // Active sub-tab inside the Channels screen
  const [activeChannelTab, setActiveChannelTab] = useState<ChannelTab>('gateway');

  // Local form state
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [dreamEnabled, setDreamEnabled] = useState(false);
  const [dreamTime, setDreamTime] = useState('3:00');
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
  const [autoUpdateMode, setAutoUpdateMode] = useState('auto');
  const [autoUpdateInterval, setAutoUpdateInterval] = useState('17 */6 * * *');

  // Gateway (app/CLI websocket) state
  const [gwHost, setGwHost] = useState('0.0.0.0');
  const [gwPort, setGwPort] = useState('8765');
  const [gwToken, setGwToken] = useState('');

  // Channel state
  const [tgToken, setTgToken] = useState('');
  const [tgUsers, setTgUsers] = useState('');
  const [tgModel, setTgModel] = useState('');
  const [dcToken, setDcToken] = useState('');
  const [dcUsers, setDcUsers] = useState('');
  const [dcModel, setDcModel] = useState('');
  const [waId, setWaId] = useState('');
  const [waToken, setWaToken] = useState('');
  const [waUsers, setWaUsers] = useState('');
  const [waModel, setWaModel] = useState('');

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
    const ws = ch.websocket || {};
    setGwHost(ws.host || '0.0.0.0');
    setGwPort(ws.port != null ? String(ws.port) : '8765');
    setGwToken(ws.token || '');
    const tg = ch.telegram || {};
    setTgToken(tg.token || '');
    setTgUsers((tg.allowed_users || []).join(', '));
    setTgModel(tg.model || '');
    const dc = ch.discord || {};
    setDcToken(dc.token || '');
    setDcUsers((dc.allowed_users || []).join(', '));
    setDcModel(dc.model || '');
    const wa = ch.whatsapp || {};
    setWaId(wa.green_api_id || '');
    setWaToken(wa.green_api_token || '');
    setWaUsers((wa.allowed_users || []).join(', '));
    setWaModel(wa.model || '');
  }, [agentConfig]);

  const saveSection = async (section: string, data: any, label: string) => {
    const ok = await updateSection(section, data);
    if (ok) {
      setSaved(label);
      setTimeout(() => setSaved(null), 3000);
    }
  };

  // Each channel save reads the full channels block from the last-loaded server
  // config and only mutates its own key — unsaved edits to other panels are NOT
  // committed. The form state for other channels is only flushed when that
  // specific panel's Save button is pressed.

  const saveGateway = async () => {
    const channels: any = { ...(agentConfig?.channels || {}) };
    const port = parseInt(gwPort, 10);
    const ws: any = {
      host: gwHost.trim() || '0.0.0.0',
      port: Number.isFinite(port) && port > 0 ? port : 8765,
    };
    if (gwToken.trim()) ws.token = gwToken.trim();
    channels.websocket = ws;
    await saveSection('channels', channels, 'gateway');
  };

  const saveTelegram = async () => {
    const channels: any = { ...(agentConfig?.channels || {}) };
    if (tgToken.trim()) {
      channels.telegram = {
        token: tgToken.trim(),
        allowed_users: tgUsers.split(',').map((s: string) => s.trim()).filter(Boolean),
        ...(tgModel.trim() ? { model: tgModel.trim() } : {}),
      };
    } else {
      delete channels.telegram;
    }
    await saveSection('channels', channels, 'telegram');
  };

  const saveDiscord = async () => {
    const channels: any = { ...(agentConfig?.channels || {}) };
    if (dcToken.trim()) {
      channels.discord = {
        token: dcToken.trim(),
        allowed_users: dcUsers.split(',').map((s: string) => s.trim()).filter(Boolean),
        ...(dcModel.trim() ? { model: dcModel.trim() } : {}),
      };
    } else {
      delete channels.discord;
    }
    await saveSection('channels', channels, 'discord');
  };

  const saveWhatsapp = async () => {
    const channels: any = { ...(agentConfig?.channels || {}) };
    if (waId.trim() && waToken.trim()) {
      channels.whatsapp = {
        green_api_id: waId.trim(),
        green_api_token: waToken.trim(),
        allowed_users: waUsers.split(',').map((s: string) => s.trim()).filter(Boolean),
        ...(waModel.trim() ? { model: waModel.trim() } : {}),
      };
    } else {
      delete channels.whatsapp;
    }
    await saveSection('channels', channels, 'whatsapp');
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

  // ── Sidebar ──

  const sidebarContent = (
    <CategorySidebar<CategoryId>
      title="Settings"
      active={activeCategory}
      onChange={setActiveCategory}
      categories={CATEGORIES}
    />
  );

  // ── Main content per category ──

  const renderIdentity = () => (
    <>
      <Text style={styles.sectionTitle}>Agent Identity</Text>
      <Card>
        <Text style={styles.label}>Name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="my-agent" placeholderTextColor={colors.textMuted} />
        <Text style={[styles.label, { marginTop: 12 }]}>System Prompt</Text>
        {Platform.OS === 'web' ? (
          <textarea
            value={systemPrompt}
            onChange={(e: any) => setSystemPrompt(e.target.value)}
            rows={6}
            style={{
              backgroundColor: colors.inputBg, borderRadius: radius.md, border: `1px solid ${colors.border}`,
              padding: 10, color: colors.text, fontSize: 13, fontFamily: font.mono,
              resize: 'vertical', outline: 'none', width: '100%', boxSizing: 'border-box',
            } as any}
          />
        ) : (
          <TextInput style={[styles.input, { height: 120, textAlignVertical: 'top' }]} value={systemPrompt} onChangeText={setSystemPrompt} multiline />
        )}
        <SaveBtn
          label="Save Identity"
          saved={saved === 'identity'}
          onPress={() => saveSection('name', name, 'identity').then(() => saveSection('system_prompt', systemPrompt, 'identity'))}
        />
      </Card>
    </>
  );

  const renderAppearance = () => (
    <>
      <Text style={styles.sectionTitle}>Appearance</Text>
      <Card>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.toggleLabel}>Dark mode</Text>
            <Text style={styles.channelHint}>
              Use a dark color scheme across the app. The window reloads when the
              theme changes so all styles pick up the new palette.
            </Text>
          </View>
          <ThemedSwitch
            value={themeMode === 'dark'}
            onValueChange={(v) => setThemeMode(v ? 'dark' : 'light')}
          />
        </View>
      </Card>
    </>
  );

  // Each sub-panel is shown in isolation under the Channels screen; the
  // sub-tab strip switches between Gateway/Telegram/Discord/WhatsApp.

  const renderGatewayPanel = () => (
    <Card>
      <Text style={styles.channelSubtitle}>
        Websocket endpoint used by the OpenAgent app and CLI to talk to this agent.
      </Text>

      <Text style={[styles.label, { marginTop: 8 }]}>Host</Text>
      <TextInput style={styles.input} value={gwHost} onChangeText={setGwHost} placeholder="0.0.0.0" placeholderTextColor={colors.textMuted} autoCapitalize="none" />
      <Text style={[styles.label, { marginTop: 8 }]}>Port</Text>
      <TextInput style={styles.input} value={gwPort} onChangeText={setGwPort} placeholder="8765" placeholderTextColor={colors.textMuted} keyboardType="numeric" />
      <Text style={[styles.label, { marginTop: 8 }]}>Auth Token</Text>
      <TextInput style={styles.input} value={gwToken} onChangeText={setGwToken} placeholder="${OPENAGENT_WS_TOKEN}" placeholderTextColor={colors.textMuted} secureTextEntry />
      <Text style={styles.channelHint}>
        Leave blank to use the OPENAGENT_WS_TOKEN environment variable. The token must match the one saved in the client's
        account entry.
      </Text>

      <SaveBtn label="Save Gateway" saved={saved === 'gateway'} onPress={saveGateway} />
      <Text style={styles.restartHint}>Restart required after changes</Text>
    </Card>
  );

  const renderTelegramPanel = () => (
    <Card>
      <Text style={styles.label}>Bot Token</Text>
      <TextInput style={styles.input} value={tgToken} onChangeText={setTgToken} placeholder="${TELEGRAM_BOT_TOKEN}" placeholderTextColor={colors.textMuted} secureTextEntry />
      <Text style={[styles.label, { marginTop: 8 }]}>Allowed User IDs (comma-separated)</Text>
      <TextInput style={styles.input} value={tgUsers} onChangeText={setTgUsers} placeholder="123456789, 987654321" placeholderTextColor={colors.textMuted} />
      <Text style={[styles.label, { marginTop: 8 }]}>Model Override (optional)</Text>
      <TextInput style={styles.input} value={tgModel} onChangeText={setTgModel} placeholder="Default (global model)" placeholderTextColor={colors.textMuted} />
      <Text style={styles.channelHint}>Clear the bot token to disable this channel.</Text>

      <SaveBtn label="Save Telegram" saved={saved === 'telegram'} onPress={saveTelegram} />
      <Text style={styles.restartHint}>Restart required after changes</Text>
    </Card>
  );

  const renderDiscordPanel = () => (
    <Card>
      <Text style={styles.label}>Bot Token</Text>
      <TextInput style={styles.input} value={dcToken} onChangeText={setDcToken} placeholder="${DISCORD_BOT_TOKEN}" placeholderTextColor={colors.textMuted} secureTextEntry />
      <Text style={[styles.label, { marginTop: 8 }]}>Allowed User IDs (comma-separated)</Text>
      <TextInput style={styles.input} value={dcUsers} onChangeText={setDcUsers} placeholder="123456789012345678" placeholderTextColor={colors.textMuted} />
      <Text style={[styles.label, { marginTop: 8 }]}>Model Override (optional)</Text>
      <TextInput style={styles.input} value={dcModel} onChangeText={setDcModel} placeholder="Default (global model)" placeholderTextColor={colors.textMuted} />
      <Text style={styles.channelHint}>Clear the bot token to disable this channel.</Text>

      <SaveBtn label="Save Discord" saved={saved === 'discord'} onPress={saveDiscord} />
      <Text style={styles.restartHint}>Restart required after changes</Text>
    </Card>
  );

  const renderWhatsappPanel = () => (
    <Card>
      <Text style={styles.label}>Instance ID</Text>
      <TextInput style={styles.input} value={waId} onChangeText={setWaId} placeholder="${GREEN_API_ID}" placeholderTextColor={colors.textMuted} />
      <Text style={[styles.label, { marginTop: 8 }]}>API Token</Text>
      <TextInput style={styles.input} value={waToken} onChangeText={setWaToken} placeholder="${GREEN_API_TOKEN}" placeholderTextColor={colors.textMuted} secureTextEntry />
      <Text style={[styles.label, { marginTop: 8 }]}>Allowed Users (comma-separated)</Text>
      <TextInput style={styles.input} value={waUsers} onChangeText={setWaUsers} placeholder="391234567890" placeholderTextColor={colors.textMuted} />
      <Text style={[styles.label, { marginTop: 8 }]}>Model Override (optional)</Text>
      <TextInput style={styles.input} value={waModel} onChangeText={setWaModel} placeholder="Default (global model)" placeholderTextColor={colors.textMuted} />
      <Text style={styles.channelHint}>Clear the Instance ID or Token to disable this channel.</Text>

      <SaveBtn label="Save WhatsApp" saved={saved === 'whatsapp'} onPress={saveWhatsapp} />
      <Text style={styles.restartHint}>Restart required after changes</Text>
    </Card>
  );

  const renderChannels = () => (
    <>
      <Text style={styles.sectionTitle}>Channels</Text>

      <TabStrip
        tabs={CHANNEL_TABS}
        active={activeChannelTab}
        onChange={setActiveChannelTab}
        fullWidth
        style={{ marginBottom: 12 }}
      />

      {activeChannelTab === 'gateway' && renderGatewayPanel()}
      {activeChannelTab === 'telegram' && renderTelegramPanel()}
      {activeChannelTab === 'discord' && renderDiscordPanel()}
      {activeChannelTab === 'whatsapp' && renderWhatsappPanel()}
    </>
  );

  const renderDream = () => (
    <>
      <Text style={styles.sectionTitle}>Dream Mode</Text>
      <Card>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Enabled</Text>
          <ThemedSwitch value={dreamEnabled} onValueChange={setDreamEnabled} />
        </View>
        <Text style={styles.label}>Time (HH:MM)</Text>
        <TextInput style={styles.input} value={dreamTime} onChangeText={setDreamTime} placeholder="3:00" placeholderTextColor={colors.textMuted} />
        <SaveBtn
          label="Save Dream Mode"
          saved={saved === 'dream'}
          onPress={() => saveSection('dream_mode', { enabled: dreamEnabled, time: dreamTime }, 'dream')}
        />
      </Card>
    </>
  );

  const renderAutoUpdate = () => (
    <>
      <Text style={styles.sectionTitle}>Auto-Update</Text>
      <Card>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Enabled</Text>
          <ThemedSwitch value={autoUpdateEnabled} onValueChange={setAutoUpdateEnabled} />
        </View>
        <Text style={styles.label}>Mode</Text>
        <TabStrip
          tabs={[
            { id: 'auto', label: 'Auto' },
            { id: 'notify', label: 'Notify' },
            { id: 'manual', label: 'Manual' },
          ]}
          active={autoUpdateMode}
          onChange={(v) => setAutoUpdateMode(v)}
          fullWidth
          size="sm"
        />
        <Text style={[styles.label, { marginTop: 12 }]}>Check Interval (cron)</Text>
        <TextInput style={styles.input} value={autoUpdateInterval} onChangeText={setAutoUpdateInterval} placeholder="17 */6 * * *" placeholderTextColor={colors.textMuted} />
        <SaveBtn
          label="Save Auto-Update"
          saved={saved === 'auto_update'}
          onPress={() => saveSection('auto_update', { enabled: autoUpdateEnabled, mode: autoUpdateMode, check_interval: autoUpdateInterval }, 'auto_update')}
        />
      </Card>
    </>
  );

  const renderControls = () => (
    <>
      <Text style={styles.sectionTitle}>Controls</Text>
      <Card>
        <Button
          variant="primary"
          label="Check for Updates"
          fullWidth
          style={{ marginBottom: 8 }}
          onPress={async () => {
            try {
              const res = await triggerUpdate();
              if (res.updated) {
                setSaved('update');
                setTimeout(() => setSaved(null), 5000);
                alert(`Updated: v${res.old} → v${res.new}. Restarting...`);
              } else {
                alert(`Already up-to-date (v${res.version}).`);
              }
            } catch (e: any) { alert(`Update failed: ${e.message}`); }
          }}
        />
        <Button
          variant="secondary"
          label="Restart Agent"
          fullWidth
          onPress={async () => {
            const confirmed = await confirm({
              title: 'Restart Agent',
              message: 'This will restart the OpenAgent server. You may need to reconnect.',
              confirmLabel: 'Restart',
            });
            if (!confirmed) return;
            try {
              await triggerRestart();
            } catch { /* connection will drop */ }
          }}
        />
      </Card>
    </>
  );

  const renderConnection = () => (
    <>
      <Text style={styles.sectionTitle}>Connection</Text>
      <Card>
        <Row label="Account" value={activeAccount?.name || '—'} />
        <Row label="Agent" value={agentName || '—'} />
        <Row label="Version" value={agentVersion || '—'} />
        <Row label="Host" value={connConfig ? `${connConfig.host}:${connConfig.port}` : '—'} />
      </Card>

      <Button
        variant="secondary"
        label="Disconnect"
        fullWidth
        onPress={handleDisconnect}
        style={{ marginTop: 14 }}
      />
      {activeAccountId && (
        <Button
          variant="danger"
          label="Remove Account"
          fullWidth
          onPress={() => { void handleRemove(); }}
          style={{ marginTop: 8 }}
        />
      )}
    </>
  );

  const renderCategory = () => {
    switch (activeCategory) {
      case 'identity': return renderIdentity();
      case 'appearance': return renderAppearance();
      case 'channels': return renderChannels();
      case 'dream': return renderDream();
      case 'auto_update': return renderAutoUpdate();
      case 'controls': return renderControls();
      case 'connection': return renderConnection();
    }
  };

  return (
    <ResponsiveSidebar sidebar={sidebarContent}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {renderCategory()}
        <View style={{ height: 40 }} />
      </ScrollView>
    </ResponsiveSidebar>
  );
}

function SaveBtn({ label, saved, onPress }: { label: string; saved: boolean; onPress: () => void }) {
  return (
    <Button
      variant="primary"
      label={saved ? 'Saved' : label}
      icon={saved ? 'check' : undefined}
      onPress={onPress}
      style={styles.saveBtn}
      fullWidth
    />
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
  // Main content
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, maxWidth: 560, width: '100%', alignSelf: 'center' },
  sectionTitle: {
    fontSize: 18, fontWeight: '500', color: colors.text,
    marginBottom: 14, fontFamily: font.display, letterSpacing: -0.3,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: 16,
  },
  label: {
    fontSize: 10, fontWeight: '600', color: colors.textSecondary,
    marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.inputBg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 11, paddingVertical: 9,
    color: colors.text, fontSize: 13, fontFamily: font.mono,
  },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  toggleLabel: { fontSize: 13, color: colors.text, fontWeight: '500' },
  segmented: {
    flexDirection: 'row', borderRadius: radius.md, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border, padding: 2,
    backgroundColor: colors.sidebar, gap: 2,
  },
  segment: { flex: 1, paddingVertical: 6, alignItems: 'center', borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.surface, shadowColor: colors.shadowColor, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 2 },
  segmentText: { fontSize: 11, color: colors.textMuted, fontWeight: '500' },
  segmentTextActive: { color: colors.text, fontWeight: '600' },
  saveBtn: { marginTop: 14 },
  saveBtnContent: { flexDirection: 'row', alignItems: 'center' },
  saveBtnText: { color: colors.textInverse, fontSize: 13, fontWeight: '600' },
  saveBtnTextWithIcon: { marginLeft: 6 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  rowLabel: { fontSize: 12.5, color: colors.textSecondary },
  rowValue: { fontSize: 12.5, color: colors.text, fontWeight: '500', fontFamily: font.mono },
  disconnectBtn: {
    marginTop: 14, backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: 11, alignItems: 'center',
  },
  disconnectText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  removeBtn: {
    marginTop: 8, backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.errorBorder,
    padding: 11, alignItems: 'center',
  },
  removeText: { color: colors.error, fontSize: 13, fontWeight: '500' },
  channelTitle: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8, marginTop: 4 },
  channelDivider: { height: 1, backgroundColor: colors.borderLight, marginVertical: 14 },
  channelSubtitle: { fontSize: 11.5, color: colors.textMuted, lineHeight: 17, marginBottom: 4 },
  channelHint: { fontSize: 10.5, color: colors.textMuted, marginTop: 6, lineHeight: 15 },
  restartHint: { fontSize: 10.5, color: colors.textMuted, textAlign: 'center', marginTop: 8, fontStyle: 'italic' },

  // Channel sub-tab strip
  channelTabs: {
    flexDirection: 'row',
    backgroundColor: colors.sidebar,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: 2,
    marginBottom: 12, gap: 2,
  },
  channelTab: {
    flex: 1, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 7, paddingHorizontal: 6,
    borderRadius: radius.sm,
  },
  channelTabActive: {
    backgroundColor: colors.surface,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1, shadowRadius: 2,
  },
  channelTabIcon: { marginRight: 5 },
  channelTabLabel: { fontSize: 11, fontWeight: '500', color: colors.textMuted },
  channelTabLabelActive: { color: colors.text, fontWeight: '600' },
});

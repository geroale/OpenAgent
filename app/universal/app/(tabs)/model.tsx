import { colors } from '../../theme';
/**
 * Model screen — view and edit the LLM provider configuration.
 */

import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { useConnection } from '../../stores/connection';
import { useConfig } from '../../stores/config';
import { setBaseUrl } from '../../services/api';
import PrimaryButton from '../../components/PrimaryButton';

const PROVIDERS = ['claude-cli', 'claude-api', 'zhipu'];
const PERMISSION_MODES = ['bypass', 'auto', 'default'];

export default function ModelScreen() {
  const connConfig = useConnection((s) => s.config);
  const { config: agentConfig, loadConfig, updateSection } = useConfig();

  const [provider, setProvider] = useState('claude-cli');
  const [modelId, setModelId] = useState('claude-sonnet-4-6');
  const [permissionMode, setPermissionMode] = useState('bypass');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl_] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (connConfig) {
      setBaseUrl(connConfig.host, connConfig.port);
      loadConfig();
    }
  }, [connConfig]);

  // Populate fields from loaded config
  useEffect(() => {
    if (agentConfig?.model) {
      const m = agentConfig.model;
      setProvider(m.provider || 'claude-cli');
      setModelId(m.model_id || '');
      setPermissionMode(m.permission_mode || 'bypass');
      setApiKey(m.api_key || '');
      setBaseUrl_(m.base_url || '');
    }
  }, [agentConfig]);

  const handleSave = async () => {
    const model: any = { provider, model_id: modelId, permission_mode: permissionMode };
    if (apiKey.trim()) model.api_key = apiKey;
    if (baseUrl.trim()) model.base_url = baseUrl;
    const ok = await updateSection('model', model);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  };

  const needsApiKey = provider === 'claude-api' || provider === 'zhipu';
  const needsBaseUrl = provider === 'zhipu';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Model Configuration</Text>
      <Text style={styles.hint}>Changes require an agent restart to take effect.</Text>

      <View style={styles.card}>
        {/* Provider */}
        <Text style={styles.label}>Provider</Text>
        <View style={styles.segmented}>
          {PROVIDERS.map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.segment, provider === p && styles.segmentActive]}
              onPress={() => setProvider(p)}
            >
              <Text style={[styles.segmentText, provider === p && styles.segmentTextActive]}>
                {p}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Model ID */}
        <Text style={styles.label}>Model ID</Text>
        <TextInput
          style={styles.input}
          value={modelId}
          onChangeText={setModelId}
          placeholder="claude-sonnet-4-6"
          placeholderTextColor={colors.textMuted}
        />

        {/* Permission Mode */}
        <Text style={styles.label}>Permission Mode</Text>
        <View style={styles.segmented}>
          {PERMISSION_MODES.map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.segment, permissionMode === m && styles.segmentActive]}
              onPress={() => setPermissionMode(m)}
            >
              <Text style={[styles.segmentText, permissionMode === m && styles.segmentTextActive]}>
                {m}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* API Key (conditional) */}
        {needsApiKey && (
          <>
            <Text style={styles.label}>API Key</Text>
            <TextInput
              style={styles.input}
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="${ANTHROPIC_API_KEY}"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
            />
          </>
        )}

        {/* Base URL (conditional) */}
        {needsBaseUrl && (
          <>
            <Text style={styles.label}>Base URL</Text>
            <TextInput
              style={styles.input}
              value={baseUrl}
              onChangeText={setBaseUrl_}
              placeholder="https://api.z.ai/api/paas/v4"
              placeholderTextColor={colors.textMuted}
            />
          </>
        )}

        {/* Save */}
        <PrimaryButton style={styles.saveBtn} onPress={handleSave}>
          <Text style={styles.saveBtnText}>
            {saved ? '✓ Saved (restart required)' : 'Save'}
          </Text>
        </PrimaryButton>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, maxWidth: 500, width: "100%", alignSelf: "center" },
  title: { fontSize: 17, fontWeight: '600', color: colors.text, marginBottom: 4 },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: 16 },
  card: {
    backgroundColor: colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border, padding: 16,
  },
  label: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: 16, marginBottom: 6 },
  input: {
    backgroundColor: colors.inputBg, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    padding: 10, color: colors.text, fontSize: 14,
  },
  segmented: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: colors.inputBg },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  segmentTextActive: { color: colors.textInverse },
  saveBtn: {
    marginTop: 20,
  },
  saveBtnText: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },
});

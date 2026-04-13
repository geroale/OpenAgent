import { colors } from '../../theme';
/**
 * Model screen — provider cards grid, model catalog, cost dashboard.
 */

import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useConnection } from '../../stores/connection';
import { useConfig } from '../../stores/config';
import {
  setBaseUrl, getModels, addModel, deleteModel, testModel, setActiveModel,
  getUsage, getDailyUsage, getModelCatalog,
} from '../../services/api';
import PrimaryButton from '../../components/PrimaryButton';
import type { UsageData, ModelCatalogEntry, DailyUsageEntry, ModelConfig } from '../../../common/types';

const KNOWN_PROVIDERS = ['anthropic', 'openai', 'google', 'openrouter', 'ollama'];

export default function ModelScreen() {
  const connConfig = useConnection((s) => s.config);
  const { config: agentConfig, loadConfig } = useConfig();

  // Provider/model state
  const [providers, setProviders] = useState<Record<string, any>>({});
  const [activeModel, setActive] = useState<ModelConfig | null>(null);
  const [catalogCache, setCatalogCache] = useState<Record<string, ModelCatalogEntry[]>>({});
  const [testingProv, setTestingProv] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error?: string }>>({});

  // Add provider form
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newUrl, setNewUrl] = useState('');

  // Mode
  const [mode, setMode] = useState<'smart' | 'single' | 'claude-cli'>('smart');
  const [singleModelId, setSingleModelId] = useState('');
  const [cliModelId, setCliModelId] = useState('claude-sonnet-4-6');
  const [budget, setBudget] = useState('20');

  // Usage
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsageEntry[]>([]);
  const [costDays, setCostDays] = useState(7);

  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (connConfig) {
      setBaseUrl(connConfig.host, connConfig.port);
      reload();
    }
  }, [connConfig]);

  const reload = async () => {
    await loadConfig();
    try {
      const data = await getModels();
      setProviders(data.models || {});
      setActive(data.active || null);
      if (data.active?.provider === 'smart') setMode('smart');
      else if (data.active?.provider === 'claude-cli') setMode('claude-cli');
      else setMode('single');
      if (data.active?.model_id) {
        setSingleModelId(data.active.model_id);
        if (data.active.provider === 'claude-cli') setCliModelId(data.active.model_id || 'claude-sonnet-4-6');
      }
      if (data.active?.monthly_budget) setBudget(String(data.active.monthly_budget));
    } catch {}
    getUsage().then(setUsage).catch(() => {});
    getDailyUsage(costDays).then(setDailyUsage).catch(() => {});
  };

  // Load catalog for a provider
  const loadCatalog = async (provider: string) => {
    if (catalogCache[provider]) return;
    try {
      const models = await getModelCatalog(provider);
      setCatalogCache((prev) => ({ ...prev, [provider]: models }));
    } catch {}
  };

  useEffect(() => {
    Object.keys(providers).forEach(loadCatalog);
  }, [providers]);

  useEffect(() => {
    getDailyUsage(costDays).then(setDailyUsage).catch(() => {});
  }, [costDays]);

  const handleAddProvider = async () => {
    if (!newName.trim()) return;
    await addModel(newName.trim(), {
      api_key: newKey.trim() || undefined,
      base_url: newUrl.trim() || undefined,
    });
    setAdding(false);
    setNewName(''); setNewKey(''); setNewUrl('');
    await reload();
  };

  const handleRemoveProvider = async (name: string) => {
    await deleteModel(name);
    await reload();
  };

  const handleTest = async (name: string) => {
    setTestingProv(name);
    try {
      const r = await testModel(name);
      setTestResults((prev) => ({ ...prev, [name]: r }));
    } catch (e: any) {
      setTestResults((prev) => ({ ...prev, [name]: { ok: false, error: e.message } }));
    }
    setTestingProv(null);
  };

  const handleSaveMode = async () => {
    let model: ModelConfig;
    if (mode === 'smart') {
      model = { provider: 'smart', monthly_budget: parseFloat(budget) || 20 };
    } else if (mode === 'claude-cli') {
      model = { provider: 'claude-cli', model_id: cliModelId, permission_mode: 'bypass' };
    } else {
      model = { provider: 'litellm', model_id: singleModelId };
    }
    await setActiveModel(model);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Models</Text>

      {/* Mode Selector */}
      <View style={styles.modeRow}>
        <TouchableOpacity style={[styles.modeBtn, mode === 'smart' && styles.modeBtnActive]} onPress={() => setMode('smart')}>
          <Text style={[styles.modeBtnText, mode === 'smart' && styles.modeBtnTextActive]}>Smart Routing</Text>
          <Text style={styles.modeHint}>Auto-picks by task + price</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.modeBtn, mode === 'single' && styles.modeBtnActive]} onPress={() => setMode('single')}>
          <Text style={[styles.modeBtnText, mode === 'single' && styles.modeBtnTextActive]}>Single Model</Text>
          <Text style={styles.modeHint}>One API model</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.modeBtn, mode === 'claude-cli' && styles.modeBtnActive]} onPress={() => setMode('claude-cli')}>
          <Text style={[styles.modeBtnText, mode === 'claude-cli' && styles.modeBtnTextActive]}>Claude CLI</Text>
          <Text style={styles.modeHint}>Pro/Max subscription</Text>
        </TouchableOpacity>
      </View>

      {mode === 'single' && (
        <View style={styles.singleRow}>
          <Text style={styles.label}>Model ID</Text>
          <TextInput style={styles.input} value={singleModelId} onChangeText={setSingleModelId}
            placeholder="anthropic/claude-sonnet-4-6" placeholderTextColor={colors.textMuted} />
        </View>
      )}

      {mode === 'claude-cli' && (
        <View style={styles.singleRow}>
          <Text style={styles.label}>Model</Text>
          <TextInput style={styles.input} value={cliModelId} onChangeText={setCliModelId}
            placeholder="claude-sonnet-4-6" placeholderTextColor={colors.textMuted} />
          <Text style={styles.cliHint}>
            Uses your Claude Pro/Max subscription. No API key needed.{'\n'}
            Requires `claude` CLI installed and logged in.
          </Text>
        </View>
      )}

      {mode === 'smart' && (
        <View style={styles.singleRow}>
          <Text style={styles.label}>Monthly Budget ($)</Text>
          <TextInput style={styles.input} value={budget} onChangeText={setBudget}
            placeholder="20.00" placeholderTextColor={colors.textMuted} keyboardType="numeric" />
        </View>
      )}

      <PrimaryButton style={{ marginBottom: 20 }} onPress={handleSaveMode}>
        <Text style={styles.saveBtnText}>{saved ? 'Saved (restart required)' : 'Save'}</Text>
      </PrimaryButton>

      {/* Usage Bar */}
      {usage && usage.monthly_budget > 0 && (
        <View style={styles.usageBox}>
          <View style={styles.usageBar}>
            <View style={[styles.usageFill, {
              width: `${Math.min(100, (usage.monthly_spend / usage.monthly_budget) * 100)}%`,
              backgroundColor: usage.monthly_spend / usage.monthly_budget > 0.8 ? '#e74c3c' : colors.primary,
            }]} />
          </View>
          <Text style={styles.usageText}>
            ${usage.monthly_spend.toFixed(2)} / ${usage.monthly_budget.toFixed(2)}
            {usage.remaining != null && ` ($${usage.remaining.toFixed(2)} left)`}
          </Text>
        </View>
      )}

      {/* Provider Cards */}
      <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Providers</Text>

      {Object.entries(providers).map(([name, cfg]) => {
        const catalog = catalogCache[name] || [];
        return (
          <View key={name} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.providerName}>{name}</Text>
              <View style={styles.cardActions}>
                <TouchableOpacity onPress={() => handleTest(name)} disabled={testingProv === name}>
                  {testingProv === name
                    ? <ActivityIndicator size="small" color={colors.primary} />
                    : <Text style={styles.actionLink}>Test</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleRemoveProvider(name)}>
                  <Text style={[styles.actionLink, { color: '#e74c3c' }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.keyDisplay}>
              Key: {cfg.api_key_display || '—'}
            </Text>
            {cfg.base_url && <Text style={styles.keyDisplay}>URL: {cfg.base_url}</Text>}

            {testResults[name] && (
              <Text style={testResults[name].ok ? styles.testOk : styles.testFail}>
                {testResults[name].ok ? 'Connection OK' : `Failed: ${testResults[name].error}`}
              </Text>
            )}

            {/* Model list from catalog */}
            {catalog.length > 0 && (
              <View style={styles.modelList}>
                {catalog.slice(0, 10).map((m) => (
                  <View key={m.model_id} style={styles.modelRow}>
                    <Text style={styles.modelId}>{m.model_id.replace(`${name}/`, '')}</Text>
                    <Text style={styles.modelPrice}>
                      ${m.input_cost_per_million}/M in  ${m.output_cost_per_million}/M out
                    </Text>
                  </View>
                ))}
                {catalog.length > 10 && (
                  <Text style={styles.moreModels}>+{catalog.length - 10} more</Text>
                )}
              </View>
            )}

            {/* Claude CLI special entry for Anthropic */}
            {name === 'anthropic' && (
              <View style={styles.modelRow}>
                <Text style={styles.modelId}>claude-cli (subscription)</Text>
                <Text style={[styles.modelPrice, { color: '#2ecc71' }]}>$0 flat</Text>
              </View>
            )}
          </View>
        );
      })}

      {/* Add Provider */}
      {adding ? (
        <View style={styles.card}>
          <Text style={styles.label}>Provider</Text>
          <View style={styles.chipRow}>
            {KNOWN_PROVIDERS.map((p) => (
              <TouchableOpacity key={p} style={[styles.chip, newName === p && styles.chipActive]} onPress={() => setNewName(p)}>
                <Text style={[styles.chipText, newName === p && styles.chipTextActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>API Key</Text>
          <TextInput style={styles.input} value={newKey} onChangeText={setNewKey}
            placeholder="sk-..." placeholderTextColor={colors.textMuted} secureTextEntry />
          {(newName === 'ollama' || newName === 'custom') && (
            <>
              <Text style={styles.label}>Base URL</Text>
              <TextInput style={styles.input} value={newUrl} onChangeText={setNewUrl}
                placeholder="http://localhost:11434/v1" placeholderTextColor={colors.textMuted} />
            </>
          )}
          <View style={styles.formRow}>
            <TouchableOpacity onPress={() => { setAdding(false); setNewName(''); setNewKey(''); setNewUrl(''); }}>
              <Text style={{ color: colors.textMuted }}>Cancel</Text>
            </TouchableOpacity>
            <PrimaryButton onPress={handleAddProvider}>
              <Text style={styles.saveBtnText}>Add</Text>
            </PrimaryButton>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.addBtn} onPress={() => setAdding(true)}>
          <Text style={styles.addBtnText}>+ Add Provider</Text>
        </TouchableOpacity>
      )}

      {/* Cost Dashboard */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Costs</Text>

      <View style={styles.card}>
        <View style={styles.costTabs}>
          {[7, 30].map((d) => (
            <TouchableOpacity key={d} style={[styles.costTab, costDays === d && styles.costTabActive]} onPress={() => setCostDays(d)}>
              <Text style={[styles.costTabText, costDays === d && styles.costTabTextActive]}>{d}d</Text>
            </TouchableOpacity>
          ))}
        </View>

        {dailyUsage.length > 0 ? (
          <>
            {/* Summary */}
            <View style={styles.costSummary}>
              <View style={styles.costStat}>
                <Text style={styles.costStatValue}>${dailyUsage.reduce((s, e) => s + e.cost, 0).toFixed(3)}</Text>
                <Text style={styles.costStatLabel}>Total</Text>
              </View>
              <View style={styles.costStat}>
                <Text style={styles.costStatValue}>{dailyUsage.reduce((s, e) => s + e.request_count, 0)}</Text>
                <Text style={styles.costStatLabel}>Requests</Text>
              </View>
              <View style={styles.costStat}>
                <Text style={styles.costStatValue}>
                  {(dailyUsage.reduce((s, e) => s + e.input_tokens + e.output_tokens, 0) / 1000).toFixed(0)}K
                </Text>
                <Text style={styles.costStatLabel}>Tokens</Text>
              </View>
            </View>

            {/* Table */}
            <View style={styles.costTable}>
              <View style={styles.costHeaderRow}>
                <Text style={[styles.costCell, styles.costHeaderText, { flex: 1.2 }]}>Date</Text>
                <Text style={[styles.costCell, styles.costHeaderText, { flex: 2 }]}>Model</Text>
                <Text style={[styles.costCell, styles.costHeaderText, { flex: 0.6 }]}>Req</Text>
                <Text style={[styles.costCell, styles.costHeaderText, { flex: 1 }]}>Cost</Text>
              </View>
              {dailyUsage.slice(0, 20).map((e, i) => (
                <View key={i} style={styles.costRow}>
                  <Text style={[styles.costCell, { flex: 1.2 }]}>{e.date.slice(5)}</Text>
                  <Text style={[styles.costCell, { flex: 2 }]} numberOfLines={1}>{e.model.split('/').pop()}</Text>
                  <Text style={[styles.costCell, { flex: 0.6 }]}>{e.request_count}</Text>
                  <Text style={[styles.costCell, { flex: 1 }]}>${e.cost.toFixed(4)}</Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <Text style={styles.emptyText}>No usage data yet.</Text>
        )}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, maxWidth: 540, width: '100%', alignSelf: 'center' },
  title: { fontSize: 17, fontWeight: '600', color: colors.text, marginBottom: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },

  // Mode selector
  modeRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  modeBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  modeBtnActive: { borderColor: colors.primary, backgroundColor: colors.primary + '15' },
  modeBtnText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  modeBtnTextActive: { color: colors.primary },
  modeHint: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  singleRow: { marginBottom: 12 },
  cliHint: { fontSize: 11, color: colors.textMuted, marginTop: 8, lineHeight: 16 },

  label: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 4, marginTop: 8 },
  input: {
    backgroundColor: colors.inputBg, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    padding: 10, color: colors.text, fontSize: 14,
  },
  saveBtnText: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },

  // Usage bar
  usageBox: { marginBottom: 16 },
  usageBar: { height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' },
  usageFill: { height: '100%', borderRadius: 3 },
  usageText: { fontSize: 11, color: colors.textMuted, marginTop: 4 },

  // Provider cards
  card: {
    backgroundColor: colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 10,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardActions: { flexDirection: 'row', gap: 12 },
  providerName: { fontSize: 15, fontWeight: '600', color: colors.text },
  actionLink: { fontSize: 13, color: colors.primary, fontWeight: '500' },
  keyDisplay: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  testOk: { fontSize: 12, color: '#2ecc71', marginTop: 6 },
  testFail: { fontSize: 12, color: '#e74c3c', marginTop: 6 },

  // Model list in card
  modelList: { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.borderLight, paddingTop: 8 },
  modelRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  modelId: { fontSize: 13, color: colors.text },
  modelPrice: { fontSize: 11, color: colors.textMuted },
  moreModels: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 4 },

  // Add provider
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6,
    backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.textSecondary },
  chipTextActive: { color: colors.textInverse },
  formRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  addBtn: {
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
    borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10,
  },
  addBtnText: { fontSize: 14, color: colors.primary, fontWeight: '500' },

  // Cost dashboard
  costTabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  costTab: { paddingVertical: 4, paddingHorizontal: 14, borderRadius: 6, backgroundColor: colors.inputBg },
  costTabActive: { backgroundColor: colors.primary },
  costTabText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  costTabTextActive: { color: colors.textInverse },
  costSummary: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 12 },
  costStat: { alignItems: 'center' },
  costStatValue: { fontSize: 16, fontWeight: '700', color: colors.text },
  costStatLabel: { fontSize: 11, color: colors.textMuted },
  costTable: {},
  costHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 6, marginBottom: 4 },
  costHeaderText: { fontWeight: '600', color: colors.textSecondary },
  costRow: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  costCell: { fontSize: 12, color: colors.text },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: 16 },
});

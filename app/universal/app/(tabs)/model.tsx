import { colors } from '../../theme';
/**
 * Model screen — provider cards grid, model catalog, cost dashboard.
 */

import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useConnection } from '../../stores/connection';
import { useConfig } from '../../stores/config';
import {
  setBaseUrl, getModels, addModel, deleteModel, testModel, setActiveModel, updateModel,
  getUsage, getDailyUsage, getModelCatalog, getAvailableProviders,
} from '../../services/api';
import PrimaryButton from '../../components/PrimaryButton';
import type { UsageData, ModelCatalogEntry, DailyUsageEntry, ModelConfig } from '../../../common/types';

const FALLBACK_PROVIDERS = ['anthropic', 'openai', 'google'];

export default function ModelScreen() {
  const connConfig = useConnection((s) => s.config);
  const { config: agentConfig, loadConfig } = useConfig();

  // Available providers from litellm
  const [availableProviders, setAvailableProviders] = useState<string[]>(FALLBACK_PROVIDERS);

  // Provider/model state
  const [providers, setProviders] = useState<Record<string, any>>({});
  const [activeModel, setActive] = useState<ModelConfig | null>(null);
  const [catalogCache, setCatalogCache] = useState<Record<string, ModelCatalogEntry[]>>({});
  const [testingProv, setTestingProv] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error?: string }>>({});

  // Add provider form
  const [adding, setAdding] = useState(false);
  const [addingModelFor, setAddingModelFor] = useState<string | null>(null); // provider name
  const [newName, setNewName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newUseCli, setNewUseCli] = useState(false);

  const [budget, setBudget] = useState('20');
  // Per-provider disabled models
  const [disabledModels, setDisabledModels] = useState<Record<string, string[]>>({});

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
    if (!connConfig) return;
    try {
      const data = await getModels();
      setProviders(data.models || {});
      setActive(data.active || null);
      if (data.active?.monthly_budget) setBudget(String(data.active.monthly_budget));
      // Load disabled_models per provider
      const dm: Record<string, string[]> = {};
      for (const [name, cfg] of Object.entries(data.models || {})) {
        dm[name] = (cfg as any).disabled_models || [];
      }
      setDisabledModels(dm);
    } catch {}
    getAvailableProviders().then(setAvailableProviders).catch(() => {});
    getUsage().then(setUsage).catch(() => {});
    getDailyUsage(costDays).then(setDailyUsage).catch(() => {});
  };

  // Load catalog for pricing info only — never auto-saves models
  const loadCatalog = async (provider: string) => {
    if (catalogCache[provider]) return;
    try {
      const models = await getModelCatalog(provider);
      if (models && models.length > 0) {
        setCatalogCache((prev) => ({ ...prev, [provider]: models }));
      }
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
    if (!connConfig) { alert('Not connected to agent'); return; }
    try {
      const entry: any = {};
      if (newKey.trim()) entry.api_key = newKey.trim();
      if (newUrl.trim()) entry.base_url = newUrl.trim();

      // Start with empty models list — user adds models explicitly via "Add Model"
      const modelIds: string[] = [];
      if (newName === 'anthropic' && newUseCli) {
        modelIds.push('claude-cli');
      }
      if (modelIds.length > 0) entry.models = modelIds;

      await addModel(newName.trim(), entry);
      setAdding(false);
      setNewName(''); setNewKey(''); setNewUrl(''); setNewUseCli(false);
      // Clear catalog cache so it reloads
      setCatalogCache((prev) => { const c = { ...prev }; delete c[newName]; return c; });
      await reload();
    } catch (e: any) {
      alert(`Failed to add provider: ${e.message}`);
    }
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

  const handleSave = async () => {
    const model: ModelConfig = {
      provider: 'smart',
      monthly_budget: parseFloat(budget) || 20,
    };
    await setActiveModel(model);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const addModelToProvider = async (providerName: string, modelId: string) => {
    const current = (providers[providerName] as any)?.models || [];
    if (current.includes(modelId)) return;
    const updated = [...current, modelId];
    try {
      await updateModel(providerName, { models: updated });
      setProviders((prev) => ({
        ...prev,
        [providerName]: { ...prev[providerName], models: updated },
      }));
    } catch {}
    setAddingModelFor(null);
  };

  const removeModelFromProvider = async (providerName: string, modelId: string) => {
    const current: string[] = (providers[providerName] as any)?.models || [];
    const updated = current.filter((m) => m !== modelId);
    try {
      await updateModel(providerName, { models: updated });
      setProviders((prev) => ({
        ...prev,
        [providerName]: { ...prev[providerName], models: updated },
      }));
    } catch {}
  };

  const toggleModel = async (providerName: string, modelId: string) => {
    const current = disabledModels[providerName] || [];
    const isDisabled = current.includes(modelId);
    const updated = isDisabled
      ? current.filter((m) => m !== modelId)
      : [...current, modelId];

    setDisabledModels((prev) => ({ ...prev, [providerName]: updated }));

    // Save to backend
    try {
      await updateModel(providerName, { disabled_models: updated } as any);
    } catch {}
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Models</Text>

      <Text style={styles.hint}>Smart routing auto-picks the best model by task difficulty and price. Enable/disable models below.</Text>

      <View style={styles.singleRow}>
        <Text style={styles.label}>Monthly Budget ($)</Text>
        <TextInput style={styles.input} value={budget} onChangeText={setBudget}
          placeholder="20.00" placeholderTextColor={colors.textMuted} keyboardType="numeric" />
      </View>

      <PrimaryButton style={{ marginBottom: 20 }} onPress={handleSave}>
        <Text style={styles.saveBtnText}>{saved ? 'Saved (restart required)' : 'Save'}</Text>
      </PrimaryButton>

      {/* Usage Bar */}
      {usage && usage.monthly_budget > 0 && (
        <View style={styles.usageBox}>
          <View style={styles.usageBar}>
            <View style={[styles.usageFill, {
              width: `${Math.min(100, (usage.monthly_spend / usage.monthly_budget) * 100)}%`,
              backgroundColor: usage.monthly_spend / usage.monthly_budget > 0.8 ? colors.error : colors.primary,
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
        // Only show models explicitly added by the user (from YAML config)
        const configModels: string[] = (cfg as any).models || [];
        const catalog = catalogCache[name] || [];
        const catalogMap: Record<string, ModelCatalogEntry> = {};
        for (const m of catalog) {
          const short = m.model_id.replace(`${name}/`, '');
          catalogMap[short] = m;
        }

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
                  <Text style={[styles.actionLink, { color: colors.error }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.keyDisplay}>
              Key: {cfg.api_key
                ? (cfg.api_key.startsWith('${') ? cfg.api_key : '****' + cfg.api_key.slice(-4))
                : '—'}
            </Text>
            {cfg.base_url && <Text style={styles.keyDisplay}>URL: {cfg.base_url}</Text>}

            {testResults[name] && (
              <Text style={testResults[name].ok ? styles.testOk : styles.testFail}>
                {testResults[name].ok ? 'Connection OK' : `Failed: ${testResults[name].error}`}
              </Text>
            )}

            {configModels.length > 0 && (
              <View style={styles.modelList}>
                {configModels.slice(0, 20).map((modelId) => {
                  const isCli = modelId === 'claude-cli';
                  const disabled = (disabledModels[name] || []).includes(modelId);
                  const pricing = catalogMap[modelId];
                  return (
                    <View key={modelId}>
                      <TouchableOpacity style={styles.modelRow} onPress={() => toggleModel(name, modelId)}>
                        <View style={styles.modelToggle}>
                          <View style={[styles.toggleDot, disabled ? styles.toggleOff : styles.toggleOn]} />
                          <Text style={[styles.modelId, disabled && styles.modelDisabled]}>{modelId}</Text>
                        </View>
                        {isCli ? (
                          <Text style={[styles.modelPrice, disabled && styles.modelDisabled, !disabled && { color: colors.success }]}>$0 flat</Text>
                        ) : pricing ? (
                          <Text style={[styles.modelPrice, disabled && styles.modelDisabled]}>
                            ${pricing.input_cost_per_million}/M in  ${pricing.output_cost_per_million}/M out
                          </Text>
                        ) : (
                          <Text style={[styles.modelPrice, disabled && styles.modelDisabled]}>—</Text>
                        )}
                      </TouchableOpacity>
                      {isCli && <Text style={styles.cliSubtitle}>Pro/Max subscription — no API key needed</Text>}
                    </View>
                  );
                })}
                {configModels.length > 20 && (
                  <Text style={styles.moreModels}>+{configModels.length - 20} more</Text>
                )}
              </View>
            )}

            {/* Add model picker */}
            {addingModelFor === name ? (
              <View style={styles.modelPicker}>
                <Text style={styles.label}>Select a model to add:</Text>
                {name === 'anthropic' && !configModels.includes('claude-cli') && (
                  <TouchableOpacity style={styles.pickerItem} onPress={() => addModelToProvider(name, 'claude-cli')}>
                    <Text style={styles.pickerItemText}>claude-cli</Text>
                    <Text style={[styles.modelPrice, { color: colors.success }]}>$0 flat</Text>
                  </TouchableOpacity>
                )}
                {catalog.filter((m) => !configModels.includes(m.model_id.replace(`${name}/`, ''))).slice(0, 15).map((m) => {
                  const shortId = m.model_id.replace(`${name}/`, '');
                  return (
                    <TouchableOpacity key={m.model_id} style={styles.pickerItem} onPress={() => addModelToProvider(name, shortId)}>
                      <Text style={styles.pickerItemText}>{shortId}</Text>
                      <Text style={styles.modelPrice}>${m.input_cost_per_million}/M in  ${m.output_cost_per_million}/M out</Text>
                    </TouchableOpacity>
                  );
                })}
                {catalog.length === 0 && (
                  <Text style={styles.keyDisplay}>Catalog not available — restart agent with litellm installed</Text>
                )}
                <TouchableOpacity onPress={() => setAddingModelFor(null)} style={{ marginTop: 8 }}>
                  <Text style={{ color: colors.textMuted, textAlign: 'center' }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.addModelBtn} onPress={() => setAddingModelFor(name)}>
                <Text style={styles.addModelText}>+ Add Model</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      {/* Add Provider */}
      {adding ? (
        <View style={styles.card}>
          <Text style={styles.label}>Provider</Text>
          <TextInput style={[styles.input, { marginBottom: 8 }]} value={newName} onChangeText={setNewName}
            placeholder="Type or select a provider" placeholderTextColor={colors.textMuted} />
          <View style={styles.chipRow}>
            {availableProviders
              .filter((p) => !newName || p.startsWith(newName.toLowerCase()))
              .slice(0, 12)
              .map((p) => (
              <TouchableOpacity key={p} style={[styles.chip, newName === p && styles.chipActive]} onPress={() => setNewName(p)}>
                <Text style={[styles.chipText, newName === p && styles.chipTextActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {/* CLI toggle for Anthropic */}
          {newName === 'anthropic' && (
            <TouchableOpacity style={styles.cliToggleRow} onPress={() => setNewUseCli(!newUseCli)}>
              <View style={[styles.toggleDot, newUseCli ? styles.toggleOn : styles.toggleOff]} />
              <View>
                <Text style={styles.cliToggleLabel}>Use Claude CLI (Pro/Max subscription)</Text>
                <Text style={styles.cliToggleHint}>No API key needed — uses `claude` CLI</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* API Key — not needed for CLI-only mode */}
          {!(newName === 'anthropic' && newUseCli) && (
            <>
              <Text style={styles.label}>API Key</Text>
              <TextInput style={styles.input} value={newKey} onChangeText={setNewKey}
                placeholder="sk-..." placeholderTextColor={colors.textMuted} secureTextEntry />
            </>
          )}
          {newName === 'anthropic' && !newUseCli && (
            <Text style={[styles.hint, { marginTop: 4 }]}>Or toggle CLI above to use your subscription instead</Text>
          )}
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
          <View style={styles.addBtnContent}>
            <Feather name="plus" size={14} color={colors.primary} />
            <Text style={styles.addBtnText}>Add Provider</Text>
          </View>
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

  singleRow: { marginBottom: 12 },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: 12 },

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
  testOk: { fontSize: 12, color: colors.success, marginTop: 6 },
  testFail: { fontSize: 12, color: colors.error, marginTop: 6 },

  // Model list in card
  modelList: { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.borderLight, paddingTop: 8 },
  modelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  modelToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleDot: { width: 10, height: 10, borderRadius: 5 },
  toggleOn: { backgroundColor: colors.success },
  toggleOff: { backgroundColor: colors.border },
  modelId: { fontSize: 13, color: colors.text },
  modelDisabled: { color: colors.textMuted, opacity: 0.5 },
  cliSubtitle: { fontSize: 10, color: colors.textMuted, marginLeft: 18, marginBottom: 4 },
  addModelBtn: { marginTop: 8, padding: 8, alignItems: 'center' },
  addModelText: { fontSize: 13, color: colors.primary, fontWeight: '500' },
  modelPicker: { marginTop: 8, padding: 10, backgroundColor: colors.inputBg, borderRadius: 8 },
  pickerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  pickerItemText: { fontSize: 13, color: colors.text },
  cliToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 10, backgroundColor: colors.inputBg, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  cliToggleLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  cliToggleHint: { fontSize: 11, color: colors.textMuted },
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
  addBtnContent: { flexDirection: 'row', alignItems: 'center' },
  addBtnText: { fontSize: 14, color: colors.primary, fontWeight: '500', marginLeft: 8 },

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

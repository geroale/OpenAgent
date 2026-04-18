import { colors, font, radius } from '../../theme';
/**
 * Model screen — v0.10 vocabulary.
 *
 * Three concepts on this screen:
 *   - **provider**  (anthropic, openai, google, zai, …) — owns the API key.
 *                   Lives in ``openagent.yaml`` (source of truth for keys).
 *   - **framework** (agno | claude-cli) — the runtime that dispatches a
 *                   model. Per-model attribute; ``claude-cli`` only
 *                   applies to anthropic models and uses the local
 *                   ``claude`` binary instead of the API.
 *   - **model**     (gpt-4o-mini, claude-sonnet-4-6, glm-5…) — the bare
 *                   vendor id. Lives in the ``models`` SQLite table
 *                   alongside provider + framework.
 *
 * Add flow: pick a provider → optional framework toggle (anthropic only)
 * → server does /api/models/available to surface the provider's catalog
 * (live /v1/models first, OpenRouter cross-vendor fallback, bundled
 * pricing keys last) → multi-pick → POST /api/models/db.
 */

import Feather from '@expo/vector-icons/Feather';
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { useConnection } from '../../stores/connection';
import {
  setBaseUrl,
  getProviders, addModel as addProvider, deleteModel as deleteProvider,
  testModel as testProvider,
  listDbModels, deleteDbModel, enableDbModel, disableDbModel,
  createDbModel, listAvailableModels,
  setActiveModel, getUsage, getDailyUsage,
} from '../../services/api';
import Button from '../../components/Button';
import Card from '../../components/Card';
import CategorySidebar from '../../components/CategorySidebar';
import TabStrip from '../../components/TabStrip';
import ResponsiveSidebar from '../../components/ResponsiveSidebar';
import { useConfirm } from '../../components/ConfirmDialog';
import type {
  UsageData, DailyUsageEntry, ModelConfig, ModelEntry, AvailableModel,
  ProviderConfig,
} from '../../../common/types';

type CategoryId = 'overview' | 'providers' | 'models' | 'costs';

const CATEGORIES = [
  { id: 'overview' as const, label: 'Overview', icon: 'dollar-sign' as const, description: 'Budget and usage' },
  { id: 'providers' as const, label: 'Providers', icon: 'key' as const, description: 'API keys' },
  { id: 'models' as const, label: 'Models', icon: 'cpu' as const, description: 'Routable models' },
  { id: 'costs' as const, label: 'Costs', icon: 'bar-chart-2' as const, description: 'Daily breakdown' },
];

const FALLBACK_PROVIDERS = [
  'anthropic', 'openai', 'google', 'zai', 'groq', 'mistral',
  'xai', 'deepseek', 'cerebras', 'openrouter', 'local',
];

type FrameworkPick = 'agno' | 'claude-cli';

export default function ModelScreen() {
  const connConfig = useConnection((s) => s.config);
  const confirm = useConfirm();

  const [activeCategory, setActiveCategory] = useState<CategoryId>('overview');

  // Providers (yaml)
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error?: string }>>({});
  const [testingProv, setTestingProv] = useState<string | null>(null);

  const [addingProv, setAddingProv] = useState(false);
  const [newProvName, setNewProvName] = useState('');
  const [newProvKey, setNewProvKey] = useState('');
  const [newProvUrl, setNewProvUrl] = useState('');

  // Models (DB)
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [addingModel, setAddingModel] = useState(false);
  const [addProvider_, setAddProvider] = useState('');
  const [addFramework, setAddFramework] = useState<FrameworkPick>('agno');
  const [available, setAvailable] = useState<AvailableModel[]>([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);

  // Usage / budget
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsageEntry[]>([]);
  const [costDays, setCostDays] = useState(7);
  const [budget, setBudget] = useState('20');
  const [saved, setSaved] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!connConfig) return;
    try {
      const provs = await getProviders();
      setProviders(provs || {});
    } catch {}
    try {
      setModels(await listDbModels());
    } catch (e: any) {
      setError(e?.message || String(e));
    }
    try { setUsage(await getUsage()); } catch {}
    try { setDailyUsage(await getDailyUsage(costDays)); } catch {}
  }, [connConfig, costDays]);

  useEffect(() => {
    if (connConfig) {
      setBaseUrl(connConfig.host, connConfig.port);
      reload();
    }
  }, [connConfig, reload]);

  // ── Provider ops ──

  const submitAddProvider = async () => {
    if (!newProvName.trim()) return;
    try {
      const entry: any = {};
      if (newProvKey.trim()) entry.api_key = newProvKey.trim();
      if (newProvUrl.trim()) entry.base_url = newProvUrl.trim();
      await addProvider(newProvName.trim(), entry);
      setAddingProv(false);
      setNewProvName(''); setNewProvKey(''); setNewProvUrl('');
      await reload();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const removeProvider = async (name: string) => {
    const ok = await confirm({
      title: 'Remove provider',
      message: `Remove provider "${name}" and its API key?\n\nModels already registered under this provider stay in the database but will start failing the next time they're dispatched.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    await deleteProvider(name);
    await reload();
  };

  const testProv = async (name: string) => {
    setTestingProv(name);
    try {
      const r = await testProvider(name);
      setTestResults((prev) => ({ ...prev, [name]: r }));
    } catch (e: any) {
      setTestResults((prev) => ({ ...prev, [name]: { ok: false, error: e?.message || String(e) } }));
    }
    setTestingProv(null);
  };

  // ── Model ops ──

  const openAddModel = async (provider: string) => {
    setAddProvider(provider);
    // Anthropic without an API key → default to claude-cli (the user's
    // Pro/Max subscription is the only way to actually run these).
    const prov = providers[provider] || {};
    const hasKey = Boolean(prov.api_key);
    setAddFramework(provider === 'anthropic' && !hasKey ? 'claude-cli' : 'agno');
    setAddingModel(true);
    setLoadingAvailable(true);
    try {
      const entries = await listAvailableModels(provider);
      setAvailable(entries);
    } catch (e: any) {
      setAvailable([]);
      setError(e?.message || String(e));
    }
    setLoadingAvailable(false);
  };

  const registerModel = async (entry: AvailableModel) => {
    try {
      await createDbModel({
        provider: addProvider_,
        model_id: entry.id,
        framework: addFramework,
        display_name: entry.display_name,
      });
      await reload();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const toggleModel = async (m: ModelEntry) => {
    try {
      if (m.enabled) await disableDbModel(m.runtime_id);
      else await enableDbModel(m.runtime_id);
      await reload();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const removeModel = async (m: ModelEntry) => {
    const ok = await confirm({
      title: 'Remove model',
      message: `Remove "${m.runtime_id}"?`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await deleteDbModel(m.runtime_id);
      await reload();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  // ── Settings ──

  const saveBudget = async () => {
    const cfg: ModelConfig = { provider: 'smart', monthly_budget: parseFloat(budget) || 20 };
    await setActiveModel(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  // ── Renders ──

  const sidebar = (
    <CategorySidebar<CategoryId>
      title="Models"
      active={activeCategory}
      onChange={setActiveCategory}
      categories={CATEGORIES}
      footer={
        usage && usage.monthly_budget > 0 ? (
          <View style={styles.sidebarFooter}>
            <Text style={styles.sidebarFooterLabel}>This Month</Text>
            <Text style={styles.sidebarFooterValue}>
              ${usage.monthly_spend.toFixed(2)} / ${usage.monthly_budget.toFixed(2)}
            </Text>
          </View>
        ) : null
      }
    />
  );

  const renderOverview = () => (
    <>
      <Text style={styles.title}>Overview</Text>
      <Text style={styles.hint}>
        The smart router picks a model per incoming message based on a cheap classifier and your monthly budget. Models
        live in the database (add them under Models). API keys live in the yaml (add them under Providers).
      </Text>

      <Card>
        <Text style={styles.label}>Monthly Budget (USD)</Text>
        <TextInput
          style={styles.input}
          value={budget}
          onChangeText={setBudget}
          keyboardType="numeric"
          placeholderTextColor={colors.textMuted}
        />
        <View style={{ height: 10 }} />
        <Button variant="primary" size="md" label={saved ? 'Saved ✓' : 'Save'} onPress={saveBudget} />
      </Card>

      <View style={{ height: 10 }} />

      <Card>
        <Text style={styles.label}>This month</Text>
        <Text style={styles.overviewValue}>
          {usage ? `$${usage.monthly_spend.toFixed(3)}` : '—'}
          {usage && usage.monthly_budget > 0 ? (
            <Text style={styles.overviewMuted}> / ${usage.monthly_budget.toFixed(2)}</Text>
          ) : null}
        </Text>
      </Card>
    </>
  );

  const renderProviders = () => (
    <>
      <Text style={styles.sectionTitle}>Providers</Text>
      <Text style={styles.hint}>
        The vendors that OWN the models (anthropic, openai, google, …). Each provider needs an API key (except when you
        only use them via claude-cli, which wraps Anthropic with your Pro/Max subscription).
      </Text>

      {Object.entries(providers).map(([name, cfg]) => (
        <View key={name} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.providerName}>{name}</Text>
            <View style={styles.cardActions}>
              <TouchableOpacity onPress={() => testProv(name)} disabled={testingProv === name}>
                <Text style={styles.actionLink}>{testingProv === name ? '…' : 'Test'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => removeProvider(name)}>
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
        </View>
      ))}

      {addingProv ? (
        <View style={styles.card}>
          <Text style={styles.label}>Provider</Text>
          <TextInput
            style={[styles.input, { marginBottom: 8 }]}
            value={newProvName}
            onChangeText={setNewProvName}
            placeholder="Type or pick below"
            placeholderTextColor={colors.textMuted}
          />
          <View style={styles.chipRow}>
            {FALLBACK_PROVIDERS.filter((p) => !providers[p]).map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.chip, newProvName === p && styles.chipActive]}
                onPress={() => setNewProvName(p)}
              >
                <Text style={[styles.chipText, newProvName === p && styles.chipTextActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>API Key</Text>
          <TextInput
            style={styles.input}
            value={newProvKey}
            onChangeText={setNewProvKey}
            placeholder="sk-..."
            placeholderTextColor={colors.textMuted}
            secureTextEntry
          />
          <Text style={styles.label}>Base URL (optional)</Text>
          <TextInput
            style={styles.input}
            value={newProvUrl}
            onChangeText={setNewProvUrl}
            placeholder="https://api.example.com/v1"
            placeholderTextColor={colors.textMuted}
          />
          <View style={styles.formRow}>
            <TouchableOpacity onPress={() => {
              setAddingProv(false); setNewProvName(''); setNewProvKey(''); setNewProvUrl('');
            }}>
              <Text style={{ color: colors.textMuted }}>Cancel</Text>
            </TouchableOpacity>
            <Button variant="primary" size="md" label="Add" onPress={submitAddProvider} />
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.addBtn} onPress={() => setAddingProv(true)}>
          <View style={styles.addBtnContent}>
            <Feather name="plus" size={14} color={colors.primary} />
            <Text style={styles.addBtnText}>Add Provider</Text>
          </View>
        </TouchableOpacity>
      )}
    </>
  );

  const renderModels = () => {
    const byFramework: Record<string, ModelEntry[]> = { 'agno': [], 'claude-cli': [] };
    for (const m of models) {
      (byFramework[m.framework] ||= []).push(m);
    }

    // Show every provider we have a key for, plus anthropic always
    // (the user may want claude-cli without an API key — that route
    // bills via the Pro/Max subscription).
    const provOptions = Array.from(
      new Set([...Object.keys(providers), 'anthropic']),
    ).sort();
    const canPickCli = addProvider_ === 'anthropic';

    const noProviders = Object.keys(providers).length === 0;
    const noModels = models.length === 0;

    return (
      <>
        <Text style={styles.sectionTitle}>Models</Text>
        <Text style={styles.hint}>
          Every row is a (provider, framework, model) triple. The smart router classifies each message and dispatches
          to one of these — Agno rows hit the provider's API, claude-cli rows hit the local Claude binary.
        </Text>

        {/* Empty-state CTA: if the user has neither providers nor models,
            the Add Model flow has nothing to offer for agno routes. Send
            them to Providers first (claude-cli-only works without any
            provider key, so we still surface the Add Model button below). */}
        {noProviders && noModels && (
          <Card>
            <Text style={styles.emptyStateTitle}>No providers configured</Text>
            <Text style={styles.emptyStateBody}>
              Add a provider (openai, anthropic, …) with its API key first, then come back here to pick models from it.
              Or skip providers entirely and add a claude-cli model below (Pro/Max subscription, no API key required).
            </Text>
            <View style={{ height: 10 }} />
            <Button
              variant="primary"
              size="md"
              label="Add a provider"
              icon="key"
              onPress={() => setActiveCategory('providers')}
            />
          </Card>
        )}

        {/* Only render a framework group if it actually has rows — a
            header + "No claude-cli models configured" for a user who
            has zero claude-cli intent is just visual noise. If BOTH
            groups are empty, fall through to the global empty-state
            which handles the no-providers + no-models CTA above. */}
        {(['agno', 'claude-cli'] as const)
          .filter((fw) => byFramework[fw].length > 0)
          .map((fw) => (
          <View key={fw} style={{ marginBottom: 14 }}>
            <Text style={styles.frameworkHeader}>
              {fw}
              {fw === 'claude-cli' && (
                <Text style={styles.frameworkSub}>  · Pro/Max subscription, no per-token billing</Text>
              )}
            </Text>
            <Card padded={false}>
              {byFramework[fw].map((m, i) => (
                  <View key={m.runtime_id} style={[styles.row, i > 0 && styles.rowBorder]}>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowTitle}>
                        <Text style={styles.rowProvider}>{m.provider}</Text>
                        <Text style={styles.rowSep}> · </Text>
                        <Text style={styles.rowModel}>{m.model_id}</Text>
                      </Text>
                      {fw === 'claude-cli' ? (
                        <Text style={styles.rowMeta}>subscription</Text>
                      ) : (m.input_cost_per_million || m.output_cost_per_million) ? (
                        <Text style={styles.rowMeta}>
                          ${m.input_cost_per_million ?? '-'} / ${m.output_cost_per_million ?? '-'} per M
                        </Text>
                      ) : (
                        <Text style={styles.rowMeta}>no pricing</Text>
                      )}
                    </View>
                    <TouchableOpacity style={styles.toggleBtn} onPress={() => toggleModel(m)}>
                      <View style={[styles.toggleDot, m.enabled ? styles.toggleOn : styles.toggleOff]} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.removeBtn} onPress={() => removeModel(m)}>
                      <Feather name="x" size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
              ))}
            </Card>
          </View>
        ))}

        {addingModel ? (
          <Card>
            <Text style={styles.label}>Provider</Text>
            <View style={styles.chipRow}>
              {provOptions.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.chip, addProvider_ === p && styles.chipActive]}
                  onPress={() => openAddModel(p)}
                >
                  <Text style={[styles.chipText, addProvider_ === p && styles.chipTextActive]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {canPickCli && (
              <>
                <Text style={styles.label}>Framework</Text>
                <View style={styles.chipRow}>
                  <TouchableOpacity
                    style={[styles.chip, addFramework === 'agno' && styles.chipActive]}
                    onPress={() => setAddFramework('agno')}
                  >
                    <Text style={[styles.chipText, addFramework === 'agno' && styles.chipTextActive]}>agno (API)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.chip, addFramework === 'claude-cli' && styles.chipActive]}
                    onPress={() => setAddFramework('claude-cli')}
                  >
                    <Text style={[styles.chipText, addFramework === 'claude-cli' && styles.chipTextActive]}>claude-cli (subscription)</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {addProvider_ && (
              <>
                <Text style={styles.label}>Available from {addProvider_}</Text>
                {loadingAvailable ? (
                  <Text style={styles.emptyText}>Loading…</Text>
                ) : available.length === 0 ? (
                  <Text style={styles.emptyText}>No models returned.</Text>
                ) : (
                  <View style={{ gap: 4 }}>
                    {available.map((a) => (
                      <TouchableOpacity
                        key={a.id}
                        style={styles.pickerItem}
                        onPress={() => registerModel(a)}
                      >
                        <Text style={styles.pickerItemText}>{a.id}</Text>
                        <Text style={styles.pickerItemMeta}>
                          {a.added ? 'added' : a.display_name || ''}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}

            <View style={[styles.formRow, { marginTop: 10 }]}>
              <TouchableOpacity onPress={() => {
                setAddingModel(false); setAddProvider(''); setAvailable([]);
              }}>
                <Text style={{ color: colors.textMuted }}>Close</Text>
              </TouchableOpacity>
            </View>
          </Card>
        ) : (
          <TouchableOpacity style={styles.addBtn} onPress={() => setAddingModel(true)}>
            <View style={styles.addBtnContent}>
              <Feather name="plus" size={14} color={colors.primary} />
              <Text style={styles.addBtnText}>Add Model</Text>
            </View>
          </TouchableOpacity>
        )}
      </>
    );
  };

  const renderCosts = () => (
    <>
      <Text style={styles.sectionTitle}>Costs</Text>
      <Card>
        <TabStrip
          tabs={[{ id: '7', label: '7d' }, { id: '30', label: '30d' }]}
          active={String(costDays)}
          onChange={(v) => setCostDays(parseInt(v, 10))}
          size="sm"
          style={{ marginBottom: 12 }}
        />
        {dailyUsage.length > 0 ? (
          <>
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
                  <Text style={[styles.costCell, { flex: 2 }]} numberOfLines={1}>{e.model}</Text>
                  <Text style={[styles.costCell, { flex: 0.6 }]}>{e.request_count}</Text>
                  <Text style={[styles.costCell, { flex: 1 }]}>${e.cost.toFixed(4)}</Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <Text style={styles.emptyText}>No usage data yet.</Text>
        )}
      </Card>
    </>
  );

  const renderCategory = () => {
    switch (activeCategory) {
      case 'overview': return renderOverview();
      case 'providers': return renderProviders();
      case 'models': return renderModels();
      case 'costs': return renderCosts();
    }
  };

  return (
    <ResponsiveSidebar sidebar={sidebar}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {error && <Text style={styles.error}>{error}</Text>}
        {renderCategory()}
        <View style={{ height: 40 }} />
      </ScrollView>
    </ResponsiveSidebar>
  );
}

const styles = StyleSheet.create({
  sidebarFooter: {
    borderTopWidth: 1, borderTopColor: colors.borderLight,
    paddingVertical: 10, paddingHorizontal: 10, marginTop: 8,
  },
  sidebarFooterLabel: {
    fontSize: 9, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1, fontWeight: '600',
  },
  sidebarFooterValue: {
    fontSize: 12, color: colors.text, fontWeight: '600', marginTop: 2, fontFamily: font.mono,
  },

  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, maxWidth: 640, width: '100%', alignSelf: 'center' },

  title: {
    fontSize: 20, fontWeight: '500', color: colors.text, marginBottom: 4,
    fontFamily: font.display, letterSpacing: -0.4,
  },
  sectionTitle: {
    fontSize: 18, fontWeight: '500', color: colors.text, marginBottom: 4,
    fontFamily: font.display, letterSpacing: -0.3,
  },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: 14, lineHeight: 17 },
  error: { color: colors.error, fontSize: 12, marginBottom: 10 },

  label: {
    fontSize: 10, fontWeight: '600', color: colors.textSecondary,
    marginBottom: 5, marginTop: 8,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.inputBg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 11, paddingVertical: 9,
    color: colors.text, fontSize: 13, fontFamily: font.mono,
  },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardActions: { flexDirection: 'row', gap: 12 },
  providerName: {
    fontSize: 14, fontWeight: '600', color: colors.text,
    fontFamily: font.mono, letterSpacing: -0.1,
  },
  actionLink: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  keyDisplay: { fontSize: 11, color: colors.textMuted, marginTop: 4, fontFamily: font.mono },
  testOk: { fontSize: 11, color: colors.success, marginTop: 6 },
  testFail: { fontSize: 11, color: colors.error, marginTop: 6 },

  addBtn: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border,
    borderRadius: radius.lg, paddingVertical: 12, marginTop: 4, alignItems: 'center',
  },
  addBtnContent: { flexDirection: 'row', alignItems: 'center' },
  addBtnText: { fontSize: 13, color: colors.primary, fontWeight: '600', marginLeft: 6 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, marginBottom: 4 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.inputBg,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 11, color: colors.textSecondary, fontFamily: font.mono },
  chipTextActive: { color: colors.textInverse, fontWeight: '600' },

  formRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },

  frameworkHeader: {
    fontSize: 11, color: colors.textMuted, marginBottom: 4, marginTop: 6,
    textTransform: 'uppercase', letterSpacing: 1, fontWeight: '700',
  },
  frameworkSub: {
    fontSize: 10, color: colors.textMuted, fontWeight: '400',
    textTransform: 'none', letterSpacing: 0,
  },
  emptyText: { padding: 10, fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  emptyStateTitle: {
    fontSize: 14, fontWeight: '600', color: colors.text,
    marginBottom: 6, fontFamily: font.display, letterSpacing: -0.1,
  },
  emptyStateBody: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  rowInfo: { flex: 1 },
  rowTitle: { fontSize: 13, color: colors.text },
  rowProvider: { color: colors.textSecondary, fontFamily: font.mono },
  rowSep: { color: colors.textMuted },
  rowModel: { color: colors.text, fontFamily: font.mono, fontWeight: '600' },
  rowMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontFamily: font.mono },

  toggleBtn: { padding: 6, marginHorizontal: 4 },
  toggleDot: { width: 10, height: 10, borderRadius: 5 },
  toggleOn: { backgroundColor: colors.success },
  toggleOff: { backgroundColor: colors.border },
  removeBtn: { padding: 6 },

  pickerItem: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: colors.inputBg, borderRadius: radius.sm,
  },
  pickerItemText: { fontSize: 12, color: colors.text, fontFamily: font.mono },
  pickerItemMeta: { fontSize: 11, color: colors.textMuted, fontFamily: font.mono },

  overviewValue: { fontSize: 20, fontWeight: '600', color: colors.text, fontFamily: font.mono },
  overviewMuted: { fontSize: 13, color: colors.textMuted, fontWeight: '400' },

  costSummary: { flexDirection: 'row', marginBottom: 14 },
  costStat: { flex: 1, alignItems: 'center' },
  costStatValue: { fontSize: 18, fontWeight: '600', color: colors.text, fontFamily: font.mono },
  costStatLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },

  costTable: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  costHeaderRow: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  costRow: { flexDirection: 'row', paddingVertical: 5 },
  costCell: { fontSize: 11, color: colors.text, fontFamily: font.mono },
  costHeaderText: { color: colors.textMuted, fontWeight: '600', fontSize: 10, textTransform: 'uppercase' },
});

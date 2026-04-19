import { colors, font, radius } from '../../theme';
/**
 * Model screen — v0.12 vocabulary.
 *
 * Three concepts on this screen:
 *   - **provider row** (anthropic+agno, anthropic+claude-cli, openai+agno…)
 *                      — a (name, framework) pair in the ``providers``
 *                      table, keyed on a surrogate integer ``id``. The
 *                      same vendor can exist twice: once with an API key
 *                      for agno dispatch, once without (claude-cli uses
 *                      the local ``claude`` binary / Pro/Max subscription).
 *   - **model**        (gpt-4o-mini, claude-sonnet-4-6, glm-5…) — the bare
 *                      vendor id. Lives in ``models.model`` with a
 *                      ``provider_id`` FK to ``providers.id``.
 *   - **runtime_id**   the derived composite string used in logs + session
 *                      pins — ``<provider>:<model>`` for agno,
 *                      ``claude-cli:<provider>:<model>`` for claude-cli.
 *
 * Add flow: pick a provider row → server does /api/models/available?
 * provider_id=N to surface the vendor's catalog → multi-pick → POST
 * /api/models with {provider_id, model}.
 */

import Feather from '@expo/vector-icons/Feather';
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { useConnection } from '../../stores/connection';
import {
  setBaseUrl,
  getProviders, addProvider, deleteProvider, testProvider,
  listDbModels, deleteDbModel, enableDbModel, disableDbModel,
  createDbModel, listAvailableModels,
  getUsage, getDailyUsage,
} from '../../services/api';
import Button from '../../components/Button';
import Card from '../../components/Card';
import CategorySidebar from '../../components/CategorySidebar';
import TabStrip from '../../components/TabStrip';
import ResponsiveSidebar from '../../components/ResponsiveSidebar';
import { useConfirm } from '../../components/ConfirmDialog';
import type {
  UsageData, DailyUsageEntry, ModelEntry, AvailableModel,
  ProviderConfig, ModelFramework,
} from '../../../common/types';

type CategoryId = 'overview' | 'providers' | 'models' | 'costs';

const CATEGORIES = [
  { id: 'overview' as const, label: 'Overview', icon: 'dollar-sign' as const, description: 'Usage summary' },
  { id: 'providers' as const, label: 'Providers', icon: 'key' as const, description: 'API keys' },
  { id: 'models' as const, label: 'Models', icon: 'cpu' as const, description: 'Routable models' },
  { id: 'costs' as const, label: 'Costs', icon: 'bar-chart-2' as const, description: 'Daily breakdown' },
];

const FALLBACK_PROVIDERS = [
  'anthropic', 'openai', 'google', 'zai', 'groq', 'mistral',
  'xai', 'deepseek', 'cerebras', 'openrouter', 'local',
];

export default function ModelScreen() {
  const connConfig = useConnection((s) => s.config);
  const confirm = useConfirm();

  const [activeCategory, setActiveCategory] = useState<CategoryId>('overview');

  // Providers (DB, one row per (name, framework) pair)
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; error?: string }>>({});
  const [testingProv, setTestingProv] = useState<number | null>(null);

  const [addingProv, setAddingProv] = useState(false);
  const [newProvName, setNewProvName] = useState('');
  const [newProvFramework, setNewProvFramework] = useState<ModelFramework>('agno');
  const [newProvKey, setNewProvKey] = useState('');
  const [newProvUrl, setNewProvUrl] = useState('');

  // Models (DB)
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [addingModel, setAddingModel] = useState(false);
  // The provider-row selected in the Add Model dialog.
  const [addProviderId, setAddProviderId] = useState<number | null>(null);
  const [available, setAvailable] = useState<AvailableModel[]>([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);

  // Usage
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsageEntry[]>([]);
  const [costDays, setCostDays] = useState(7);

  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!connConfig) return;
    // Four independent fetches — fire in parallel so the screen doesn't
    // serialise network latency. ``allSettled`` keeps a slow /api/usage
    // from blocking the providers/models panels on first render.
    const [provs, dbModels, usageRes, dailyRes] = await Promise.allSettled([
      getProviders(),
      listDbModels(),
      getUsage(),
      getDailyUsage(costDays),
    ]);
    if (provs.status === 'fulfilled') setProviders(provs.value || []);
    if (dbModels.status === 'fulfilled') setModels(dbModels.value);
    else setError(dbModels.reason?.message || String(dbModels.reason));
    if (usageRes.status === 'fulfilled') setUsage(usageRes.value);
    if (dailyRes.status === 'fulfilled') setDailyUsage(dailyRes.value);
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
    // claude-cli rows carry no api_key (the subprocess uses the Pro/Max
    // subscription); the backend rejects non-empty keys at the schema.
    const key = newProvFramework === 'claude-cli' ? undefined : newProvKey.trim() || undefined;
    try {
      await addProvider({
        name: newProvName.trim(),
        framework: newProvFramework,
        api_key: key,
        base_url: newProvUrl.trim() || undefined,
      });
      setAddingProv(false);
      setNewProvName('');
      setNewProvFramework('agno');
      setNewProvKey('');
      setNewProvUrl('');
      await reload();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const removeProvider = async (p: ProviderConfig) => {
    const ok = await confirm({
      title: 'Remove provider',
      message: `Remove provider "${p.name}" (${p.framework})?\n\nAll models registered under this row are cascade-deleted.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    await deleteProvider(p.id);
    await reload();
  };

  const testProv = async (p: ProviderConfig) => {
    setTestingProv(p.id);
    try {
      const r = await testProvider(p.id);
      setTestResults((prev) => ({ ...prev, [p.id]: r }));
    } catch (e: any) {
      setTestResults((prev) => ({ ...prev, [p.id]: { ok: false, error: e?.message || String(e) } }));
    }
    setTestingProv(null);
  };

  // ── Model ops ──

  const openAddModel = async (providerId: number) => {
    setAddProviderId(providerId);
    setAddingModel(true);
    setLoadingAvailable(true);
    try {
      const entries = await listAvailableModels(providerId);
      setAvailable(entries);
    } catch (e: any) {
      setAvailable([]);
      setError(e?.message || String(e));
    }
    setLoadingAvailable(false);
  };

  const registerModel = async (entry: AvailableModel) => {
    if (addProviderId == null) return;
    try {
      await createDbModel({
        provider_id: addProviderId,
        model: entry.id,
        display_name: entry.display_name,
      });
      await reload();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const toggleModel = async (m: ModelEntry) => {
    try {
      if (m.enabled) await disableDbModel(m.id);
      else await enableDbModel(m.id);
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
      await deleteDbModel(m.id);
      await reload();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  // ── Renders ──

  const sidebar = (
    <CategorySidebar<CategoryId>
      title="Models"
      active={activeCategory}
      onChange={setActiveCategory}
      categories={CATEGORIES}
      footer={
        usage ? (
          <View style={styles.sidebarFooter}>
            <Text style={styles.sidebarFooterLabel}>This Month</Text>
            <Text style={styles.sidebarFooterValue}>
              ${usage.monthly_spend.toFixed(2)}
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
        The smart router picks a model per incoming message based on a cheap classifier. Models live in the database
        (add them under Models). Provider credentials live there too (add them under Providers).
      </Text>

      <Card>
        <Text style={styles.label}>This month</Text>
        <Text style={styles.overviewValue}>
          {usage ? `$${usage.monthly_spend.toFixed(3)}` : '—'}
        </Text>
      </Card>
    </>
  );

  const renderProviders = () => {
    const existingKeys = new Set(providers.map((p) => `${p.name}:${p.framework}`));
    const duplicateAgno = newProvName
      && newProvFramework === 'agno'
      && existingKeys.has(`${newProvName}:agno`);
    const duplicateCli = newProvName
      && newProvFramework === 'claude-cli'
      && existingKeys.has(`${newProvName}:claude-cli`);

    return (
      <>
        <Text style={styles.sectionTitle}>Providers</Text>
        <Text style={styles.hint}>
          Each row is a (vendor, framework) pair — the same vendor can be added twice:
          once with an API key (Agno dispatch) and once without (claude-cli subscription).
        </Text>

        {providers.map((p) => (
          <View key={p.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.providerName}>
                {p.name}
                <Text style={styles.providerFramework}>  ·  {p.framework}</Text>
              </Text>
              <View style={styles.cardActions}>
                <TouchableOpacity onPress={() => testProv(p)} disabled={testingProv === p.id}>
                  <Text style={styles.actionLink}>{testingProv === p.id ? '…' : 'Test'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeProvider(p)}>
                  <Text style={[styles.actionLink, { color: colors.error }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.keyDisplay}>
              Key: {p.framework === 'claude-cli' ? 'subscription — no API key' : p.api_key_display}
            </Text>
            {p.base_url && <Text style={styles.keyDisplay}>URL: {p.base_url}</Text>}
            {testResults[p.id] && (
              <Text style={testResults[p.id].ok ? styles.testOk : styles.testFail}>
                {testResults[p.id].ok ? 'Connection OK' : `Failed: ${testResults[p.id].error}`}
              </Text>
            )}
          </View>
        ))}

        {addingProv ? (
          <View style={styles.card}>
            <Text style={styles.label}>Vendor</Text>
            <TextInput
              style={[styles.input, { marginBottom: 8 }]}
              value={newProvName}
              onChangeText={setNewProvName}
              placeholder="Type or pick below"
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.chipRow}>
              {FALLBACK_PROVIDERS.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.chip, newProvName === p && styles.chipActive]}
                  onPress={() => {
                    setNewProvName(p);
                    // Anthropic defaults to claude-cli unless an agno row
                    // already exists under that name.
                    if (p === 'anthropic' && !existingKeys.has('anthropic:claude-cli')) {
                      setNewProvFramework('claude-cli');
                    } else {
                      setNewProvFramework('agno');
                    }
                  }}
                >
                  <Text style={[styles.chipText, newProvName === p && styles.chipTextActive]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>Framework</Text>
            <View style={styles.chipRow}>
              <TouchableOpacity
                style={[styles.chip, newProvFramework === 'agno' && styles.chipActive]}
                onPress={() => setNewProvFramework('agno')}
              >
                <Text style={[styles.chipText, newProvFramework === 'agno' && styles.chipTextActive]}>agno (API)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, newProvFramework === 'claude-cli' && styles.chipActive]}
                onPress={() => setNewProvFramework('claude-cli')}
              >
                <Text style={[styles.chipText, newProvFramework === 'claude-cli' && styles.chipTextActive]}>
                  claude-cli (subscription)
                </Text>
              </TouchableOpacity>
            </View>
            {(duplicateAgno || duplicateCli) && (
              <Text style={styles.warnText}>
                {newProvName} already exists under {newProvFramework}. Pick the other framework.
              </Text>
            )}
            {newProvFramework === 'agno' && (
              <>
                <Text style={styles.label}>API Key</Text>
                <TextInput
                  style={styles.input}
                  value={newProvKey}
                  onChangeText={setNewProvKey}
                  placeholder="sk-..."
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                />
              </>
            )}
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
                setAddingProv(false); setNewProvName('');
                setNewProvFramework('agno'); setNewProvKey(''); setNewProvUrl('');
              }}>
                <Text style={{ color: colors.textMuted }}>Cancel</Text>
              </TouchableOpacity>
              <Button
                variant="primary" size="md" label="Add"
                onPress={submitAddProvider}
                disabled={!newProvName.trim() || !!duplicateAgno || !!duplicateCli}
              />
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
  };

  const renderModels = () => {
    // Group by provider row id so each (vendor, framework) pair owns a card.
    const byProviderId = new Map<number, ModelEntry[]>();
    for (const m of models) {
      const bucket = byProviderId.get(m.provider_id) ?? [];
      bucket.push(m);
      byProviderId.set(m.provider_id, bucket);
    }

    const noProviders = providers.length === 0;
    const noModels = models.length === 0;
    const selectedProvider = addProviderId != null
      ? providers.find((p) => p.id === addProviderId) ?? null
      : null;

    return (
      <>
        <Text style={styles.sectionTitle}>Models</Text>
        <Text style={styles.hint}>
          Each row is a (provider_row, model) pair. The smart router classifies each message and dispatches
          via the provider row's framework — Agno hits the vendor API, claude-cli hits the local Claude binary.
        </Text>

        {/* Empty-state CTA: no providers → no models possible. */}
        {noProviders && noModels && (
          <Card>
            <Text style={styles.emptyStateTitle}>No providers configured</Text>
            <Text style={styles.emptyStateBody}>
              Add a provider row first. For Anthropic-via-subscription, pick framework=claude-cli
              (no API key needed). For every other vendor (or Anthropic-via-API), pick framework=agno
              and supply the API key.
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

        {providers.map((p) => {
          const rows = byProviderId.get(p.id) ?? [];
          if (rows.length === 0) return null;
          return (
            <View key={p.id} style={{ marginBottom: 14 }}>
              <Text style={styles.frameworkHeader}>
                {p.name}
                <Text style={styles.frameworkSub}>  ·  {p.framework}</Text>
                {p.framework === 'claude-cli' && (
                  <Text style={styles.frameworkSub}>  ·  subscription billing</Text>
                )}
              </Text>
              <Card padded={false}>
                {rows.map((m, i) => (
                  <View key={m.id} style={[styles.row, i > 0 && styles.rowBorder]}>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowTitle}>
                        <Text style={styles.rowModel}>{m.model}</Text>
                        {m.display_name && (
                          <>
                            <Text style={styles.rowSep}>  ·  </Text>
                            <Text style={styles.rowProvider}>{m.display_name}</Text>
                          </>
                        )}
                      </Text>
                      {p.framework === 'claude-cli' ? (
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
          );
        })}

        {addingModel ? (
          <Card>
            <Text style={styles.label}>Provider row</Text>
            <View style={styles.chipRow}>
              {providers.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.chip, addProviderId === p.id && styles.chipActive]}
                  onPress={() => openAddModel(p.id)}
                >
                  <Text style={[styles.chipText, addProviderId === p.id && styles.chipTextActive]}>
                    {p.name}  ·  {p.framework}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {selectedProvider && (
              <>
                <Text style={styles.label}>
                  Available from {selectedProvider.name} ({selectedProvider.framework})
                </Text>
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
                setAddingModel(false); setAddProviderId(null); setAvailable([]);
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
  providerFramework: {
    fontSize: 11, fontWeight: '400', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  warnText: {
    fontSize: 11, color: colors.error, marginTop: 6, marginBottom: 2,
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

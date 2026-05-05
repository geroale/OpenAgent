/**
 * Workflows list screen — the new home of multi-block workflow
 * pipelines (n8n-style). Each row shows the workflow's name,
 * trigger kind, block count, last-run status, and the primary
 * actions: Run, Edit (Phase 4: opens visual editor), Delete.
 *
 * Lives at the same tab slot the old "automations" placeholder used
 * to occupy. Wired to /api/workflows — the workflow-manager MCP and
 * the scheduler loop read from the same SQLite row, so AI-initiated
 * changes (`create_workflow`, `add_block`, …) show up here on next
 * load without a restart.
 */

import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, font, radius } from '../../../theme';
import { useConnection } from '../../../stores/connection';
import { useEvents } from '../../../stores/events';
import { useWorkflows } from '../../../stores/workflows';
import { setBaseUrl } from '../../../services/api';
import { useConfirm } from '../../../components/ConfirmDialog';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import ThemedSwitch from '../../../components/ThemedSwitch';
import type {
  CreateWorkflowInput,
  WorkflowNode,
  WorkflowTask,
} from '../../../../common/types';

// Trigger-type → (label, icon). Keyed on the block type that appears
// inside the graph; a workflow badge renders the union of the types
// it carries so users see "Manual + Scheduled" at a glance.
const TRIGGER_LABELS: Record<string, string> = {
  'trigger-manual': 'Manual',
  'trigger-schedule': 'Scheduled',
  'trigger-ai': 'AI',
};

const TRIGGER_ICONS: Record<string, string> = {
  'trigger-manual': 'play-circle',
  'trigger-schedule': 'clock',
  'trigger-ai': 'cpu',
};

const EMPTY_CREATE: CreateWorkflowInput = {
  name: '',
  description: '',
};

// Fresh workflows get a single ``trigger-manual`` block so they're
// runnable from the Run button immediately. Users can add more
// triggers (scheduled, AI) inside the editor's palette if they want.
function initialGraphNodes(): WorkflowNode[] {
  return [
    {
      id: 'n1',
      type: 'trigger-manual',
      label: 'Run',
      position: { x: 120, y: 120 },
      config: {},
    },
  ];
}

export default function WorkflowsScreen() {
  const router = useRouter();
  const connConfig = useConnection((s) => s.config);
  const {
    workflows,
    loading,
    error,
    saved,
    runs,
    runningId,
    loadWorkflows,
    createWorkflow,
    deleteWorkflow,
    toggleWorkflow,
    runWorkflow,
    clearError,
  } = useWorkflows();

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateWorkflowInput>(EMPTY_CREATE);
  const confirm = useConfirm();

  useEffect(() => {
    if (connConfig) {
      if (connConfig.sidecarPort) setBaseUrl('127.0.0.1', connConfig.sidecarPort);
      void loadWorkflows();
    }
  }, [connConfig]);

  // Workflow-list refresh fires on every gateway-side change: chat-driven
  // create_workflow, manual run start/end, schedule tick. The store
  // already manages its own runningId, so a refetch never strands a
  // spinner.
  useEffect(() => {
    return useEvents.getState().subscribe('workflow', () => {
      void loadWorkflows();
    });
  }, [loadWorkflows]);

  const handleCreate = async () => {
    const name = form.name.trim();
    if (!name) return;
    // Seed every new workflow with a manual trigger so it can run
    // from the Run button without the user first opening the editor.
    // They can add a schedule trigger or AI trigger inside the editor
    // later.
    const created = await createWorkflow({
      ...form,
      name,
      nodes: initialGraphNodes(),
      edges: [],
    });
    if (created) {
      setCreating(false);
      setForm(EMPTY_CREATE);
      router.push(`/workflows/${created.id}` as any);
    }
  };

  const handleEdit = (wf: WorkflowTask) => {
    router.push(`/workflows/${wf.id}` as any);
  };

  const handleRun = async (wf: WorkflowTask) => {
    await runWorkflow(wf.id);
  };

  const handleDelete = async (wf: WorkflowTask) => {
    const confirmed = await confirm({
      title: 'Delete workflow',
      message: `Remove "${wf.name}"? Its run history will be deleted too.`,
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    await deleteWorkflow(wf.id);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Workflows</Text>
      <Text style={styles.hint}>
        Multi-block pipelines. Blocks can call MCP tools, run AI prompts,
        branch, loop or wait. Triggered manually, on a schedule, or by
        the AI itself.
      </Text>

      {loading && workflows.length === 0 ? (
        <View style={styles.loadingPane}>
          <ActivityIndicator size="small" color={colors.textMuted} />
        </View>
      ) : (
        <Card padded={false}>
          {workflows.length === 0 && !creating && (
            <Text style={styles.emptyText}>
              No workflows yet — create one to get started, or ask OpenAgent
              AI to build one for you.
            </Text>
          )}

          {workflows.map((wf, i) => {
            const lastRun = runs[wf.id];
            // ``trigger_types`` is server-decorated from the graph — an
            // array like ``['trigger-manual', 'trigger-schedule']``.
            // Empty means the workflow has no triggers (orphaned) and
            // can only be fired via the AI or an explicit API call.
            const triggers = wf.trigger_types ?? [];
            const scheduleCount = wf.schedules?.length ?? 0;
            const nextRunIso = wf.schedules?.[0]?.next_run_at_iso;
            const nodeCount = wf.graph?.nodes?.length ?? 0;
            const edgeCount = wf.graph?.edges?.length ?? 0;
            const isRunning = runningId === wf.id;
            return (
              <View
                key={wf.id}
                style={[styles.row, i > 0 && styles.rowBorder]}
                testID={`workflow-row-${wf.name}`}
              >
                <TouchableOpacity
                  style={styles.rowInfo}
                  onPress={() => handleEdit(wf)}
                  accessibilityLabel={`Open workflow ${wf.name}`}
                >
                  <View style={styles.rowHeader}>
                    {triggers.length > 0 ? (
                      triggers.map((t) => (
                        <View key={t} style={styles.triggerChipInline}>
                          <Feather
                            name={(TRIGGER_ICONS[t] || 'circle') as any}
                            size={11}
                            color={colors.primary}
                          />
                          <Text style={styles.triggerBadge}>
                            {TRIGGER_LABELS[t] || t.replace('trigger-', '')}
                          </Text>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.triggerBadgeMuted}>No triggers</Text>
                    )}
                    {scheduleCount > 0 && nextRunIso ? (
                      <Text style={styles.cronText}>
                        next {nextRunIso}
                        {scheduleCount > 1 ? ` (+${scheduleCount - 1})` : ''}
                      </Text>
                    ) : null}
                    <Text style={styles.blockCount}>
                      {nodeCount} block{nodeCount === 1 ? '' : 's'} ·{' '}
                      {edgeCount} edge{edgeCount === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <Text style={styles.name}>{wf.name}</Text>
                  {wf.description ? (
                    <Text style={styles.description} numberOfLines={2}>
                      {wf.description}
                    </Text>
                  ) : null}
                  {lastRun ? (
                    <Text
                      style={[
                        styles.lastRun,
                        lastRun.status === 'success' && styles.lastRunOk,
                        lastRun.status === 'failed' && styles.lastRunErr,
                      ]}
                    >
                      Last run: {lastRun.status}
                      {lastRun.error ? ` — ${lastRun.error}` : ''}
                    </Text>
                  ) : wf.last_run_at_iso ? (
                    <Text style={styles.lastRun}>
                      Last ran {wf.last_run_at_iso}
                    </Text>
                  ) : null}
                </TouchableOpacity>

                <View style={styles.rowActions}>
                  <ThemedSwitch
                    value={wf.enabled}
                    onValueChange={(v) => {
                      void toggleWorkflow(wf.id, v);
                    }}
                  />
                  <TouchableOpacity
                    onPress={() => {
                      void handleRun(wf);
                    }}
                    disabled={isRunning}
                    style={[styles.iconBtn, isRunning && styles.iconBtnDisabled]}
                    testID={`run-${wf.name}`}
                  >
                    {isRunning ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Feather name="play" size={14} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleEdit(wf)}
                    style={styles.iconBtn}
                    accessibilityLabel="Edit workflow"
                  >
                    <Feather name="edit-2" size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      void handleDelete(wf);
                    }}
                    style={styles.iconBtn}
                  >
                    <Feather name="x" size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

          {creating ? (
            <View style={styles.form}>
              <Text style={styles.formTitle}>New workflow</Text>
              <TextInput
                style={styles.input}
                value={form.name}
                onChangeText={(v) => setForm({ ...form, name: v })}
                placeholder="Name (unique)"
                placeholderTextColor={colors.textMuted}
              />
              {Platform.OS === 'web' ? (
                <textarea
                  value={form.description}
                  onChange={(e: any) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  placeholder="What does this workflow do?"
                  rows={2}
                  style={
                    {
                      backgroundColor: colors.inputBg,
                      borderRadius: 8,
                      border: `1px solid ${colors.border}`,
                      padding: 10,
                      color: colors.text,
                      fontSize: 13,
                      fontFamily: 'inherit',
                      resize: 'vertical',
                      outline: 'none',
                      width: '100%',
                      boxSizing: 'border-box',
                      marginBottom: 8,
                    } as any
                  }
                />
              ) : (
                <TextInput
                  style={[styles.input, { height: 60, textAlignVertical: 'top' }]}
                  value={form.description}
                  onChangeText={(v) => setForm({ ...form, description: v })}
                  placeholder="What does this workflow do?"
                  placeholderTextColor={colors.textMuted}
                  multiline
                />
              )}
              <Text style={styles.createHint}>
                Starts with a manual trigger so you can Run it right
                away. Add scheduled or AI triggers from the editor's
                block palette.
              </Text>
              <View style={styles.formActions}>
                <Button
                  variant="ghost"
                  size="sm"
                  label="Cancel"
                  onPress={() => {
                    setCreating(false);
                    setForm(EMPTY_CREATE);
                    clearError();
                  }}
                />
                <Button
                  variant="primary"
                  size="sm"
                  label="Create"
                  onPress={() => {
                    void handleCreate();
                  }}
                />
              </View>
            </View>
          ) : (
            <View style={styles.addBar}>
              <Button
                variant="primary"
                label="New Workflow"
                icon="plus"
                fullWidth
                onPress={() => {
                  setCreating(true);
                  setForm(EMPTY_CREATE);
                }}
              />
            </View>
          )}
        </Card>
      )}

      {saved && <Text style={styles.savedMsg}>Saved</Text>}
      {error && <Text style={styles.errorMsg}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: 24,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 4,
    fontFamily: font.display,
    letterSpacing: -0.3,
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 14,
    lineHeight: 17,
  },
  loadingPane: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    padding: 18,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 17,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  rowInfo: { flex: 1, marginRight: 10 },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 3,
    gap: 4,
  },
  triggerIcon: { marginRight: 4 },
  triggerChipInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 4,
  },
  triggerBadge: {
    fontSize: 10,
    color: colors.primary,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  triggerBadgeMuted: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '500',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginRight: 8,
    fontStyle: 'italic',
  },
  cronText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontFamily: font.mono,
    marginRight: 8,
  },
  blockCount: {
    fontSize: 10,
    color: colors.textMuted,
    marginLeft: 'auto',
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.1,
  },
  description: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 3,
    lineHeight: 17,
  },
  lastRun: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 6,
  },
  lastRunOk: { color: colors.success },
  lastRunErr: { color: colors.error },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  iconBtn: { padding: 6 },
  iconBtnDisabled: { opacity: 0.5 },
  form: {
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  formTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 11,
    paddingVertical: 9,
    color: colors.text,
    fontSize: 12,
    marginBottom: 8,
  },
  createHint: {
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 16,
    marginBottom: 10,
    fontStyle: 'italic',
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 6,
  },
  addBar: {
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  savedMsg: {
    marginTop: 10,
    fontSize: 12,
    color: colors.success,
    textAlign: 'center',
  },
  errorMsg: {
    marginTop: 10,
    fontSize: 12,
    color: colors.error,
    textAlign: 'center',
  },
});

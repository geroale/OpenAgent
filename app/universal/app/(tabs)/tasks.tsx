import { colors } from '../../theme';
/**
 * Tasks screen — view and manage scheduled cron tasks.
 *
 * Tasks live in the backend SQLite database, served over
 * /api/scheduled-tasks. Changes take effect within ~30 seconds (the
 * scheduler's next tick) — no restart required.
 *
 * The only config-backed piece is the global `scheduler.enabled` kill
 * switch, which still flips via PATCH /api/config/scheduler.
 */

import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform,
} from 'react-native';
import { useConnection } from '../../stores/connection';
import { useConfig } from '../../stores/config';
import { useTasks } from '../../stores/tasks';
import { setBaseUrl } from '../../services/api';
import { useConfirm } from '../../components/ConfirmDialog';
import PrimaryButton from '../../components/PrimaryButton';
import ThemedSwitch from '../../components/ThemedSwitch';
import type { ScheduledTask } from '../../../common/types';

interface TaskForm {
  name: string;
  cron_expression: string;
  prompt: string;
}

const EMPTY_FORM: TaskForm = { name: '', cron_expression: '', prompt: '' };

export default function TasksScreen() {
  const connConfig = useConnection((s) => s.config);
  const { config: agentConfig, loadConfig, updateSection } = useConfig();
  const {
    tasks, error, saved,
    loadTasks, createTask, updateTask, deleteTask, toggleTask,
  } = useTasks();

  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<TaskForm>(EMPTY_FORM);
  const confirm = useConfirm();

  useEffect(() => {
    if (connConfig) {
      setBaseUrl(connConfig.host, connConfig.port);
      loadConfig();
      loadTasks();
    }
  }, [connConfig]);

  const schedulerEnabled = agentConfig?.scheduler?.enabled ?? false;

  const toggleScheduler = async (val: boolean) => {
    // scheduler.enabled is the only remaining config-backed field;
    // scheduler.tasks is deprecated and not sent here.
    await updateSection('scheduler', { enabled: val });
  };

  const handleRemove = async (id: string) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const confirmed = await confirm({
      title: 'Remove Task',
      message: `Remove task "${t.name}"?`,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;
    await deleteTask(id);
  };

  const handleEdit = (t: ScheduledTask) => {
    setEditId(t.id);
    setForm({ name: t.name, cron_expression: t.cron_expression, prompt: t.prompt });
    setAdding(true);
  };

  const handleSaveForm = async () => {
    if (!form.name.trim() || !form.cron_expression.trim() || !form.prompt.trim()) return;
    const ok = editId !== null
      ? await updateTask(editId, form)
      : await createTask(form);
    if (ok) {
      setAdding(false);
      setEditId(null);
      setForm(EMPTY_FORM);
    }
  };

  const handleCancel = () => {
    setAdding(false);
    setEditId(null);
    setForm(EMPTY_FORM);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Scheduled Tasks</Text>
      <Text style={styles.hint}>
        Cron tasks stored in the database. Changes take effect within ~30 seconds.
      </Text>

      {/* Scheduler toggle */}
      <View style={styles.toggleCard}>
        <Text style={styles.toggleLabel}>Scheduler Enabled</Text>
        <ThemedSwitch
          value={schedulerEnabled}
          onValueChange={toggleScheduler}
        />
      </View>

      {/* Task list */}
      <View style={styles.card}>
        {tasks.length === 0 && !adding && (
          <Text style={styles.emptyText}>No scheduled tasks</Text>
        )}

        {tasks.map((task, i) => (
          <View key={task.id} style={[styles.taskRow, i > 0 && styles.taskRowBorder]}>
            <TouchableOpacity style={styles.taskInfo} onPress={() => handleEdit(task)}>
              <Text style={styles.taskName}>{task.name}</Text>
              <Text style={styles.taskCron}>{task.cron_expression}</Text>
              <Text style={styles.taskPrompt} numberOfLines={2}>{task.prompt}</Text>
            </TouchableOpacity>
            <View style={styles.taskActions}>
              <ThemedSwitch
                value={task.enabled}
                onValueChange={(v) => { void toggleTask(task.id, v); }}
              />
              <TouchableOpacity onPress={() => handleEdit(task)} style={styles.editBtn}>
                <Feather name="edit-2" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { void handleRemove(task.id); }} style={styles.removeBtn}>
                <Feather name="x" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {/* Add/edit form */}
        {adding ? (
          <View style={styles.addForm}>
            <Text style={styles.formTitle}>{editId !== null ? 'Edit Task' : 'New Task'}</Text>
            <TextInput
              style={styles.input}
              value={form.name}
              onChangeText={(v) => setForm({ ...form, name: v })}
              placeholder="Name (e.g. health-check)"
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              style={styles.input}
              value={form.cron_expression}
              onChangeText={(v) => setForm({ ...form, cron_expression: v })}
              placeholder="Cron (e.g. */30 * * * *)"
              placeholderTextColor={colors.textMuted}
            />
            {Platform.OS === 'web' ? (
              <textarea
                value={form.prompt}
                onChange={(e: any) => setForm({ ...form, prompt: e.target.value })}
                placeholder="Prompt — what should the agent do?"
                rows={4}
                style={{
                  backgroundColor: colors.inputBg, borderRadius: 8, border: `1px solid ${colors.border}`,
                  padding: 10, color: colors.text, fontSize: 13, fontFamily: 'inherit',
                  resize: 'vertical', outline: 'none', width: '100%', boxSizing: 'border-box',
                  marginBottom: 8,
                } as any}
              />
            ) : (
              <TextInput
                style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                value={form.prompt}
                onChangeText={(v) => setForm({ ...form, prompt: v })}
                placeholder="Prompt"
                placeholderTextColor={colors.textMuted}
                multiline
              />
            )}
            <View style={styles.formActions}>
              <TouchableOpacity onPress={handleCancel} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <PrimaryButton style={styles.saveBtn} contentStyle={styles.saveBtnInner} onPress={handleSaveForm}>
                <Text style={styles.saveBtnText}>{editId !== null ? 'Update' : 'Add Task'}</Text>
              </PrimaryButton>
            </View>
          </View>
        ) : (
          <PrimaryButton
            style={styles.addBtn}
            contentStyle={styles.addBtnInner}
            onPress={() => { setAdding(true); setEditId(null); setForm(EMPTY_FORM); }}
          >
            <View style={styles.addBtnContent}>
              <Feather name="plus" size={14} color={colors.textInverse} />
              <Text style={styles.addBtnText}>Add Task</Text>
            </View>
          </PrimaryButton>
        )}
      </View>

      {saved && (
        <Text style={styles.savedMsg}>Saved</Text>
      )}
      {error && (
        <Text style={styles.errorMsg}>{error}</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, maxWidth: 600, width: "100%", alignSelf: "center" },
  title: { fontSize: 17, fontWeight: '600', color: colors.text, marginBottom: 4 },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: 16 },
  toggleCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    padding: 16, marginBottom: 16,
  },
  toggleLabel: { fontSize: 14, color: colors.text, fontWeight: '500' },
  card: {
    backgroundColor: colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border, padding: 4,
  },
  emptyText: { padding: 16, fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  taskRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 12, paddingHorizontal: 12,
  },
  taskRowBorder: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  taskInfo: { flex: 1 },
  taskName: { fontSize: 14, fontWeight: '600', color: colors.text },
  taskCron: { fontSize: 12, color: colors.primary, fontFamily: 'monospace', marginTop: 2 },
  taskPrompt: { fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 18 },
  taskActions: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 8 },
  editBtn: { padding: 6 },
  removeBtn: { padding: 6 },
  addBtn: { padding: 12, borderTopWidth: 1, borderTopColor: colors.borderLight },
  addBtnInner: { minHeight: 40, borderRadius: 8 },
  addBtnContent: { flexDirection: 'row', alignItems: 'center' },
  addBtnText: { fontSize: 13, color: colors.textInverse, fontWeight: '700', marginLeft: 8 },
  addForm: { padding: 12, borderTopWidth: 1, borderTopColor: colors.borderLight },
  formTitle: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 },
  input: {
    backgroundColor: colors.inputBg, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    padding: 10, color: colors.text, fontSize: 13, marginBottom: 8,
  },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  cancelBtn: { padding: 8 },
  cancelBtnText: { color: colors.textMuted, fontSize: 13 },
  saveBtn: {},
  saveBtnInner: { minHeight: 34, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  saveBtnText: { color: colors.textInverse, fontSize: 13, fontWeight: '700' },
  savedMsg: { marginTop: 12, fontSize: 13, color: colors.success, textAlign: 'center' },
  errorMsg: { marginTop: 12, fontSize: 13, color: '#e55', textAlign: 'center' },
});

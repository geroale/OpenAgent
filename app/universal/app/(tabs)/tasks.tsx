import { colors, font, radius } from '../../theme';
/**
 * Tasks screen — view and manage scheduled cron tasks.
 *
 * Tasks live in the backend SQLite database, served over
 * /api/scheduled-tasks. Changes take effect within ~30 seconds (the
 * scheduler's next tick) — no restart required. The scheduler runs
 * whenever the agent has a DB attached; there is no yaml kill switch.
 */

import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform,
} from 'react-native';
import { useConnection } from '../../stores/connection';
import { useTasks } from '../../stores/tasks';
import { setBaseUrl } from '../../services/api';
import { useConfirm } from '../../components/ConfirmDialog';
import Button from '../../components/Button';
import Card from '../../components/Card';
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
      loadTasks();
    }
  }, [connConfig]);

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

      {/* Task list */}
      <Card padded={false}>
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
              <Button variant="ghost" size="sm" label="Cancel" onPress={handleCancel} />
              <Button
                variant="primary"
                size="sm"
                label={editId !== null ? 'Update' : 'Add Task'}
                onPress={handleSaveForm}
              />
            </View>
          </View>
        ) : (
          <View style={{ padding: 10, borderTopWidth: 1, borderTopColor: colors.borderLight }}>
            <Button
              variant="primary"
              label="Add Task"
              icon="plus"
              fullWidth
              onPress={() => { setAdding(true); setEditId(null); setForm(EMPTY_FORM); }}
            />
          </View>
        )}
      </Card>

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
  content: { padding: 24, maxWidth: 640, width: "100%", alignSelf: "center" },
  title: {
    fontSize: 18, fontWeight: '500', color: colors.text, marginBottom: 4,
    fontFamily: font.display, letterSpacing: -0.3,
  },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: 14 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: 2,
  },
  emptyText: { padding: 14, fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  taskRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 11, paddingHorizontal: 12,
  },
  taskRowBorder: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  taskInfo: { flex: 1 },
  taskName: { fontSize: 13, fontWeight: '600', color: colors.text, letterSpacing: -0.1 },
  taskCron: { fontSize: 11, color: colors.primary, fontFamily: font.mono, marginTop: 2 },
  taskPrompt: { fontSize: 11.5, color: colors.textSecondary, marginTop: 4, lineHeight: 17 },
  taskActions: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 8 },
  editBtn: { padding: 6 },
  removeBtn: { padding: 6 },
  addBtn: { padding: 10, borderTopWidth: 1, borderTopColor: colors.borderLight },
  addBtnInner: { minHeight: 34, borderRadius: radius.sm },
  addBtnContent: { flexDirection: 'row', alignItems: 'center' },
  addBtnText: { fontSize: 12, color: colors.textInverse, fontWeight: '600', marginLeft: 6 },
  addForm: { padding: 12, borderTopWidth: 1, borderTopColor: colors.borderLight },
  formTitle: {
    fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 8,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.inputBg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 11, paddingVertical: 9,
    color: colors.text, fontSize: 12, marginBottom: 6, fontFamily: font.mono,
  },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginTop: 4 },
  cancelBtn: { padding: 6 },
  cancelBtnText: { color: colors.textMuted, fontSize: 12 },
  saveBtn: {},
  saveBtnInner: { minHeight: 30, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm },
  saveBtnText: { color: colors.textInverse, fontSize: 12, fontWeight: '600' },
  savedMsg: { marginTop: 10, fontSize: 12, color: colors.success, textAlign: 'center' },
  errorMsg: { marginTop: 10, fontSize: 12, color: colors.error, textAlign: 'center' },
});

import { colors } from '../../theme';
/**
 * Tasks screen — view and manage scheduled cron tasks.
 */

import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Switch, Platform,
} from 'react-native';
import { useConnection } from '../../stores/connection';
import { useConfig } from '../../stores/config';
import { setBaseUrl } from '../../services/api';

interface Task {
  name: string;
  cron: string;
  prompt: string;
  enabled?: boolean;
}

export default function TasksScreen() {
  const connConfig = useConnection((s) => s.config);
  const { config: agentConfig, loadConfig, updateSection } = useConfig();
  const [adding, setAdding] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [form, setForm] = useState<Task>({ name: '', cron: '', prompt: '' });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (connConfig) {
      setBaseUrl(connConfig.host, connConfig.port);
      loadConfig();
    }
  }, [connConfig]);

  const tasks: Task[] = agentConfig?.scheduler?.tasks || [];
  const schedulerEnabled = agentConfig?.scheduler?.enabled ?? false;

  const saveTasks = async (updated: Task[]) => {
    const ok = await updateSection('scheduler', {
      enabled: schedulerEnabled,
      tasks: updated,
    });
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const toggleScheduler = async (val: boolean) => {
    await updateSection('scheduler', { enabled: val, tasks });
  };

  const handleRemove = (idx: number) => {
    const t = tasks[idx];
    if (!window.confirm(`Remove task "${t.name}"?`)) return;
    const updated = tasks.filter((_, i) => i !== idx);
    saveTasks(updated);
  };

  const handleEdit = (idx: number) => {
    setEditIdx(idx);
    setForm({ ...tasks[idx] });
    setAdding(true);
  };

  const handleSaveForm = () => {
    if (!form.name.trim() || !form.cron.trim() || !form.prompt.trim()) return;
    let updated: Task[];
    if (editIdx !== null) {
      updated = tasks.map((t, i) => (i === editIdx ? form : t));
    } else {
      updated = [...tasks, form];
    }
    saveTasks(updated);
    setAdding(false);
    setEditIdx(null);
    setForm({ name: '', cron: '', prompt: '' });
  };

  const handleCancel = () => {
    setAdding(false);
    setEditIdx(null);
    setForm({ name: '', cron: '', prompt: '' });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Scheduled Tasks</Text>
      <Text style={styles.hint}>
        Cron tasks stored in config. Changes require restart.
      </Text>

      {/* Scheduler toggle */}
      <View style={styles.toggleCard}>
        <Text style={styles.toggleLabel}>Scheduler Enabled</Text>
        <Switch
          value={schedulerEnabled}
          onValueChange={toggleScheduler}
          trackColor={{ false: '#DDD', true: colors.primary }}
          thumbColor="#FFF"
        />
      </View>

      {/* Task list */}
      <View style={styles.card}>
        {tasks.length === 0 && !adding && (
          <Text style={styles.emptyText}>No scheduled tasks</Text>
        )}

        {tasks.map((task, i) => (
          <View key={i} style={[styles.taskRow, i > 0 && styles.taskRowBorder]}>
            <TouchableOpacity style={styles.taskInfo} onPress={() => handleEdit(i)}>
              <Text style={styles.taskName}>{task.name}</Text>
              <Text style={styles.taskCron}>{task.cron}</Text>
              <Text style={styles.taskPrompt} numberOfLines={2}>{task.prompt}</Text>
            </TouchableOpacity>
            <View style={styles.taskActions}>
              <TouchableOpacity onPress={() => handleEdit(i)} style={styles.editBtn}>
                <Text style={styles.editBtnText}>✏️</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleRemove(i)} style={styles.removeBtn}>
                <Text style={styles.removeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {/* Add/edit form */}
        {adding ? (
          <View style={styles.addForm}>
            <Text style={styles.formTitle}>{editIdx !== null ? 'Edit Task' : 'New Task'}</Text>
            <TextInput
              style={styles.input}
              value={form.name}
              onChangeText={(v) => setForm({ ...form, name: v })}
              placeholder="Name (e.g. health-check)"
              placeholderTextColor="#999"
            />
            <TextInput
              style={styles.input}
              value={form.cron}
              onChangeText={(v) => setForm({ ...form, cron: v })}
              placeholder="Cron (e.g. */30 * * * *)"
              placeholderTextColor="#999"
            />
            {Platform.OS === 'web' ? (
              <textarea
                value={form.prompt}
                onChange={(e: any) => setForm({ ...form, prompt: e.target.value })}
                placeholder="Prompt — what should the agent do?"
                rows={4}
                style={{
                  backgroundColor: '#F5F5F5', borderRadius: 8, border: '1px solid #E8E8E8',
                  padding: 10, color: '#1a1a1a', fontSize: 13, fontFamily: 'inherit',
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
                placeholderTextColor="#999"
                multiline
              />
            )}
            <View style={styles.formActions}>
              <TouchableOpacity onPress={handleCancel} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSaveForm} style={styles.saveBtn}>
                <Text style={styles.saveBtnText}>{editIdx !== null ? 'Update' : 'Add Task'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => { setAdding(true); setEditIdx(null); setForm({ name: '', cron: '', prompt: '' }); }}
          >
            <Text style={styles.addBtnText}>+ Add Task</Text>
          </TouchableOpacity>
        )}
      </View>

      {saved && (
        <Text style={styles.savedMsg}>✓ Saved (restart required)</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },
  content: { padding: 24, maxWidth: 600, width: "100%", alignSelf: "center" },
  title: { fontSize: 17, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  hint: { fontSize: 12, color: '#999', marginBottom: 16 },
  toggleCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#FFF', borderRadius: 10, borderWidth: 1, borderColor: '#EBEBEB',
    padding: 16, marginBottom: 16,
  },
  toggleLabel: { fontSize: 14, color: '#1a1a1a', fontWeight: '500' },
  card: {
    backgroundColor: '#FFF', borderRadius: 10,
    borderWidth: 1, borderColor: '#EBEBEB', padding: 4,
  },
  emptyText: { padding: 16, fontSize: 13, color: '#999', textAlign: 'center' },
  taskRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 12, paddingHorizontal: 12,
  },
  taskRowBorder: { borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  taskInfo: { flex: 1 },
  taskName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  taskCron: { fontSize: 12, color: colors.primary, fontFamily: 'monospace', marginTop: 2 },
  taskPrompt: { fontSize: 12, color: '#888', marginTop: 4, lineHeight: 18 },
  taskActions: { flexDirection: 'row', gap: 4, marginLeft: 8 },
  editBtn: { padding: 6 },
  editBtnText: { fontSize: 14 },
  removeBtn: { padding: 6 },
  removeBtnText: { fontSize: 12, color: '#CCC' },
  addBtn: { padding: 12, borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  addBtnText: { fontSize: 13, color: colors.primary, fontWeight: '500' },
  addForm: { padding: 12, borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  formTitle: { fontSize: 14, fontWeight: '600', color: '#1a1a1a', marginBottom: 8 },
  input: {
    backgroundColor: '#F5F5F5', borderRadius: 8, borderWidth: 1, borderColor: '#E8E8E8',
    padding: 10, color: '#1a1a1a', fontSize: 13, marginBottom: 8,
  },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  cancelBtn: { padding: 8 },
  cancelBtnText: { color: '#999', fontSize: 13 },
  saveBtn: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 6 },
  saveBtnText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  savedMsg: { marginTop: 12, fontSize: 13, color: '#4CAF50', textAlign: 'center' },
});

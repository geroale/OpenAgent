import { colors, font, radius } from '../../theme';
/**
 * MCPs screen — DB-backed CRUD against /api/mcps.
 *
 * Rows live in the ``mcps`` SQLite table managed by the server. The
 * ``mcp-manager`` MCP writes to the same table from within the agent,
 * so both surfaces stay in sync; the gateway hot-reloads the pool on
 * the next message when ``updated_at`` changes.
 */

import Feather from '@expo/vector-icons/Feather';
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { useConnection } from '../../stores/connection';
import {
  setBaseUrl, listMcps, deleteMcp, createMcp, enableMcp, disableMcp,
} from '../../services/api';
import type { MCPEntry } from '../../../common/types';
import { useConfirm } from '../../components/ConfirmDialog';
import Button from '../../components/Button';
import Card from '../../components/Card';
import CategorySidebar from '../../components/CategorySidebar';
import ResponsiveSidebar from '../../components/ResponsiveSidebar';
import ThemedSwitch from '../../components/ThemedSwitch';

type CategoryId = 'default' | 'custom';

export default function McpsScreen() {
  const config = useConnection((s) => s.config);
  const [mcps, setMcps] = useState<MCPEntry[]>([]);
  const [activeCategory, setActiveCategory] = useState<CategoryId>('default');
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  const refresh = useCallback(async () => {
    try {
      const rows = await listMcps();
      setMcps(rows);
      setError(null);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, []);

  useEffect(() => {
    if (config) {
      setBaseUrl(config.host, config.port);
      refresh();
    }
  }, [config, refresh]);

  const toggle = async (entry: MCPEntry) => {
    try {
      if (entry.enabled) await disableMcp(entry.name);
      else await enableMcp(entry.name);
      await refresh();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const remove = async (entry: MCPEntry) => {
    const confirmed = await confirm({
      title: 'Remove MCP',
      message: `Remove MCP "${entry.name}"?`,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;
    try {
      await deleteMcp(entry.name);
      await refresh();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const addCustom = async () => {
    if (!newName.trim()) return;
    const payload: Partial<MCPEntry> & { name: string } = { name: newName.trim() };
    if (newUrl.trim()) payload.url = newUrl.trim();
    else if (newCommand.trim()) payload.command = newCommand.trim().split(/\s+/);
    else return;
    try {
      await createMcp(payload);
      setNewName('');
      setNewCommand('');
      setNewUrl('');
      setAddingNew(false);
      await refresh();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const defaults = mcps.filter((m) => m.kind !== 'custom');
  const customs = mcps.filter((m) => m.kind === 'custom');

  const sidebarContent = (
    <CategorySidebar<CategoryId>
      title="MCPs"
      active={activeCategory}
      onChange={setActiveCategory}
      categories={[
        { id: 'default', label: 'Default', icon: 'package', description: 'Bundled + enabled builtins' },
        { id: 'custom', label: 'Custom', icon: 'plus-square', description: 'User-added servers' },
      ]}
    />
  );

  const describe = (entry: MCPEntry): string => {
    if (entry.builtin_name) return `builtin: ${entry.builtin_name}`;
    if (entry.url) return entry.url;
    if (entry.command && entry.command.length) return entry.command.join(' ');
    return '—';
  };

  const renderRows = (rows: MCPEntry[], emptyMsg: string) => (
    <Card padded={false}>
      {rows.length === 0 && !addingNew && (
        <Text style={styles.emptyText}>{emptyMsg}</Text>
      )}
      {rows.map((entry, i) => (
        <View key={entry.name} style={[styles.row, i > 0 && styles.rowBorder]}>
          <View style={styles.mcpInfo}>
            <Text style={styles.mcpName}>{entry.name}</Text>
            <Text style={styles.mcpDesc}>{describe(entry)}</Text>
            {entry.env && Object.keys(entry.env).length > 0 && (
              <Text style={styles.mcpEnv}>env: {Object.keys(entry.env).join(', ')}</Text>
            )}
          </View>
          <ThemedSwitch value={entry.enabled} onValueChange={() => toggle(entry)} />
          {entry.kind === 'custom' && (
            <TouchableOpacity onPress={() => remove(entry)} style={styles.removeBtn}>
              <Feather name="x" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      ))}
    </Card>
  );

  return (
    <ResponsiveSidebar sidebar={sidebarContent}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {error && <Text style={styles.error}>{error}</Text>}
        {activeCategory === 'default' ? (
          <>
            <Text style={styles.sectionTitle}>Default MCPs</Text>
            <Text style={styles.sectionHint}>
              Bundled with OpenAgent. Toggle to enable/disable — takes effect on the next message.
            </Text>
            {renderRows(defaults, 'No default MCPs loaded')}
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Custom MCPs</Text>
            <Text style={styles.sectionHint}>
              Extra MCP servers you've added. Changes are live on the next message.
            </Text>
            {renderRows(customs, 'No custom MCPs configured')}
            {addingNew ? (
              <Card padded={false}>
                <View style={styles.addForm}>
                  <TextInput
                    style={styles.input}
                    value={newName}
                    onChangeText={setNewName}
                    placeholder="Name (e.g. github)"
                    placeholderTextColor={colors.textMuted}
                  />
                  <TextInput
                    style={styles.input}
                    value={newCommand}
                    onChangeText={setNewCommand}
                    placeholder="Command (e.g. github-mcp-server stdio)"
                    placeholderTextColor={colors.textMuted}
                  />
                  <TextInput
                    style={styles.input}
                    value={newUrl}
                    onChangeText={setNewUrl}
                    placeholder="Or URL (e.g. http://localhost:8000/mcp)"
                    placeholderTextColor={colors.textMuted}
                  />
                  <View style={styles.addFormActions}>
                    <Button variant="ghost" size="sm" label="Cancel" onPress={() => setAddingNew(false)} />
                    <Button variant="primary" size="sm" label="Add MCP" onPress={addCustom} />
                  </View>
                </View>
              </Card>
            ) : (
              <View style={styles.addBtnWrap}>
                <Button
                  variant="primary"
                  label="Add MCP Server"
                  icon="plus"
                  fullWidth
                  onPress={() => setAddingNew(true)}
                />
              </View>
            )}
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </ResponsiveSidebar>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, maxWidth: 640, width: '100%', alignSelf: 'center' },
  sectionTitle: {
    fontSize: 18, fontWeight: '500', color: colors.text, marginBottom: 4,
    fontFamily: font.display, letterSpacing: -0.3,
  },
  sectionHint: { fontSize: 12, color: colors.textMuted, marginBottom: 12, lineHeight: 17 },
  error: { color: colors.danger, marginBottom: 12, fontSize: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 12,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  mcpInfo: { flex: 1 },
  mcpName: { fontSize: 13, fontWeight: '600', color: colors.text, fontFamily: font.mono },
  mcpDesc: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
  mcpEnv: { fontSize: 10.5, color: colors.textMuted, marginTop: 2, fontFamily: font.mono },
  removeBtn: { padding: 6, marginLeft: 8 },
  emptyText: { padding: 14, fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  addBtnWrap: { marginTop: 10 },
  addForm: { padding: 12 },
  input: {
    backgroundColor: colors.inputBg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 11, paddingVertical: 9,
    color: colors.text, fontSize: 12, marginBottom: 6, fontFamily: font.mono,
  },
  addFormActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginTop: 4 },
});

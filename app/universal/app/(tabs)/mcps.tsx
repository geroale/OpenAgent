import { colors } from '../../theme';
/**
 * MCPs screen — view default MCPs (read-only) and manage custom MCPs.
 */

import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Switch,
} from 'react-native';
import { useConnection } from '../../stores/connection';
import { useConfig } from '../../stores/config';
import { setBaseUrl } from '../../services/api';

const DEFAULT_MCPS = [
  { name: 'vault', desc: 'Obsidian-compatible markdown notes (mcpvault)' },
  { name: 'filesystem', desc: 'Read, write, list, search files' },
  { name: 'editor', desc: 'Find-replace, grep, glob' },
  { name: 'web-search', desc: 'Web search + page fetch' },
  { name: 'shell', desc: 'Cross-platform shell execution' },
  { name: 'computer-control', desc: 'Screenshot, mouse, keyboard' },
  { name: 'chrome-devtools', desc: 'Browser automation, DOM inspection' },
  { name: 'messaging', desc: 'Send Telegram/Discord/WhatsApp messages' },
  { name: 'scheduler', desc: 'Manage cron tasks from conversations' },
];

export default function McpsScreen() {
  const config = useConnection((s) => s.config);
  const { config: agentConfig, loadConfig, updateSection } = useConfig();
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newUrl, setNewUrl] = useState('');

  useEffect(() => {
    if (config) {
      setBaseUrl(config.host, config.port);
      loadConfig();
    }
  }, [config]);

  const disabled = agentConfig?.mcp_disable || [];
  const customMcps = agentConfig?.mcp || [];

  const toggleDefault = async (name: string) => {
    const current = [...disabled];
    const idx = current.indexOf(name);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(name);
    await updateSection('mcp_disable', current);
  };

  const removeCustom = async (name: string) => {
    if (!window.confirm(`Remove MCP "${name}"?`)) return;
    const updated = customMcps.filter((m) => m.name !== name);
    await updateSection('mcp', updated);
  };

  const addCustom = async () => {
    if (!newName.trim()) return;
    const entry: any = { name: newName.trim() };
    if (newUrl.trim()) entry.url = newUrl.trim();
    else if (newCommand.trim()) entry.command = newCommand.trim().split(/\s+/);
    const updated = [...customMcps, entry];
    const ok = await updateSection('mcp', updated);
    if (ok) {
      setNewName('');
      setNewCommand('');
      setNewUrl('');
      setAddingNew(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Default MCPs */}
      <Text style={styles.sectionTitle}>Default MCPs</Text>
      <Text style={styles.sectionHint}>
        Bundled with OpenAgent. Toggle to enable/disable. Restart required.
      </Text>
      <View style={styles.card}>
        {DEFAULT_MCPS.map((mcp, i) => (
          <View key={mcp.name} style={[styles.row, i > 0 && styles.rowBorder]}>
            <View style={styles.mcpInfo}>
              <Text style={styles.mcpName}>{mcp.name}</Text>
              <Text style={styles.mcpDesc}>{mcp.desc}</Text>
            </View>
            <Switch
              value={!disabled.includes(mcp.name)}
              onValueChange={() => toggleDefault(mcp.name)}
              trackColor={{ false: '#DDD', true: colors.primary }}
              thumbColor="#FFF"
            />
          </View>
        ))}
      </View>

      {/* Custom MCPs */}
      <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Custom MCPs</Text>
      <Text style={styles.sectionHint}>
        User-configured MCP servers from openagent.yaml
      </Text>
      <View style={styles.card}>
        {customMcps.length === 0 && !addingNew && (
          <Text style={styles.emptyText}>No custom MCPs configured</Text>
        )}
        {customMcps.map((mcp, i) => (
          <View key={mcp.name} style={[styles.row, i > 0 && styles.rowBorder]}>
            <View style={styles.mcpInfo}>
              <Text style={styles.mcpName}>{mcp.name}</Text>
              <Text style={styles.mcpDesc}>
                {mcp.url || (mcp.command || []).join(' ')}
              </Text>
              {mcp.env && Object.keys(mcp.env).length > 0 && (
                <Text style={styles.mcpEnv}>
                  env: {Object.keys(mcp.env).join(', ')}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={() => removeCustom(mcp.name)} style={styles.removeBtn}>
              <Text style={styles.removeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}

        {/* Add new form */}
        {addingNew ? (
          <View style={styles.addForm}>
            <TextInput
              style={styles.input}
              value={newName}
              onChangeText={setNewName}
              placeholder="Name (e.g. github)"
              placeholderTextColor="#999"
            />
            <TextInput
              style={styles.input}
              value={newCommand}
              onChangeText={setNewCommand}
              placeholder="Command (e.g. github-mcp-server stdio)"
              placeholderTextColor="#999"
            />
            <TextInput
              style={styles.input}
              value={newUrl}
              onChangeText={setNewUrl}
              placeholder="Or URL (e.g. http://localhost:8000/mcp)"
              placeholderTextColor="#999"
            />
            <View style={styles.addFormActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setAddingNew(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={addCustom}>
                <Text style={styles.saveBtnText}>Add MCP</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={styles.addBtn} onPress={() => setAddingNew(true)}>
            <Text style={styles.addBtnText}>+ Add MCP Server</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },
  content: { padding: 24, maxWidth: 600, width: "100%", alignSelf: "center" },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  sectionHint: { fontSize: 12, color: '#999', marginBottom: 12 },
  card: {
    backgroundColor: '#FFF', borderRadius: 10,
    borderWidth: 1, borderColor: '#EBEBEB', padding: 4,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 12,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  mcpInfo: { flex: 1 },
  mcpName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  mcpDesc: { fontSize: 12, color: '#888', marginTop: 2 },
  mcpEnv: { fontSize: 11, color: '#BBB', marginTop: 2 },
  removeBtn: { padding: 8 },
  removeBtnText: { fontSize: 12, color: '#CCC' },
  emptyText: { padding: 16, fontSize: 13, color: '#999', textAlign: 'center' },
  addBtn: { padding: 12, borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  addBtnText: { fontSize: 13, color: colors.primary, fontWeight: '500' },
  addForm: { padding: 12, borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  input: {
    backgroundColor: '#F5F5F5', borderRadius: 8, borderWidth: 1, borderColor: '#E8E8E8',
    padding: 10, color: '#1a1a1a', fontSize: 13, marginBottom: 8,
  },
  addFormActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  cancelBtn: { padding: 8 },
  cancelBtnText: { color: '#999', fontSize: 13 },
  saveBtn: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 6 },
  saveBtnText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
});

/**
 * Memory screen — master-detail layout:
 *   Sidebar (always visible): file tree + search
 *   Main area: graph view (default) or note viewer/editor (when selected)
 *
 * Note view defaults to formatted markdown. Toggle button switches to raw
 * text editor. "← Graph" returns to graph view.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform,
} from 'react-native';
import { useConnection } from '../../stores/connection';
import { useVault } from '../../stores/vault';
import { setBaseUrl } from '../../services/api';
import GraphView from '../../components/GraphView';
import Markdown from '../../components/Markdown';
import { colors } from '../../../common/theme';

export default function MemoryScreen() {
  const config = useConnection((s) => s.config);
  const {
    notes, graph, selectedPath, editorContent, editorDirty,
    searchQuery, searchResults, loading,
    loadNotes, loadGraph, selectNote, updateEditor, saveNote, search, clearSearch,
  } = useVault();

  const [rawMode, setRawMode] = useState(false);

  useEffect(() => {
    if (config) {
      setBaseUrl(config.host, config.port);
      loadNotes();
      loadGraph();
    }
  }, [config]);

  // Reset to preview mode when switching notes
  useEffect(() => { setRawMode(false); }, [selectedPath]);

  const handleSave = useCallback(() => {
    saveNote().then(() => loadNotes());
  }, [saveNote, loadNotes]);

  const handleClose = useCallback(() => {
    useVault.setState({ selectedPath: null, editorContent: '', editorDirty: false });
  }, []);

  const openNote = (path: string) => selectNote(path);

  // Ctrl/Cmd+S
  useEffect(() => {
    if (Platform.OS !== 'web' || !selectedPath) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave, selectedPath]);

  const displayNotes = searchQuery.trim() ? searchResults : notes;
  const selectedNote = notes.find((n) => n.path === selectedPath);

  // Group by folder
  const folders = new Map<string, typeof notes>();
  for (const n of displayNotes) {
    const parts = n.path.split('/');
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder)!.push(n);
  }

  return (
    <View style={styles.container}>
      {/* ── Sidebar ── */}
      <View style={styles.sidebar}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={(q) => (q ? search(q) : clearSearch())}
          placeholder="Search notes..."
          placeholderTextColor={colors.textMuted}
        />

        <ScrollView style={styles.fileTree}>
          {Array.from(folders.entries()).map(([folder, folderNotes]) => (
            <View key={folder || '__root'}>
              {folder !== '' && (
                <Text style={styles.folderName}>📁 {folder}</Text>
              )}
              {folderNotes.map((n) => (
                <TouchableOpacity
                  key={n.path}
                  style={[styles.fileItem, n.path === selectedPath && styles.fileItemActive]}
                  onPress={() => openNote(n.path)}
                >
                  <Text
                    style={[styles.fileName, n.path === selectedPath && styles.fileNameActive]}
                    numberOfLines={1}
                  >
                    {n.title || n.path.split('/').pop()?.replace('.md', '')}
                  </Text>
                  {n.tags && n.tags.length > 0 && (
                    <Text style={styles.fileTags} numberOfLines={1}>
                      {n.tags.slice(0, 3).join(', ')}
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          ))}
          {displayNotes.length === 0 && (
            <Text style={styles.emptyText}>
              {loading ? 'Loading...' : searchQuery ? 'No results' : 'No notes yet'}
            </Text>
          )}
        </ScrollView>

        <View style={styles.noteCount}>
          <Text style={styles.noteCountText}>{notes.length} notes</Text>
        </View>
      </View>

      {/* ── Main area ── */}
      <View style={styles.mainArea}>
        {selectedPath ? (
          <View style={styles.editorContainer}>
            {/* Header bar */}
            <View style={styles.editorHeader}>
              <TouchableOpacity onPress={handleClose} style={styles.backBtn}>
                <Text style={styles.backBtnText}>← Graph</Text>
              </TouchableOpacity>
              <Text style={styles.editorTitle} numberOfLines={1}>
                {selectedNote?.title || selectedPath.split('/').pop()?.replace('.md', '')}
              </Text>
              <View style={styles.editorActions}>
                {/* Preview / Raw toggle */}
                <TouchableOpacity
                  style={styles.toggleBtn}
                  onPress={() => setRawMode(!rawMode)}
                >
                  <Text style={styles.toggleBtnText}>
                    {rawMode ? 'Preview' : 'Edit'}
                  </Text>
                </TouchableOpacity>
                {rawMode && editorDirty && (
                  <Text style={styles.unsavedBadge}>unsaved</Text>
                )}
                {rawMode && (
                  <TouchableOpacity
                    style={[styles.saveBtn, !editorDirty && styles.saveBtnDisabled]}
                    onPress={handleSave}
                    disabled={!editorDirty}
                  >
                    <Text style={styles.saveBtnText}>Save</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Content: preview or raw editor */}
            {rawMode ? (
              /* Raw text editor */
              Platform.OS === 'web' ? (
                <textarea
                  value={editorContent}
                  onChange={(e: any) => updateEditor(e.target.value)}
                  style={{
                    flex: 1,
                    width: '100%',
                    height: '100%',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 13,
                    lineHeight: '1.7',
                    padding: 24,
                    border: 'none',
                    outline: 'none',
                    resize: 'none',
                    backgroundColor: colors.surface,
                    color: colors.text,
                    boxSizing: 'border-box',
                  } as any}
                  spellCheck={false}
                />
              ) : (
                <ScrollView style={{ flex: 1, backgroundColor: colors.surface }}>
                  <TextInput
                    style={styles.editorInput}
                    value={editorContent}
                    onChangeText={updateEditor}
                    multiline
                    textAlignVertical="top"
                  />
                </ScrollView>
              )
            ) : (
              /* Formatted markdown preview */
              <ScrollView
                style={styles.previewScroll}
                contentContainerStyle={styles.previewContent}
              >
                <Markdown text={editorContent} />
              </ScrollView>
            )}
          </View>
        ) : (
          /* Graph mode */
          graph && graph.nodes.length > 0 ? (
            <GraphView data={graph} onSelectNode={openNote} />
          ) : (
            <View style={styles.graphEmpty}>
              <Text style={styles.emptyText}>
                {loading ? 'Loading graph...' : 'No notes to visualize'}
              </Text>
            </View>
          )
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },

  // Sidebar
  sidebar: {
    width: 220,
    backgroundColor: colors.sidebar,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    flexDirection: 'column',
  },
  searchInput: {
    margin: 10, padding: 8, paddingHorizontal: 12,
    backgroundColor: colors.surface, borderRadius: 6,
    borderWidth: 1, borderColor: '#E8E8E8',
    fontSize: 12, color: colors.text,
  },
  fileTree: { flex: 1, paddingHorizontal: 6 },
  folderName: {
    fontSize: 11, fontWeight: '600', color: colors.textMuted,
    paddingHorizontal: 10, paddingTop: 12, paddingBottom: 4,
    textTransform: 'uppercase', letterSpacing: 0.3,
  },
  fileItem: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, marginVertical: 1 },
  fileItemActive: { backgroundColor: colors.border },
  fileName: { fontSize: 13, color: '#333' },
  fileNameActive: { color: colors.primary, fontWeight: '500' },
  fileTags: { fontSize: 10, color: '#AAA', marginTop: 1 },
  noteCount: { padding: 10, borderTopWidth: 1, borderTopColor: colors.border },
  noteCountText: { fontSize: 11, color: colors.textMuted, textAlign: 'center' },

  // Main
  mainArea: { flex: 1 },
  graphEmpty: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Editor
  editorContainer: { flex: 1, flexDirection: 'column' },
  editorHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  backBtn: { paddingVertical: 4, paddingHorizontal: 8, marginRight: 12 },
  backBtnText: { fontSize: 13, color: colors.primary, fontWeight: '500' },
  editorTitle: { fontSize: 14, fontWeight: '600', color: colors.text, flex: 1 },
  editorActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleBtn: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 6, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  toggleBtnText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  unsavedBadge: {
    fontSize: 10, color: colors.primary, backgroundColor: colors.primaryLight,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden',
  },
  saveBtn: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 6 },
  saveBtnDisabled: { opacity: 0.3 },
  saveBtnText: { color: colors.textInverse, fontSize: 12, fontWeight: '600' },
  editorInput: { padding: 24, fontFamily: 'monospace', fontSize: 13, color: colors.text, lineHeight: 22 },

  // Preview
  previewScroll: { flex: 1, backgroundColor: colors.surface },
  previewContent: { padding: 24 },

  emptyText: { color: colors.textMuted, fontSize: 13, padding: 16 },
});

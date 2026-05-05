/**
 * Memory — note editor. Pushed as ``[...path]`` onto the Memory Stack.
 *
 * The path is a catch-all so folder segments (``docs/ideas.md``) come
 * through intact. The editor reads ``selectedPath`` from the vault
 * store — we call ``selectNote`` on mount (and whenever the route's
 * path changes, e.g. the sidebar picked a sibling) to pull the note.
 *
 * Back/save/delete navigate via ``StackActions.popTo('index')`` — see
 * ``mcps/[name].tsx`` for the full rationale on why ``router.back()``
 * is unsafe here (bubbles to the Tabs navigator, jumps to chat).
 *
 * Sidebar note taps use ``router.replace`` instead of ``push`` so the
 * stack doesn't grow as the user browses the vault.
 */

import { useCallback, useEffect, useState } from 'react';
import Feather from '@expo/vector-icons/Feather';
import {
  Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { StackActions } from '@react-navigation/native';
import Button from '../../../components/Button';
import Markdown from '../../../components/Markdown';
import ResponsiveSidebar from '../../../components/ResponsiveSidebar';
import VaultSidebar from '../../../components/memory/VaultSidebar';
import { useConnection } from '../../../stores/connection';
import { useVault } from '../../../stores/vault';
import { setBaseUrl } from '../../../services/api';
import { colors, font, radius } from '../../../theme';

export default function MemoryNoteScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const params = useLocalSearchParams<{ path?: string | string[] }>();
  const notePath = Array.isArray(params.path)
    ? params.path.join('/')
    : typeof params.path === 'string'
      ? params.path
      : '';

  const config = useConnection((s) => s.config);
  const {
    notes, selectedPath, editorContent, editorDirty,
    loadNotes, loadGraph, selectNote, updateEditor, saveNote,
  } = useVault();

  const [rawMode, setRawMode] = useState(false);

  // Initial data — same set the graph screen loads, in case the user
  // deep-linked straight to a note.
  useEffect(() => {
    if (config) {
      if (config.sidecarPort) setBaseUrl('127.0.0.1', config.sidecarPort);
      loadNotes();
      loadGraph();
    }
  }, [config]);

  // Keep the vault store's ``selectedPath`` in sync with the route so
  // ``saveNote`` writes to the right path.
  useEffect(() => {
    if (notePath && selectedPath !== notePath) {
      selectNote(notePath);
    }
  }, [notePath, selectedPath, selectNote]);

  // Every new note starts in preview mode.
  useEffect(() => { setRawMode(false); }, [notePath]);

  const handleSave = useCallback(() => {
    saveNote().then(() => loadNotes());
  }, [saveNote, loadNotes]);

  // Ctrl/Cmd+S saves.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // Back to the graph. ``popTo`` on the Memory Stack directly — can't
  // bubble to the Tabs navigator. Clear the vault's editor state first
  // so a future tap on the same note starts from a clean slate.
  const backToGraph = useCallback(() => {
    useVault.setState({ selectedPath: null, editorContent: '', editorDirty: false });
    navigation.dispatch(StackActions.popTo('index'));
  }, [navigation]);

  // Sidebar tap while already on a note: swap in place rather than
  // growing the stack.
  const openNote = useCallback((next: string) => {
    if (next === notePath) return;
    router.replace({
      pathname: '/(tabs)/memory/[...path]',
      params: { path: next.split('/') },
    });
  }, [router, notePath]);

  const selectedNote = notes.find((n) => n.path === notePath);
  const titleFallback = notePath.split('/').pop()?.replace('.md', '') ?? '';

  return (
    <ResponsiveSidebar sidebar={<VaultSidebar selectedPath={notePath} onSelectNote={openNote} />}>
      <View style={styles.editorContainer}>
        <View style={styles.editorHeader}>
          <TouchableOpacity onPress={backToGraph} style={styles.backBtn}>
            <View style={styles.backBtnContent}>
              <Feather name="arrow-left" size={14} color={colors.primary} />
              <Text style={styles.backBtnText}>Graph</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.editorTitle} numberOfLines={1}>
            {selectedNote?.title || titleFallback}
          </Text>
          <View style={styles.editorActions}>
            <TouchableOpacity style={styles.toggleBtn} onPress={() => setRawMode(!rawMode)}>
              <Text style={styles.toggleBtnText}>{rawMode ? 'Preview' : 'Edit'}</Text>
            </TouchableOpacity>
            {rawMode && editorDirty && <Text style={styles.unsavedBadge}>unsaved</Text>}
            {rawMode && (
              <Button
                variant="primary"
                size="sm"
                label="Save"
                onPress={handleSave}
                disabled={!editorDirty}
              />
            )}
          </View>
        </View>
        {rawMode ? (
          Platform.OS === 'web' ? (
            <textarea
              value={editorContent}
              onChange={(e: any) => updateEditor(e.target.value)}
              style={{
                flex: 1, width: '100%', height: '100%',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 13, lineHeight: '1.7', padding: 24,
                border: 'none', outline: 'none', resize: 'none',
                backgroundColor: colors.surface, color: colors.text,
                boxSizing: 'border-box',
              } as any}
              spellCheck={false}
            />
          ) : (
            <ScrollView style={{ flex: 1, backgroundColor: colors.surface }}>
              <TextInput
                style={styles.editorInput}
                value={editorContent} onChangeText={updateEditor}
                multiline textAlignVertical="top"
              />
            </ScrollView>
          )
        ) : (
          <ScrollView style={styles.previewScroll} contentContainerStyle={styles.previewContent}>
            <Markdown text={editorContent} />
          </ScrollView>
        )}
      </View>
    </ResponsiveSidebar>
  );
}

const styles = StyleSheet.create({
  editorContainer: { flex: 1, flexDirection: 'column', backgroundColor: colors.surface },
  editorHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
    backgroundColor: colors.bg,
  },
  backBtn: { paddingVertical: 4, paddingHorizontal: 6, marginRight: 10 },
  backBtnContent: { flexDirection: 'row', alignItems: 'center' },
  backBtnText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500', marginLeft: 5 },
  editorTitle: {
    fontSize: 14, fontWeight: '500', color: colors.text, flex: 1,
    fontFamily: font.display, letterSpacing: -0.2,
  },
  editorActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggleBtn: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  toggleBtnText: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
  unsavedBadge: {
    fontSize: 9, color: colors.primary, backgroundColor: colors.primaryLight,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.xs, overflow: 'hidden',
    fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5,
  },
  editorInput: { padding: 24, fontFamily: font.mono, fontSize: 13, color: colors.text, lineHeight: 22 },
  previewScroll: { flex: 1, backgroundColor: colors.surface },
  previewContent: { padding: 24, maxWidth: 720, width: '100%', alignSelf: 'center' },
});

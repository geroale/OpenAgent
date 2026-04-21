/**
 * VaultSidebar — shared sidebar for the Memory tab.
 *
 * Used by both screens of the Memory stack:
 *   - ``memory/index`` — graph view
 *   - ``memory/[...path]`` — note editor
 *
 * Renders the search box, folder-grouped file list, and the note counter.
 * The parent decides what tapping a note does (push, replace, inline) by
 * passing ``onSelectNote`` — this component is navigation-agnostic.
 */

import Feather from '@expo/vector-icons/Feather';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useVault } from '../../stores/vault';
import { colors, font, radius } from '../../theme';

interface Props {
  selectedPath: string | null;
  onSelectNote: (path: string) => void;
}

export default function VaultSidebar({ selectedPath, onSelectNote }: Props) {
  const { notes, searchQuery, searchResults, loading, search, clearSearch } = useVault();

  const displayNotes = searchQuery.trim() ? searchResults : notes;

  // Group by top-level folder so the list reads as a tree.
  const folders = new Map<string, typeof notes>();
  for (const n of displayNotes) {
    const parts = n.path.split('/');
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder)!.push(n);
  }

  return (
    <View style={styles.sidebarInner}>
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
              <View style={styles.folderRow}>
                <Feather name="folder" size={12} color={colors.textMuted} />
                <Text style={styles.folderName}>{folder}</Text>
              </View>
            )}
            {folderNotes.map((n) => (
              <TouchableOpacity
                key={n.path}
                style={[styles.fileItem, n.path === selectedPath && styles.fileItemActive]}
                onPress={() => onSelectNote(n.path)}
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
  );
}

const styles = StyleSheet.create({
  sidebarInner: { flex: 1 },
  searchInput: {
    margin: 10, padding: 8, paddingHorizontal: 11,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    fontSize: 12, color: colors.text, fontFamily: font.sans,
  },
  fileTree: { flex: 1, paddingHorizontal: 6 },
  folderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingTop: 10, paddingBottom: 4,
  },
  folderName: {
    fontSize: 10, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginLeft: 6,
  },
  fileItem: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: radius.sm, marginVertical: 0 },
  fileItemActive: { backgroundColor: colors.hover },
  fileName: { fontSize: 12.5, color: colors.textSecondary, fontWeight: '400' },
  fileNameActive: { color: colors.text, fontWeight: '500' },
  fileTags: { fontSize: 10, color: colors.textMuted, marginTop: 1, fontFamily: font.mono },
  noteCount: { padding: 10, borderTopWidth: 1, borderTopColor: colors.borderLight },
  noteCountText: { fontSize: 10, color: colors.textMuted, textAlign: 'center', fontFamily: font.mono },
  emptyText: { color: colors.textMuted, fontSize: 12, padding: 14 },
});

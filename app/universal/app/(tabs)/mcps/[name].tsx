/**
 * MCPs — edit an installed MCP.
 *
 * Pushed from an McpTile tap on either the Builtin or Custom tab. Fetches
 * the row via GET /api/mcps/{name}, mounts ``McpConfigForm`` in ``edit``
 * mode, and submits a PATCH-style body to PUT /api/mcps/{name}.
 *
 * Locking for builtins is enforced by the form itself; see
 * ``components/mcps/McpConfigForm.tsx``. The backend's PUT also refuses
 * some operations (e.g. DELETE on builtin) — for PUT it merges
 * field-by-field, so sending only env/enabled leaves command/url/kind
 * untouched on the row.
 *
 * Remove is offered from this screen only when ``kind === 'custom'``;
 * deleting a builtin row is rejected by the backend regardless.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { StackActions } from '@react-navigation/native';
import { useConnection } from '../../../stores/connection';
import {
  setBaseUrl, getMcp, updateMcp, deleteMcp,
} from '../../../services/api';
import type { MCPEntry } from '../../../../common/types';
import { colors, font, radius, tracking } from '../../../theme';
import Button from '../../../components/Button';
import { useConfirm } from '../../../components/ConfirmDialog';
import McpConfigForm, { type McpSubmitPayload } from '../../../components/mcps/McpConfigForm';

export default function EditMcpScreen() {
  const navigation = useNavigation();
  const confirm = useConfirm();
  const params = useLocalSearchParams<{ name?: string }>();
  const name = typeof params.name === 'string' ? params.name : '';
  const config = useConnection((s) => s.config);

  // Go back to the MCPs list. Dispatched to the enclosing Stack so the
  // action can't bubble to the outer Tabs navigator (which defaults to
  // ``backBehavior: 'firstRoute'`` and would jump to chat). ``POP_TO``
  // pops to ``index`` if it's in the stack; otherwise it replaces this
  // screen with a fresh ``index`` — correct either way.
  const backToList = useCallback(() => {
    navigation.dispatch(StackActions.popTo('index'));
  }, [navigation]);

  const [entry, setEntry] = useState<MCPEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (config) if (config.sidecarPort) setBaseUrl('127.0.0.1', config.sidecarPort);
  }, [config]);

  const load = useCallback(async () => {
    if (!name) {
      setFetchError('No MCP name in route params.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setFetchError(null);
    try {
      const row = await getMcp(name);
      setEntry(row);
    } catch (e: any) {
      setFetchError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    if (config) load();
  }, [config, load]);

  const handleSubmit = useCallback(async (payload: McpSubmitPayload) => {
    if (!entry) return;
    setServerError(null);
    // Build a minimal PATCH body: only ship fields that the user is
    // allowed to change for this row-kind. The backend's PUT merges
    // field-by-field, so omitting a key preserves the existing value.
    const isBuiltin = entry.kind !== 'custom';
    const body: Record<string, unknown> = {
      env: payload.env,
      headers: payload.headers,
      enabled: payload.enabled,
    };
    if (!isBuiltin) {
      body.command = payload.command;
      body.url = payload.url;
      body.oauth = payload.oauth;
    }
    try {
      await updateMcp(entry.name, body);
      backToList();
    } catch (e: any) {
      setServerError(e?.message || String(e));
      throw e;
    }
  }, [entry, backToList]);

  const handleRemove = useCallback(async () => {
    if (!entry) return;
    const ok = await confirm({
      title: 'Remove MCP',
      message: `Permanently delete "${entry.name}" from your mcps table?`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    setRemoving(true);
    setServerError(null);
    try {
      await deleteMcp(entry.name);
      backToList();
    } catch (e: any) {
      setServerError(e?.message || String(e));
    } finally {
      setRemoving(false);
    }
  }, [entry, confirm, backToList]);

  const isBuiltin = entry ? entry.kind !== 'custom' : false;

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={backToList} style={styles.topBarBtn} hitSlop={8}>
          <Feather name="arrow-left" size={14} color={colors.textSecondary} />
          <Text style={styles.topBarText}>MCPs</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={load} style={styles.topBarBtn} hitSlop={8} disabled={loading}>
          <Feather name="refresh-cw" size={13} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Loading MCP…</Text>
          </View>
        ) : fetchError ? (
          <ErrorBlock message={fetchError} onRetry={load} />
        ) : entry ? (
          <>
            <Text style={styles.eyebrow}>
              EDIT · {isBuiltin ? 'BUILTIN MCP' : 'CUSTOM MCP'}
            </Text>
            <Text style={styles.title} numberOfLines={1}>{entry.name}</Text>
            <Text style={styles.hint}>
              {isBuiltin
                ? 'Builtin MCPs live in code — their command and transport are locked. Use this to set env vars (API tokens), headers, and enable state.'
                : 'Edit any part of this custom server. Changes are live on the next message; the pool hot-reloads when updated_at changes.'}
            </Text>

            <View style={styles.rule} />

            <McpConfigForm
              mode="edit"
              initial={entry}
              onSubmit={handleSubmit}
              onCancel={backToList}
              submitLabel="Save changes"
              submittingLabel="Saving…"
              serverError={serverError}
            />

            {!isBuiltin && (
              <View style={styles.dangerZone}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dangerTitle}>Remove this MCP</Text>
                  <Text style={styles.dangerHint}>
                    Deletes the row from the mcps table. The agent stops seeing its tools on the next message. This can't be undone.
                  </Text>
                </View>
                <Button
                  variant="danger"
                  size="sm"
                  label={removing ? 'Removing…' : 'Remove'}
                  icon="trash-2"
                  onPress={handleRemove}
                  disabled={removing}
                />
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.errorBlock}>
      <Feather name="cloud-off" size={22} color={colors.error} />
      <Text style={styles.errorBlockTitle}>Couldn't load MCP</Text>
      <Text style={styles.errorBlockMessage}>{message}</Text>
      <Button variant="secondary" size="sm" label="Try again" icon="refresh-cw" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 18, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
    backgroundColor: colors.surface,
  },
  topBarBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 6, paddingVertical: 4,
  },
  topBarText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },

  content: {
    paddingHorizontal: 28, paddingVertical: 28,
    maxWidth: 760, width: '100%', alignSelf: 'center',
  },

  eyebrow: {
    fontSize: 10, color: colors.primary, fontWeight: '700',
    letterSpacing: tracking.wider, textTransform: 'uppercase',
  },
  title: {
    fontSize: 26, color: colors.text, fontWeight: '600',
    fontFamily: font.mono, letterSpacing: -0.4,
    marginTop: 4, marginBottom: 2,
  },
  hint: {
    fontSize: 12.5, color: colors.textMuted,
    lineHeight: 18, marginTop: 6, maxWidth: 620,
  },
  rule: {
    height: 1, backgroundColor: colors.borderLight,
    marginTop: 18, marginBottom: 22,
  },

  loadingBox: { alignItems: 'center', paddingVertical: 64, gap: 10 },
  loadingText: { fontSize: 12, color: colors.textMuted },

  errorBlock: {
    alignItems: 'center', paddingVertical: 48, gap: 10,
  },
  errorBlockTitle: {
    fontSize: 15, fontFamily: font.display, fontWeight: '500',
    color: colors.text, marginTop: 6,
  },
  errorBlockMessage: {
    fontSize: 12, color: colors.textMuted,
    textAlign: 'center', maxWidth: 420, lineHeight: 18, marginBottom: 4,
  },

  dangerZone: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: 24, paddingTop: 20,
    borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
  dangerTitle: {
    fontSize: 13, fontWeight: '600', color: colors.error,
    fontFamily: font.display, letterSpacing: -0.2,
  },
  dangerHint: {
    fontSize: 11.5, color: colors.textMuted,
    lineHeight: 16, marginTop: 3, maxWidth: 460,
  },
});

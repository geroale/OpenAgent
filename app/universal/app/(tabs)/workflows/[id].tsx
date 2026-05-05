/**
 * Workflow editor route — /workflows/{id}.
 *
 * Hosts the visual editor: React Flow canvas on web/desktop, a
 * touch-first SVG canvas on native (Phase 7). Metro picks the right
 * variant via the ``.web.tsx`` / ``.native.tsx`` split on
 * ``WorkflowEditor``.
 *
 * Keeps its own "dirty" state so unsaved graph edits don't disappear
 * on tab switches. Save / Run / Back controls live on the editor
 * component so the native variant can ship a different layout without
 * rewriting this shell.
 */

import { useLocalSearchParams, useNavigation } from 'expo-router';
import { StackActions } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../../../theme';
import WorkflowEditor from '../../../components/workflow/WorkflowEditor';
import { useConnection } from '../../../stores/connection';
import { setBaseUrl, getWorkflow } from '../../../services/api';
import type { WorkflowTask } from '../../../../common/types';

export default function WorkflowEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const connConfig = useConnection((s) => s.config);
  const [workflow, setWorkflow] = useState<WorkflowTask | null>(null);
  const [error, setError] = useState<string | null>(null);

  // See ``mcps/[name].tsx``: ``router.back()`` bubbles to the Tabs
  // navigator and jumps to chat when this stack only holds one screen.
  // ``POP_TO`` on the Stack directly pops to ``index`` or replaces this
  // screen with it.
  const backToList = useCallback(() => {
    navigation.dispatch(StackActions.popTo('index'));
  }, [navigation]);

  useEffect(() => {
    if (!connConfig || !id) return;
    if (connConfig.sidecarPort) setBaseUrl('127.0.0.1', connConfig.sidecarPort);
    let cancelled = false;
    (async () => {
      try {
        const wf = await getWorkflow(id);
        if (!cancelled) setWorkflow(wf);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connConfig, id]);

  if (error) {
    return (
      <View style={styles.status}>
        <Text style={styles.errorText}>Failed to load workflow: {error}</Text>
      </View>
    );
  }

  if (!workflow) {
    return (
      <View style={styles.status}>
        <ActivityIndicator size="small" color={colors.textMuted} />
        <Text style={styles.statusText}>Loading workflow…</Text>
      </View>
    );
  }

  return (
    <WorkflowEditor
      workflow={workflow}
      onBack={backToList}
      onWorkflowUpdated={setWorkflow}
    />
  );
}

const styles = StyleSheet.create({
  status: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    gap: 10,
  },
  statusText: { fontSize: 12, color: colors.textMuted, fontFamily: font.sans },
  errorText: {
    fontSize: 13,
    color: colors.error,
    padding: 24,
    maxWidth: 480,
    textAlign: 'center',
    fontFamily: font.sans,
  },
});

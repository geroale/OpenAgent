/**
 * MessageList — shared message-display layer.
 *
 * Renders a session's transcript with the same look on both Chat and
 * Voice tabs: user prompts as left-rule quotes, assistant replies as
 * full-width prose, tool calls as inline expandable cards. The status
 * row ("Thinking…") trails the last message while ``isProcessing``.
 *
 * Both screens share this so a stylistic change to message bubbles
 * lands uniformly. Pass ``maxItems`` to compact the view (Voice tab
 * tail-shows the last few turns); omit for the full transcript.
 */

import { useState } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import type { Attachment, ChatMessage, ToolInfo } from '../../common/types';
import { useConnection } from '../stores/connection';
import { downloadFile } from '../services/api';
import Markdown from './Markdown';
import { colors, font, radius } from '../theme';

export interface MessageListProps {
  messages: ChatMessage[];
  isProcessing?: boolean;
  statusText?: string;
  /** Slice the tail when set (Voice tab uses ~6). Omit for full history. */
  maxItems?: number;
}

export default function MessageList({
  messages, isProcessing, statusText, maxItems,
}: MessageListProps) {
  const visible = maxItems != null ? messages.slice(-maxItems) : messages;
  return (
    <>
      {visible.map((msg) => (
        msg.role === 'tool' ? (
          <ToolCard key={msg.id} toolInfo={msg.toolInfo} fallbackText={msg.text} />
        ) : msg.role === 'user' ? (
          <UserMessage key={msg.id} text={msg.text} attachments={msg.attachments} />
        ) : (
          <AssistantMessage
            key={msg.id} text={msg.text} model={msg.model} attachments={msg.attachments}
          />
        )
      ))}
      {isProcessing && (
        <View style={styles.statusRow}>
          <View
            style={styles.statusDot}
            // @ts-ignore — web-only className for the pulse keyframe
            {...(Platform.OS === 'web' ? { className: 'oa-pulse' } : {})}
          />
          <Text style={styles.statusText}>{statusText || 'Thinking'}</Text>
        </View>
      )}
    </>
  );
}

// ── Atoms ────────────────────────────────────────────────────────────

function UserMessage({ text, attachments }: { text: string; attachments?: Attachment[] }) {
  return (
    <View
      style={styles.userBlock}
      // @ts-ignore
      {...(Platform.OS === 'web' ? { className: 'oa-fade-in' } : {})}
    >
      <View style={styles.userRule} />
      <View style={styles.userBody}>
        <Text style={styles.userLabel}>You</Text>
        {attachments && attachments.length > 0 && (
          <View style={styles.attachmentsRow}>
            {attachments.map((att, i) => (
              <AttachmentView key={`${att.path}-${i}`} attachment={att} />
            ))}
          </View>
        )}
        {text ? <Text style={styles.userText}>{text}</Text> : null}
      </View>
    </View>
  );
}

function AssistantMessage({
  text, model, attachments,
}: {
  text: string;
  model?: string;
  attachments?: Attachment[];
}) {
  return (
    <View
      style={styles.assistantBlock}
      // @ts-ignore
      {...(Platform.OS === 'web' ? { className: 'oa-fade-in' } : {})}
    >
      <View style={styles.assistantHead}>
        <View style={styles.assistantDot} />
        <Text style={styles.assistantLabel}>OpenAgent</Text>
        {model && <Text style={styles.modelText}>· {model}</Text>}
      </View>
      <View style={styles.assistantBody}>
        <Markdown text={text} />
        {attachments && attachments.length > 0 && (
          <View style={styles.attachmentsRow}>
            {attachments.map((att, i) => (
              <AttachmentView key={`${att.path}-${i}`} attachment={att} downloadable />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function AttachmentView({
  attachment, downloadable = false,
}: { attachment: Attachment; downloadable?: boolean }) {
  const iconName = attachment.type === 'image'
    ? 'image'
    : attachment.type === 'voice'
      ? 'mic'
      : attachment.type === 'video'
        ? 'film'
        : 'file';
  const chipInner = (
    <>
      <Feather name={iconName as any} size={11} color={colors.textSecondary} />
      <Text style={styles.attachmentText} numberOfLines={1}>
        {attachment.filename}
      </Text>
      {downloadable ? <Feather name="download" size={10} color={colors.primary} /> : null}
    </>
  );
  if (!downloadable) {
    return <View style={styles.attachmentChip}>{chipInner}</View>;
  }
  return (
    <TouchableOpacity
      style={styles.attachmentChip}
      onPress={async () => {
        try {
          await downloadFile(attachment.path, attachment.filename);
        } catch (e) {
          console.error('Download failed:', e);
        }
      }}
    >
      {chipInner}
    </TouchableOpacity>
  );
}

function ToolCard({
  toolInfo, fallbackText,
}: { toolInfo?: ToolInfo; fallbackText: string }) {
  const [expanded, setExpanded] = useState(false);

  if (!toolInfo) {
    return (
      <View style={styles.toolRow}>
        <View style={styles.toolIndicator} />
        <Feather name="tool" size={10} color={colors.textMuted} />
        <Text style={styles.toolRowText}>{fallbackText}</Text>
      </View>
    );
  }

  const isRunning = toolInfo.status === 'running';
  const isError = toolInfo.status === 'error';
  const statusColor = isError ? colors.error : isRunning ? colors.warning : colors.success;
  const statusLabel = isRunning ? 'running' : isError ? 'error' : 'done';

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => setExpanded(!expanded)}
      style={[styles.toolCard, isError && styles.toolCardError]}
      // @ts-ignore
      {...(Platform.OS === 'web' ? { className: 'oa-fade-in' } : {})}
    >
      <View style={styles.toolCardHeader}>
        <View style={[styles.toolStatusDot, { backgroundColor: statusColor }]} />
        <Feather name="tool" size={11} color={colors.textMuted} />
        <Text style={styles.toolCardName}>{toolInfo.tool}</Text>
        <Text style={[styles.toolStatusText, { color: statusColor }]}>{statusLabel}</Text>
        <Feather name={expanded ? 'chevron-down' : 'chevron-right'} size={12} color={colors.textMuted} />
      </View>

      {expanded && (
        <View style={styles.toolCardBody}>
          {toolInfo.params && Object.keys(toolInfo.params).length > 0 && (
            <>
              <Text style={styles.toolSectionTitle}>Parameters</Text>
              <View style={styles.toolCodeBlock}>
                {Object.entries(toolInfo.params).map(([k, v]) => (
                  <Text key={k} style={styles.toolCodeText}>
                    <Text style={{ color: colors.primary }}>{k}</Text>
                    <Text style={{ color: colors.textMuted }}>: </Text>
                    {typeof v === 'string' ? v : JSON.stringify(v)}
                  </Text>
                ))}
              </View>
            </>
          )}
          {toolInfo.result && (
            <>
              <Text style={styles.toolSectionTitle}>Result</Text>
              <View style={styles.toolCodeBlock}>
                <Text style={styles.toolCodeText} numberOfLines={10}>{toolInfo.result}</Text>
              </View>
            </>
          )}
          {toolInfo.error && (
            <>
              <Text style={[styles.toolSectionTitle, { color: colors.error }]}>Error</Text>
              <View style={[styles.toolCodeBlock, { borderColor: colors.errorBorder }]}>
                <Text style={[styles.toolCodeText, { color: colors.error }]}>{toolInfo.error}</Text>
              </View>
            </>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // User
  userBlock: {
    flexDirection: 'row', alignItems: 'stretch',
    paddingVertical: 10, paddingLeft: 2,
  },
  userRule: {
    width: 2, backgroundColor: colors.primary,
    borderRadius: 1, marginRight: 12,
    opacity: 0.7,
  },
  userBody: { flex: 1, paddingVertical: 2 },
  userLabel: {
    fontSize: 10, fontWeight: '600', color: colors.primary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4,
  },
  userText: {
    fontSize: 14, lineHeight: 22, color: colors.text,
    fontWeight: '400',
  },

  // Assistant
  assistantBlock: { paddingVertical: 10 },
  assistantHead: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 6,
  },
  assistantDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.primary,
    marginRight: 8,
    // @ts-ignore web: gradient background
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(135deg, #d94841, #f3a33a)' } : {}),
  },
  assistantLabel: {
    fontSize: 10, fontWeight: '600', color: colors.text,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  modelText: {
    fontSize: 10, color: colors.textMuted, marginLeft: 4,
    fontFamily: font.mono,
  },
  assistantBody: {},

  // Status row ("Thinking…")
  statusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10,
  },
  statusDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.primary,
  },
  statusText: {
    color: colors.textMuted, fontSize: 13, fontStyle: 'italic',
    fontFamily: font.mono,
  },

  // Tool rows + cards
  toolRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 6, paddingHorizontal: 10,
    marginVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  toolIndicator: {
    width: 3, height: 14, borderRadius: 1,
    backgroundColor: colors.primary, opacity: 0.5,
  },
  toolRowText: {
    fontSize: 12, color: colors.textSecondary, flex: 1,
    fontFamily: font.mono,
  },
  toolCard: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.borderLight,
    marginVertical: 4, overflow: 'hidden',
  },
  toolCardError: { borderColor: colors.errorBorder },
  toolCardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 12,
  },
  toolStatusDot: { width: 6, height: 6, borderRadius: 3 },
  toolCardName: {
    fontSize: 12, fontWeight: '500', color: colors.text, flex: 1,
    fontFamily: font.mono,
  },
  toolStatusText: {
    fontSize: 10, fontWeight: '500', letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  toolCardBody: {
    paddingHorizontal: 12, paddingBottom: 10, paddingTop: 2,
    borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
  toolSectionTitle: {
    fontSize: 10, fontWeight: '600', color: colors.textMuted,
    marginTop: 8, marginBottom: 4,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  toolCodeBlock: {
    backgroundColor: colors.codeBg, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.codeBorder,
    padding: 8,
  },
  toolCodeText: {
    fontSize: 11, color: colors.codeText,
    fontFamily: font.mono, lineHeight: 16,
  },

  // Attachments
  attachmentsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  attachmentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: colors.border,
    maxWidth: 220,
  },
  attachmentText: {
    color: colors.textSecondary, fontSize: 11, fontWeight: '500',
    flexShrink: 1,
  },
});

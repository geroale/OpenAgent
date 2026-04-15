/**
 * Chat screen — multi-session, file attach, voice recording.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import Feather from '@expo/vector-icons/Feather';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform,
} from 'react-native';
import type { Attachment, ToolInfo } from '../../common/types';
import { useConnection } from '../../stores/connection';
import { useChat } from '../../stores/chat';
import Markdown from '../../components/Markdown';
import PrimaryButton from '../../components/PrimaryButton';
import ResponsiveSidebar from '../../components/ResponsiveSidebar';
import { uploadFile } from '../../services/api';
import { colors } from '../../theme';

interface PendingFile {
  filename: string;
  remotePath: string;
  kind: 'image' | 'file';
}

export default function ChatScreen() {
  const ws = useConnection((s) => s.ws);
  const {
    sessions, activeSessionId, createSession, setActiveSession, removeSession,
    addUserMessage,
  } = useChat();

  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const isDesktop = typeof window !== 'undefined' && !!window.desktop?.isDesktop;
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [activeSession?.messages.length, activeSession?.statusText]);

  // ── Send message (with optional attached file) ──

  const handleSend = () => {
    if (!ws || !activeSessionId) return;
    const text = input.trim();
    if (!text && pendingFiles.length === 0) return;

    let msg = text;
    let displayMsg = text;

    const attachments: Attachment[] = pendingFiles.map((f) => ({
      type: f.kind,
      path: f.remotePath,
      filename: f.filename,
    }));

    if (pendingFiles.length > 0) {
      const lines = pendingFiles.map(
        (f) => `- ${f.kind}: ${f.filename} — local path: ${f.remotePath}`,
      );
      const noun = pendingFiles.length === 1 ? 'a file' : `${pendingFiles.length} files`;
      const fileHeader = `The user attached ${noun}:\n${lines.join('\n')}\nUse the Read tool to inspect ${pendingFiles.length === 1 ? 'it' : 'them'}.`;
      msg = text ? `${fileHeader}\n\nUser message: ${text}` : fileHeader;
      // Keep the user bubble's text to just the typed message; the
      // attachments render as chips/thumbnails below the text.
      displayMsg = text;
    }

    addUserMessage(activeSessionId, displayMsg, attachments.length ? attachments : undefined);
    ws.sendMessage(msg, activeSessionId);
    setInput('');
    setPendingFiles([]);
  };

  const handleKeyDown = (e: any) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── File picker ──

  const handleFilePick = async () => {
    // Desktop: use Electron's native dialog + skip the HTTP upload entirely.
    // The agent runs locally, so the real file path is directly usable by
    // the Read tool — no tmp-copy, no CORS/port worries.
    if (isDesktop && window.desktop?.pickFiles) {
      try {
        const picked = await window.desktop.pickFiles();
        if (picked.length) {
          setPendingFiles((prev) => [
            ...prev,
            ...picked.map((f) => ({ filename: f.filename, remotePath: f.path, kind: f.kind })),
          ]);
        }
      } catch (e: any) {
        console.error('Native picker failed:', e);
      }
      return;
    }

    if (Platform.OS !== 'web') return;

    // Browser path: DOM file input + upload each selected file to /api/upload
    // so the agent on a different host can reach it.
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'image/*,.pdf,.txt,.md,.csv,.json,.py,.js,.ts,.yaml,.yml,.log';
    // Some browsers/webviews don't fire `change` for detached inputs — attach
    // to the DOM, click, then remove once we're done.
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
    fileInput.onchange = async () => {
      const files = Array.from(fileInput.files || []);
      document.body.removeChild(fileInput);
      if (files.length === 0) return;
      const uploads = await Promise.allSettled(files.map((f) => uploadFile(f)));
      const next: PendingFile[] = [];
      uploads.forEach((u, i) => {
        if (u.status === 'fulfilled') {
          const kind = files[i].type?.startsWith('image/') ? 'image' as const : 'file' as const;
          next.push({ filename: u.value.filename, remotePath: u.value.path, kind });
        } else {
          console.error('Upload failed:', files[i].name, u.reason);
        }
      });
      if (next.length) setPendingFiles((prev) => [...prev, ...next]);
    };
    fileInput.click();
  };

  // ── Voice recording (Web: MediaRecorder API) ──

  const startRecording = async () => {
    if (Platform.OS !== 'web') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], 'voice.webm', { type: 'audio/webm' });
        if (!activeSessionId || !ws) return;
        try {
          const result = await uploadFile(file);
          const transcription = (result as any).transcription;
          const msg = transcription
            ? transcription
            : `The user sent a voice message:\n- audio: ${result.filename} — local path: ${result.path}\nUse Read to inspect it.`;
          addUserMessage(activeSessionId, 'Voice message');
          ws.sendMessage(msg, activeSessionId);
        } catch (e: any) {
          console.error('Voice upload failed:', e);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (e) {
      console.error('Mic access denied:', e);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setRecording(false);
    }
  };

  // ── Sidebar ──

  const sidebarContent = (
    <View style={styles.sidebarInner}>
      <PrimaryButton style={styles.newChatBtn} onPress={createSession}>
        <View style={styles.newChatContent}>
          <Feather name="plus" size={13} color={colors.textInverse} />
          <Text style={styles.newChatText}>New Chat</Text>
        </View>
      </PrimaryButton>
      <ScrollView style={styles.sessionList}>
        {sessions.map((ses) => (
          <TouchableOpacity
            key={ses.id}
            style={[styles.sessionItem, ses.id === activeSessionId && styles.sessionActive]}
            onPress={() => setActiveSession(ses.id)}
            onLongPress={() => removeSession(ses.id)}
          >
            <Text style={styles.sessionTitle} numberOfLines={1}>{ses.title}</Text>
            {ses.isProcessing && <Text style={styles.processingDot}>●</Text>}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <ResponsiveSidebar sidebar={sidebarContent}>
      <View style={styles.chatArea}>
        {activeSession ? (
          <>
            <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messagesContent}>
              {activeSession.messages.map((msg) => (
                msg.role === 'tool' ? (
                  <ToolCard key={msg.id} toolInfo={msg.toolInfo} fallbackText={msg.text} />
                ) : (
                  <View key={msg.id} style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
                    {msg.role === 'assistant' ? (
                      <>
                        <Markdown text={msg.text} />
                        {msg.model && <Text style={styles.modelText}>Model: {msg.model}</Text>}
                      </>
                    ) : (
                      <>
                        {msg.attachments && msg.attachments.length > 0 && (
                          <View style={styles.attachmentsRow}>
                            {msg.attachments.map((att, i) => (
                              <AttachmentView key={`${att.path}-${i}`} attachment={att} />
                            ))}
                          </View>
                        )}
                        {msg.text ? (
                          <Text style={[styles.bubbleText, styles.userText]}>{msg.text}</Text>
                        ) : null}
                      </>
                    )}
                  </View>
                )
              ))}
              {activeSession.isProcessing && (
                <View style={[styles.bubble, styles.statusBubble]}>
                  <View style={styles.statusContent}>
                    <Feather name="clock" size={12} color={colors.textMuted} />
                    <Text style={styles.statusText}>{activeSession.statusText || 'Thinking...'}</Text>
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Pending file badges */}
            {pendingFiles.length > 0 && (
              <View style={styles.pendingBar}>
                <View style={styles.pendingList}>
                  {pendingFiles.map((f, idx) => (
                    <View key={`${f.remotePath}-${idx}`} style={styles.pendingChip}>
                      <Feather name="paperclip" size={11} color={colors.primary} />
                      <Text style={styles.pendingText} numberOfLines={1}>{f.filename}</Text>
                      <TouchableOpacity
                        onPress={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        <Feather name="x" size={12} color={colors.textMuted} style={styles.pendingRemove} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Input bar */}
            <View style={styles.inputBar}>
              {(Platform.OS === 'web' || isDesktop) && (
                <TouchableOpacity style={styles.iconBtn} onPress={handleFilePick}>
                  <Feather name="paperclip" size={15} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
              {Platform.OS === 'web' && (
                <TouchableOpacity
                  style={[styles.iconBtn, recording && styles.iconBtnActive]}
                  onPress={recording ? stopRecording : startRecording}
                >
                  <Feather
                    name={recording ? 'stop-circle' : 'mic'}
                    size={15}
                    color={recording ? colors.textInverse : colors.textSecondary}
                  />
                </TouchableOpacity>
              )}
              {Platform.OS === 'web' ? (
                <textarea
                  value={input}
                  onChange={(e: any) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Send a message..."
                  rows={1}
                  style={{
                    flex: 1, backgroundColor: colors.inputBg, borderRadius: 20,
                    border: `1px solid ${colors.border}`,
                    paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 10,
                    color: colors.text, fontSize: 14,
                    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                    maxHeight: 120, resize: 'none', outline: 'none',
                  } as any}
                />
              ) : (
                <TextInput
                  style={styles.textInput}
                  value={input} onChangeText={setInput}
                  placeholder="Send a message..." placeholderTextColor={colors.textMuted}
                  onSubmitEditing={handleSend} returnKeyType="send" multiline
                />
              )}
              <PrimaryButton
                style={[styles.sendBtn, (!input.trim() && pendingFiles.length === 0) && styles.sendBtnDisabled]}
                contentStyle={styles.sendBtnInner}
                onPress={handleSend}
                disabled={(!input.trim() && pendingFiles.length === 0) || activeSession.isProcessing}
              >
                <Feather name="arrow-up" size={15} color={colors.textInverse} />
              </PrimaryButton>
            </View>
          </>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Select a chat or create a new one</Text>
          </View>
        )}
      </View>
    </ResponsiveSidebar>
  );
}

/** File/image chip shown inside user message bubbles. */
function AttachmentView({ attachment }: { attachment: Attachment }) {
  const iconName = attachment.type === 'image'
    ? 'image'
    : attachment.type === 'voice'
      ? 'mic'
      : attachment.type === 'video'
        ? 'film'
        : 'file';
  return (
    <View style={styles.attachmentChip}>
      <Feather name={iconName as any} size={12} color={colors.textInverse} />
      <Text style={styles.attachmentText} numberOfLines={1}>{attachment.filename}</Text>
    </View>
  );
}

/** Collapsible tool card showing name, params, status, and result. */
function ToolCard({ toolInfo, fallbackText }: { toolInfo?: ToolInfo; fallbackText: string }) {
  const [expanded, setExpanded] = useState(false);

  if (!toolInfo) {
    // Legacy plain text tool pill
    return (
      <View style={styles.toolBlock}>
        <Feather name="tool" size={11} color={colors.primary} style={styles.toolIcon} />
        <Text style={styles.toolText}>{fallbackText}</Text>
      </View>
    );
  }

  const isRunning = toolInfo.status === 'running';
  const isError = toolInfo.status === 'error';
  const statusLabel = isRunning ? 'Running' : isError ? 'Error' : 'Done';
  const statusColor = isError ? colors.error : isRunning ? colors.textMuted : colors.success;
  const statusIconName = isRunning ? 'clock' : isError ? 'x-circle' : 'check-circle';

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => setExpanded(!expanded)}
      style={[styles.toolCard, isError && styles.toolCardError]}
    >
      {/* Header */}
      <View style={styles.toolCardHeader}>
        <Feather name="tool" size={13} color={colors.primary} style={styles.toolCardIcon} />
        <Text style={styles.toolCardName}>{toolInfo.tool}</Text>
        <View style={[styles.toolBadge, { backgroundColor: statusColor + '18' }]}>
          <View style={styles.toolBadgeContent}>
            <Feather name={statusIconName} size={11} color={statusColor} />
            <Text style={[styles.toolBadgeText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>
        <Feather name={expanded ? 'chevron-down' : 'chevron-right'} size={13} color={colors.textMuted} />
      </View>

      {/* Expanded content */}
      {expanded && (
        <View style={styles.toolCardBody}>
          {toolInfo.params && Object.keys(toolInfo.params).length > 0 && (
            <>
              <Text style={styles.toolSectionTitle}>Parameters</Text>
              <View style={styles.toolCodeBlock}>
                {Object.entries(toolInfo.params).map(([k, v]) => (
                  <Text key={k} style={styles.toolCodeText}>
                    <Text style={{ fontWeight: '600' }}>{k}:</Text> {typeof v === 'string' ? v : JSON.stringify(v)}
                  </Text>
                ))}
              </View>
            </>
          )}
          {toolInfo.result && (
            <>
              <Text style={styles.toolSectionTitle}>Result</Text>
              <View style={styles.toolCodeBlock}>
                <Text style={styles.toolCodeText} numberOfLines={8}>{toolInfo.result}</Text>
              </View>
            </>
          )}
          {toolInfo.error && (
            <>
              <Text style={[styles.toolSectionTitle, { color: colors.error }]}>Error</Text>
              <View style={[styles.toolCodeBlock, { borderColor: colors.error + '40' }]}>
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
  sidebarInner: { flex: 1, padding: 16 },
  newChatBtn: { marginBottom: 16 },
  newChatContent: { flexDirection: 'row', alignItems: 'center' },
  newChatText: { color: colors.textInverse, fontWeight: '700', fontSize: 13, marginLeft: 8 },
  sessionList: { flex: 1 },
  sessionItem: { padding: 10, borderRadius: 8, marginBottom: 2, flexDirection: 'row', alignItems: 'center' },
  sessionActive: { backgroundColor: colors.primaryLight },
  sessionTitle: { color: colors.textSecondary, flex: 1, fontSize: 13 },
  processingDot: { color: colors.primary, fontSize: 10, marginLeft: 6 },

  chatArea: { flex: 1, flexDirection: 'column', backgroundColor: colors.bg },
  messages: { flex: 1 },
  messagesContent: { padding: 24, paddingBottom: 8 },
  bubble: { maxWidth: '75%', borderRadius: 12, padding: 14, marginBottom: 10 },
  userBubble: { backgroundColor: colors.primary, alignSelf: 'flex-end' },
  assistantBubble: { backgroundColor: colors.surface, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.border },
  statusBubble: { backgroundColor: 'transparent', alignSelf: 'flex-start', padding: 8 },
  statusContent: { flexDirection: 'row', alignItems: 'center' },
  toolBlock: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'center',
    paddingVertical: 4, paddingHorizontal: 12, marginVertical: 4,
    backgroundColor: colors.primaryLight, borderRadius: 16,
  },
  toolIcon: { marginRight: 6 },
  toolText: { fontSize: 12, color: colors.primary, fontWeight: '500' },

  // ToolCard
  toolCard: {
    alignSelf: 'center', width: '85%', maxWidth: 500,
    backgroundColor: colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
    marginVertical: 6, overflow: 'hidden',
  },
  toolCardError: { borderColor: colors.error + '60' },
  toolCardHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, paddingHorizontal: 12,
  },
  toolCardIcon: { marginRight: 6 },
  toolCardName: { fontSize: 13, fontWeight: '600', color: colors.text, flex: 1 },
  toolBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  toolBadgeContent: { flexDirection: 'row', alignItems: 'center' },
  toolBadgeText: { fontSize: 11, fontWeight: '600', marginLeft: 4 },
  toolCardBody: { paddingHorizontal: 12, paddingBottom: 10 },
  toolSectionTitle: { fontSize: 11, fontWeight: '600', color: colors.textMuted, marginTop: 6, marginBottom: 4 },
  toolCodeBlock: {
    backgroundColor: colors.inputBg, borderRadius: 6,
    borderWidth: 1, borderColor: colors.border,
    padding: 8,
  },
  toolCodeText: { fontSize: 11, color: colors.text, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },

  bubbleText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  userText: { color: colors.textInverse },

  // Attachment chips inside user bubble
  attachmentsRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
  attachmentChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4,
    marginRight: 6, marginBottom: 4, maxWidth: 220,
  },
  attachmentText: {
    color: colors.textInverse, fontSize: 12, fontWeight: '500',
    marginLeft: 6, flexShrink: 1,
  },

  modelText: { color: colors.textMuted, fontSize: 11, marginTop: 8 },
  statusText: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic', marginLeft: 6 },

  // Pending files
  pendingBar: {
    paddingHorizontal: 16, paddingVertical: 6,
    backgroundColor: colors.primaryLight, borderTopWidth: 1, borderTopColor: colors.border,
  },
  pendingList: { flexDirection: 'row', flexWrap: 'wrap' },
  pendingChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4,
    marginRight: 6, marginVertical: 2, maxWidth: 240,
  },
  pendingText: { fontSize: 12, color: colors.primary, fontWeight: '500', marginLeft: 4, marginRight: 4, flexShrink: 1 },
  pendingRemove: { padding: 2 },

  // Input
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    padding: 12, paddingHorizontal: 16,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', marginRight: 4,
  },
  iconBtnActive: { backgroundColor: colors.primary },
  textInput: {
    flex: 1, backgroundColor: colors.inputBg, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 16, paddingVertical: 10, color: colors.text, fontSize: 14, maxHeight: 120,
  },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18, marginLeft: 8,
  },
  sendBtnInner: {
    minHeight: 36, width: 36, height: 36, borderRadius: 18,
    paddingHorizontal: 0, paddingVertical: 0,
  },
  sendBtnDisabled: { opacity: 0.3 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 15 },

});

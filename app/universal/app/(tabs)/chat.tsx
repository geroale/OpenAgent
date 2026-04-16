/**
 * Chat screen — editorial single-column flow, no left/right bubbles.
 * Inspired by Claude Code / Codex: messages read like a document, with
 * user prompts as left-rule quotes and assistant replies as full-width
 * prose. Tool invocations inline as compact rows.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import Feather from '@expo/vector-icons/Feather';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform, Image,
} from 'react-native';

const logoIcon = require('../../assets/openagent-icon.png');
import type { Attachment, ToolInfo } from '../../common/types';
import { useConnection } from '../../stores/connection';
import { useChat } from '../../stores/chat';
import Markdown from '../../components/Markdown';
import ResponsiveSidebar from '../../components/ResponsiveSidebar';
import { uploadFile, downloadFile } from '../../services/api';
import { colors, font, radius } from '../../theme';

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
        (f) => `- ${f.kind}: ${f.filename} — server path: ${f.remotePath}`,
      );
      const noun = pendingFiles.length === 1 ? 'a file' : `${pendingFiles.length} files`;
      const fileHeader = `The user attached ${noun}:\n${lines.join('\n')}\nUse the Read tool to inspect ${pendingFiles.length === 1 ? 'it' : 'them'}.`;
      msg = text ? `${fileHeader}\n\nUser message: ${text}` : fileHeader;
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

  const guessMimeType = (filename: string, kind: 'image' | 'file'): string => {
    const ext = filename.toLowerCase().split('.').pop() || '';
    const mimes: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', bmp: 'image/bmp', heic: 'image/heic', tiff: 'image/tiff',
      pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown',
      csv: 'text/csv', json: 'application/json', yaml: 'application/x-yaml',
      yml: 'application/x-yaml', log: 'text/plain',
      py: 'text/x-python', js: 'application/javascript', ts: 'application/typescript',
      webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg',
      wav: 'audio/wav', m4a: 'audio/mp4',
    };
    return mimes[ext] || (kind === 'image' ? 'application/octet-stream' : 'application/octet-stream');
  };

  const handleFilePick = async () => {
    if (isDesktop && window.desktop?.pickFiles && window.desktop?.readFile) {
      let picked: { path: string; filename: string; kind: 'image' | 'file' }[] = [];
      try {
        picked = await window.desktop.pickFiles();
      } catch (e: any) {
        console.error('Native picker failed:', e);
        return;
      }
      if (!picked.length) return;

      const uploads = await Promise.allSettled(
        picked.map(async (p) => {
          const bytes = await window.desktop!.readFile!(p.path);
          const blob = new Blob([bytes as BlobPart], { type: guessMimeType(p.filename, p.kind) });
          const file = new File([blob], p.filename, { type: blob.type });
          const result = await uploadFile(file);
          return { filename: result.filename, remotePath: result.path, kind: p.kind };
        }),
      );
      const next: PendingFile[] = [];
      uploads.forEach((u, i) => {
        if (u.status === 'fulfilled') {
          next.push(u.value);
        } else {
          console.error('Desktop upload failed:', picked[i].filename, u.reason);
        }
      });
      if (next.length) setPendingFiles((prev) => [...prev, ...next]);
      return;
    }

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

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'image/*,.pdf,.txt,.md,.csv,.json,.py,.js,.ts,.yaml,.yml,.log';
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

  const sidebarContent = (
    <View style={styles.sidebarInner}>
      <View style={styles.sidebarHead}>
        <Text style={styles.sidebarKicker}>Sessions</Text>
        <TouchableOpacity
          onPress={createSession}
          style={styles.newBtn}
          accessibilityLabel="New chat"
          // @ts-ignore
          {...(Platform.OS === 'web' ? { className: 'oa-hover-lift' } : {})}
        >
          <Feather name="plus" size={13} color={colors.text} />
          <Text style={styles.newBtnText}>New</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.sessionList}>
        {sessions.map((ses) => (
          <TouchableOpacity
            key={ses.id}
            style={[styles.sessionItem, ses.id === activeSessionId && styles.sessionActive]}
            onPress={() => setActiveSession(ses.id)}
            onLongPress={() => removeSession(ses.id)}
            activeOpacity={0.7}
          >
            {ses.id === activeSessionId && <View style={styles.sessionActiveBar} />}
            <Text style={[styles.sessionTitle, ses.id === activeSessionId && styles.sessionTitleActive]} numberOfLines={1}>
              {ses.title}
            </Text>
            {ses.isProcessing && (
              <View
                style={styles.processingDot}
                // @ts-ignore web className
                {...(Platform.OS === 'web' ? { className: 'oa-pulse' } : {})}
              />
            )}
          </TouchableOpacity>
        ))}
        {sessions.length === 0 && (
          <Text style={styles.sidebarEmpty}>No sessions yet</Text>
        )}
      </ScrollView>
    </View>
  );

  return (
    <ResponsiveSidebar sidebar={sidebarContent}>
      <View style={styles.chatArea}>
        {activeSession ? (
          <>
            <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messagesContent}>
              <View style={styles.messagesInner}>
                {activeSession.messages.length === 0 && (
                  <View style={styles.heroEmpty}>
                    <Image source={logoIcon} style={styles.heroLogo} resizeMode="contain" />
                    <Text style={styles.heroTitle}>Ready when you are</Text>
                    <Text style={styles.heroSub}>
                      Ask a question, request a task, or attach a file.
                    </Text>
                  </View>
                )}
                {activeSession.messages.map((msg) => (
                  msg.role === 'tool' ? (
                    <ToolCard key={msg.id} toolInfo={msg.toolInfo} fallbackText={msg.text} />
                  ) : msg.role === 'user' ? (
                    <UserMessage key={msg.id} text={msg.text} attachments={msg.attachments} />
                  ) : (
                    <AssistantMessage key={msg.id} text={msg.text} model={msg.model} attachments={msg.attachments} />
                  )
                ))}
                {activeSession.isProcessing && (
                  <View style={styles.statusRow}>
                    <View
                      style={styles.statusDot}
                      // @ts-ignore
                      {...(Platform.OS === 'web' ? { className: 'oa-pulse' } : {})}
                    />
                    <Text style={styles.statusText}>{activeSession.statusText || 'Thinking'}</Text>
                  </View>
                )}
              </View>
            </ScrollView>

            <View style={styles.composerWrap}>
              <View style={styles.composer}>
                {pendingFiles.length > 0 && (
                  <View style={styles.pendingList}>
                    {pendingFiles.map((f, idx) => (
                      <View key={`${f.remotePath}-${idx}`} style={styles.pendingChip}>
                        <Feather name="paperclip" size={10} color={colors.textSecondary} />
                        <Text style={styles.pendingText} numberOfLines={1}>{f.filename}</Text>
                        <TouchableOpacity
                          onPress={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          <Feather name="x" size={11} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.inputRow}>
                  {Platform.OS === 'web' ? (
                    <textarea
                      value={input}
                      onChange={(e: any) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Message OpenAgent..."
                      rows={1}
                      style={{
                        flex: 1, background: 'transparent', border: 'none',
                        paddingLeft: 0, paddingRight: 0, paddingTop: 6, paddingBottom: 6,
                        color: colors.text, fontSize: 14, lineHeight: 1.5,
                        fontFamily: font.sans,
                        maxHeight: 140, resize: 'none', outline: 'none',
                      } as any}
                    />
                  ) : (
                    <TextInput
                      style={styles.textInput}
                      value={input} onChangeText={setInput}
                      placeholder="Message OpenAgent..." placeholderTextColor={colors.textMuted}
                      onSubmitEditing={handleSend} returnKeyType="send" multiline
                    />
                  )}
                </View>

                <View style={styles.composerActions}>
                  <View style={styles.composerLeft}>
                    {(Platform.OS === 'web' || isDesktop) && (
                      <TouchableOpacity style={styles.iconBtn} onPress={handleFilePick}>
                        <Feather name="paperclip" size={13} color={colors.textSecondary} />
                      </TouchableOpacity>
                    )}
                    {Platform.OS === 'web' && (
                      <TouchableOpacity
                        style={[styles.iconBtn, recording && styles.iconBtnActive]}
                        onPress={recording ? stopRecording : startRecording}
                      >
                        <Feather
                          name={recording ? 'stop-circle' : 'mic'}
                          size={13}
                          color={recording ? colors.textInverse : colors.textSecondary}
                        />
                      </TouchableOpacity>
                    )}
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.sendBtn,
                      ((!input.trim() && pendingFiles.length === 0) || activeSession.isProcessing) && styles.sendBtnDisabled,
                    ]}
                    onPress={handleSend}
                    disabled={(!input.trim() && pendingFiles.length === 0) || activeSession.isProcessing}
                  >
                    <Feather name="arrow-up" size={13} color={colors.textInverse} />
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.composerHint}>
                <Text style={styles.kbd}>Enter</Text> to send · <Text style={styles.kbd}>Shift+Enter</Text> for newline
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.emptyState}>
            <Image source={logoIcon} style={styles.heroLogo} resizeMode="contain" />
            <Text style={styles.emptyTitle}>No session selected</Text>
            <Text style={styles.emptySub}>Pick a session on the left, or create a new one.</Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={createSession}>
              <Feather name="plus" size={13} color={colors.text} />
              <Text style={styles.emptyBtnText}>New chat</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ResponsiveSidebar>
  );
}

// ── Message components ──

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
  text,
  model,
  attachments,
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

function AttachmentView({ attachment, downloadable = false }: { attachment: Attachment; downloadable?: boolean }) {
  const iconName = attachment.type === 'image'
    ? 'image'
    : attachment.type === 'voice'
      ? 'mic'
      : attachment.type === 'video'
        ? 'film'
        : 'file';
  const token = useConnection((s) => s.config?.token);
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
          await downloadFile(attachment.path, attachment.filename, token);
        } catch (e) {
          console.error('Download failed:', e);
        }
      }}
    >
      {chipInner}
    </TouchableOpacity>
  );
}

function ToolCard({ toolInfo, fallbackText }: { toolInfo?: ToolInfo; fallbackText: string }) {
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
  const statusIconName = isRunning ? 'clock' : isError ? 'x-circle' : 'check-circle';
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
  // Sidebar
  sidebarInner: { flex: 1, padding: 10, gap: 2 },
  sidebarHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 6, paddingTop: 4, paddingBottom: 6, marginBottom: 2,
  },
  sidebarKicker: {
    fontSize: 10, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  newBtnText: {
    fontSize: 10, fontWeight: '600', color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  sessionList: { flex: 1 },
  sessionItem: {
    position: 'relative',
    paddingVertical: 7, paddingHorizontal: 10,
    borderRadius: radius.sm, marginVertical: 1,
    flexDirection: 'row', alignItems: 'center',
  },
  sessionActive: { backgroundColor: colors.hover },
  sessionActiveBar: {
    position: 'absolute', left: 0, top: 8, bottom: 8, width: 2,
    backgroundColor: colors.primary, borderRadius: 1,
  },
  sessionTitle: { color: colors.textSecondary, flex: 1, fontSize: 12.5, fontWeight: '400' },
  sessionTitleActive: { color: colors.text, fontWeight: '500' },
  processingDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.primary, marginLeft: 6,
  },
  sidebarEmpty: {
    fontSize: 11, color: colors.textMuted, textAlign: 'center',
    paddingVertical: 20,
  },

  // Chat area
  chatArea: { flex: 1, flexDirection: 'column', backgroundColor: colors.bg },
  messages: { flex: 1 },
  messagesContent: { paddingVertical: 12, paddingBottom: 12 },
  messagesInner: { maxWidth: 760, width: '100%', alignSelf: 'center', paddingHorizontal: 20 },

  // Hero empty state
  heroEmpty: {
    alignItems: 'center', paddingVertical: 60, paddingHorizontal: 16,
  },
  heroGlyph: {
    fontSize: 26, color: colors.primary, marginBottom: 12,
    fontFamily: font.serif,
  },
  heroLogo: {
    width: 56, height: 56, marginBottom: 14,
  },
  heroTitle: {
    fontSize: 20, fontWeight: '500', color: colors.text,
    letterSpacing: -0.4, marginBottom: 4,
    fontFamily: font.display,
  },
  heroSub: {
    fontSize: 13, color: colors.textMuted, textAlign: 'center',
  },

  // User message
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

  // Assistant message
  assistantBlock: {
    paddingVertical: 10,
  },
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

  // Status row
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

  // Tool rows
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

  // Attachment chips
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

  // Composer
  composerWrap: {
    paddingHorizontal: 20, paddingBottom: 12, paddingTop: 4,
    backgroundColor: colors.bg,
  },
  composer: {
    maxWidth: 760, width: '100%', alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 2,
    elevation: 1,
  },
  pendingList: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 5,
    marginBottom: 8,
  },
  pendingChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.sidebar,
    borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: colors.borderLight,
    maxWidth: 220,
  },
  pendingText: {
    fontSize: 11, color: colors.textSecondary, fontWeight: '500',
    flexShrink: 1,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 4,
  },
  textInput: {
    flex: 1, color: colors.text, fontSize: 14,
    paddingVertical: 6, paddingHorizontal: 0,
    maxHeight: 140,
  },
  composerActions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 4,
  },
  composerLeft: { flexDirection: 'row', gap: 2 },
  iconBtn: {
    width: 28, height: 28, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnActive: { backgroundColor: colors.primary },
  sendBtn: {
    width: 28, height: 28, borderRadius: radius.sm,
    backgroundColor: colors.text,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.25 },
  composerHint: {
    fontSize: 10, color: colors.textMuted,
    textAlign: 'center', marginTop: 6,
    fontFamily: font.mono,
  },
  kbd: {
    fontSize: 10, color: colors.textSecondary,
    fontFamily: font.mono, fontWeight: '500',
  },

  // Empty
  emptyState: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18, fontWeight: '500', color: colors.text,
    letterSpacing: -0.3, marginBottom: 4,
    fontFamily: font.display,
  },
  emptySub: {
    fontSize: 13, color: colors.textMuted, textAlign: 'center', marginBottom: 16,
  },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  emptyBtnText: { fontSize: 12, fontWeight: '500', color: colors.text },
});

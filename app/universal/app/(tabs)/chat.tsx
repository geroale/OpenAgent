/**
 * Chat screen — multi-session, file attach, voice recording.
 */

import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform,
} from 'react-native';
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
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null);
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
    if (!text && !pendingFile) return;

    let msg = text;
    let displayMsg = text;

    if (pendingFile) {
      const fileHeader = `The user attached a file:\n- ${pendingFile.kind}: ${pendingFile.filename} — local path: ${pendingFile.remotePath}\nUse the Read tool to inspect it.`;
      msg = text ? `${fileHeader}\n\nUser message: ${text}` : fileHeader;
      displayMsg = text ? `📎 ${pendingFile.filename}\n${text}` : `📎 ${pendingFile.filename}`;
    }

    addUserMessage(activeSessionId, displayMsg);
    ws.sendMessage(msg, activeSessionId);
    setInput('');
    setPendingFile(null);
  };

  const handleKeyDown = (e: any) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── File picker ──

  const handleFilePick = () => {
    if (Platform.OS !== 'web') return;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,.pdf,.txt,.md,.csv,.json,.py,.js,.ts,.yaml,.yml,.log';
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const { path, filename } = await uploadFile(file);
        const kind = file.type?.startsWith('image/') ? 'image' as const : 'file' as const;
        setPendingFile({ filename, remotePath: path, kind });
      } catch (e: any) {
        console.error('Upload failed:', e);
      }
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
          addUserMessage(activeSessionId, '🎙 Voice message');
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
        <Text style={styles.newChatText}>+ New Chat</Text>
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
                <View key={msg.id} style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
                  {msg.role === 'assistant' ? (
                    <Markdown text={msg.text} />
                  ) : (
                    <Text style={[styles.bubbleText, styles.userText]}>{msg.text}</Text>
                  )}
                </View>
              ))}
              {activeSession.isProcessing && (
                <View style={[styles.bubble, styles.statusBubble]}>
                  <Text style={styles.statusText}>⏳ {activeSession.statusText || 'Thinking...'}</Text>
                </View>
              )}
            </ScrollView>

            {/* Pending file badge */}
            {pendingFile && (
              <View style={styles.pendingBar}>
                <Text style={styles.pendingText}>📎 {pendingFile.filename}</Text>
                <TouchableOpacity onPress={() => setPendingFile(null)}>
                  <Text style={styles.pendingRemove}>✕</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Input bar */}
            <View style={styles.inputBar}>
              {Platform.OS === 'web' && (
                <TouchableOpacity style={styles.iconBtn} onPress={handleFilePick}>
                  <Text style={styles.iconBtnText}>📎</Text>
                </TouchableOpacity>
              )}
              {Platform.OS === 'web' && (
                <TouchableOpacity
                  style={[styles.iconBtn, recording && styles.iconBtnActive]}
                  onPress={recording ? stopRecording : startRecording}
                >
                  <Text style={styles.iconBtnText}>{recording ? '⏹' : '🎙'}</Text>
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
                style={[styles.sendBtn, (!input.trim() && !pendingFile) && styles.sendBtnDisabled]}
                contentStyle={styles.sendBtnInner}
                onPress={handleSend}
                disabled={(!input.trim() && !pendingFile) || activeSession.isProcessing}
              >
                <Text style={styles.sendText}>↑</Text>
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

const styles = StyleSheet.create({
  sidebarInner: { flex: 1, padding: 16 },
  newChatBtn: { marginBottom: 16 },
  newChatText: { color: colors.textInverse, fontWeight: '700', fontSize: 13 },
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
  bubbleText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  userText: { color: colors.textInverse },
  statusText: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },

  // Pending file
  pendingBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 6,
    backgroundColor: colors.primaryLight, borderTopWidth: 1, borderTopColor: colors.border,
  },
  pendingText: { fontSize: 12, color: colors.primary, fontWeight: '500' },
  pendingRemove: { fontSize: 14, color: colors.textMuted, padding: 4 },

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
  iconBtnText: { fontSize: 18 },
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
  sendText: { color: colors.textInverse, fontSize: 16, fontWeight: '700' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 15 },
});

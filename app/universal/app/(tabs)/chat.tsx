import { colors } from '../../theme';
/**
 * Chat screen — ChatGPT-style interface with multi-session support.
 * Responsive: fixed sidebar on tablet+, drawer on mobile.
 */

import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform,
} from 'react-native';
import { useConnection } from '../../stores/connection';
import { useChat } from '../../stores/chat';
import Markdown from '../../components/Markdown';
import ResponsiveSidebar from '../../components/ResponsiveSidebar';

export default function ChatScreen() {
  const ws = useConnection((s) => s.ws);
  const {
    sessions, activeSessionId, createSession, setActiveSession, removeSession,
    addUserMessage,
  } = useChat();

  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [activeSession?.messages.length, activeSession?.statusText]);

  const handleSend = () => {
    if (!input.trim() || !ws || !activeSessionId) return;
    addUserMessage(activeSessionId, input.trim());
    ws.sendMessage(input.trim(), activeSessionId);
    setInput('');
  };

  const handleKeyDown = (e: any) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const sidebarContent = (
    <View style={styles.sidebarInner}>
      <TouchableOpacity style={styles.newChatBtn} onPress={createSession}>
        <Text style={styles.newChatText}>+ New Chat</Text>
      </TouchableOpacity>

      <ScrollView style={styles.sessionList}>
        {sessions.map((ses) => (
          <TouchableOpacity
            key={ses.id}
            style={[
              styles.sessionItem,
              ses.id === activeSessionId && styles.sessionActive,
            ]}
            onPress={() => setActiveSession(ses.id)}
            onLongPress={() => removeSession(ses.id)}
          >
            <Text style={styles.sessionTitle} numberOfLines={1}>
              {ses.title}
            </Text>
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
            <ScrollView
              ref={scrollRef}
              style={styles.messages}
              contentContainerStyle={styles.messagesContent}
            >
              {activeSession.messages.map((msg) => (
                <View
                  key={msg.id}
                  style={[
                    styles.bubble,
                    msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
                  ]}
                >
                  {msg.role === 'assistant' ? (
                    <Markdown text={msg.text} />
                  ) : (
                    <Text style={[styles.bubbleText, styles.userText]}>
                      {msg.text}
                    </Text>
                  )}
                </View>
              ))}

              {activeSession.isProcessing && (
                <View style={[styles.bubble, styles.statusBubble]}>
                  <Text style={styles.statusText}>
                    ⏳ {activeSession.statusText || 'Thinking...'}
                  </Text>
                </View>
              )}
            </ScrollView>

            <View style={styles.inputBar}>
              {Platform.OS === 'web' ? (
                <textarea
                  value={input}
                  onChange={(e: any) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Send a message..."
                  rows={1}
                  style={{
                    flex: 1,
                    backgroundColor: '#F5F5F5',
                    borderRadius: 20,
                    border: '1px solid #E8E8E8',
                    paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 10,
                    color: '#1a1a1a', fontSize: 14,
                    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                    maxHeight: 120, resize: 'none', outline: 'none',
                  } as any}
                />
              ) : (
                <TextInput
                  style={styles.textInput}
                  value={input}
                  onChangeText={setInput}
                  placeholder="Send a message..."
                  placeholderTextColor="#999"
                  onSubmitEditing={handleSend}
                  returnKeyType="send"
                  multiline
                />
              )}
              <TouchableOpacity
                style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
                onPress={handleSend}
                disabled={!input.trim() || activeSession.isProcessing}
              >
                <Text style={styles.sendText}>↑</Text>
              </TouchableOpacity>
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
  newChatBtn: {
    backgroundColor: colors.primary, borderRadius: 8, padding: 10,
    alignItems: 'center', marginBottom: 16,
  },
  newChatText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  sessionList: { flex: 1 },
  sessionItem: {
    padding: 10, borderRadius: 8, marginBottom: 2,
    flexDirection: 'row', alignItems: 'center',
  },
  sessionActive: { backgroundColor: '#EBEBEB' },
  sessionTitle: { color: '#444', flex: 1, fontSize: 13 },
  processingDot: { color: colors.primary, fontSize: 10, marginLeft: 6 },

  chatArea: { flex: 1, flexDirection: 'column', backgroundColor: '#FAFAFA' },
  messages: { flex: 1 },
  messagesContent: { padding: 24, paddingBottom: 8 },
  bubble: { maxWidth: '75%', borderRadius: 12, padding: 14, marginBottom: 10 },
  userBubble: { backgroundColor: colors.primary, alignSelf: 'flex-end' },
  assistantBubble: {
    backgroundColor: '#FFFFFF', alignSelf: 'flex-start',
    borderWidth: 1, borderColor: '#EBEBEB',
  },
  statusBubble: { backgroundColor: 'transparent', alignSelf: 'flex-start', padding: 8 },
  bubbleText: { color: '#1a1a1a', fontSize: 14, lineHeight: 21 },
  userText: { color: '#FFFFFF' },
  statusText: { color: '#999', fontSize: 13, fontStyle: 'italic' },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    padding: 12, paddingHorizontal: 20,
    borderTopWidth: 1, borderTopColor: '#EBEBEB', backgroundColor: '#FFFFFF',
  },
  textInput: {
    flex: 1, backgroundColor: '#F5F5F5', borderRadius: 20,
    borderWidth: 1, borderColor: '#E8E8E8',
    paddingHorizontal: 16, paddingVertical: 10, color: '#1a1a1a', fontSize: 14, maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: colors.primary, width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', marginLeft: 8,
  },
  sendBtnDisabled: { opacity: 0.3 },
  sendText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#999', fontSize: 15 },
});

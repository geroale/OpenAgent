/**
 * Chat state: multiple sessions, messages, processing status.
 */

import { create } from 'zustand';
import type { ChatMessage, ChatSession, ServerMessage } from '../../common/types';

let nextMsgId = 1;
const genId = () => `msg-${nextMsgId++}-${Date.now()}`;

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;

  createSession: () => string;
  setActiveSession: (id: string) => void;
  removeSession: (id: string) => void;
  addUserMessage: (sessionId: string, text: string) => void;
  handleServerMessage: (msg: ServerMessage) => void;
  clearAll: () => void;
}

export const useChat = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,

  createSession: () => {
    const id = `session-${Date.now()}`;
    const session: ChatSession = {
      id,
      title: 'New Chat',
      messages: [],
      isProcessing: false,
    };
    set((s) => ({
      sessions: [...s.sessions, session],
      activeSessionId: id,
    }));
    return id;
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  removeSession: (id) => set((s) => {
    const sessions = s.sessions.filter((ses) => ses.id !== id);
    const activeSessionId = s.activeSessionId === id
      ? (sessions[0]?.id ?? null)
      : s.activeSessionId;
    return { sessions, activeSessionId };
  }),

  addUserMessage: (sessionId, text) => set((s) => ({
    sessions: s.sessions.map((ses) =>
      ses.id !== sessionId ? ses : {
        ...ses,
        isProcessing: true,
        statusText: 'Thinking...',
        messages: [...ses.messages, {
          id: genId(),
          role: 'user' as const,
          text,
          timestamp: Date.now(),
        }],
        title: ses.messages.length === 0 ? text.slice(0, 40) : ses.title,
      },
    ),
  })),

  handleServerMessage: (msg) => set((s) => {
    if (msg.type === 'status') {
      return {
        sessions: s.sessions.map((ses) =>
          ses.id !== msg.session_id ? ses : { ...ses, statusText: msg.text },
        ),
      };
    }

    if (msg.type === 'response') {
      return {
        sessions: s.sessions.map((ses) =>
          ses.id !== msg.session_id ? ses : {
            ...ses,
            isProcessing: false,
            statusText: undefined,
            messages: [...ses.messages, {
              id: genId(),
              role: 'assistant' as const,
              text: msg.text,
              timestamp: Date.now(),
              attachments: msg.attachments ?? undefined,
            }],
          },
        ),
      };
    }

    if (msg.type === 'error') {
      const activeId = s.activeSessionId;
      return {
        sessions: s.sessions.map((ses) =>
          ses.id !== activeId ? ses : {
            ...ses,
            isProcessing: false,
            statusText: undefined,
            messages: [...ses.messages, {
              id: genId(),
              role: 'assistant' as const,
              text: `Error: ${msg.text}`,
              timestamp: Date.now(),
            }],
          },
        ),
      };
    }

    return {};
  }),

  clearAll: () => set({ sessions: [], activeSessionId: null }),
}));

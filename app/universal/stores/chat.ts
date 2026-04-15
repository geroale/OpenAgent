/**
 * Chat state: multiple sessions, messages, processing status.
 */

import { create } from 'zustand';
import type { Attachment, ChatMessage, ChatSession, ServerMessage, ToolInfo } from '../../common/types';

let nextMsgId = 1;
const genId = () => `msg-${nextMsgId++}-${Date.now()}`;

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;

  createSession: () => string;
  setActiveSession: (id: string) => void;
  removeSession: (id: string) => void;
  addUserMessage: (sessionId: string, text: string, attachments?: Attachment[]) => void;
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

  addUserMessage: (sessionId, text, attachments) => set((s) => ({
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
          attachments: attachments && attachments.length ? attachments : undefined,
        }],
        title: ses.messages.length === 0
          ? (text.slice(0, 40) || attachments?.[0]?.filename || 'New Chat')
          : ses.title,
      },
    ),
  })),

  handleServerMessage: (msg) => set((s) => {
    if (msg.type === 'status') {
      const text = msg.text || '';

      // Try to parse as structured tool event
      let toolInfo: ToolInfo | undefined;
      try {
        const parsed = JSON.parse(text);
        if (parsed && parsed.tool) toolInfo = parsed as ToolInfo;
      } catch { /* plain text status */ }

      if (toolInfo) {
        return {
          sessions: s.sessions.map((ses) => {
            if (ses.id !== msg.session_id) return ses;
            if (toolInfo!.status === 'running') {
              // New tool → add message
              return {
                ...ses,
                statusText: `Using ${toolInfo!.tool}...`,
                messages: [...ses.messages, {
                  id: genId(),
                  role: 'tool' as const,
                  text: `Using ${toolInfo!.tool}...`,
                  timestamp: Date.now(),
                  toolInfo,
                }],
              };
            }
            // done/error → update the existing running tool message
            const msgs = [...ses.messages];
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].toolInfo?.tool === toolInfo!.tool && msgs[i].toolInfo?.status === 'running') {
                msgs[i] = { ...msgs[i], toolInfo: toolInfo! };
                break;
              }
            }
            return { ...ses, messages: msgs };
          }),
        };
      }

      // Legacy plain text tool status ("Using ...")
      const isTool = text.startsWith('Using ');
      return {
        sessions: s.sessions.map((ses) => {
          if (ses.id !== msg.session_id) return ses;
          if (isTool) {
            return {
              ...ses,
              statusText: text,
              messages: [...ses.messages, {
                id: genId(),
                role: 'tool' as const,
                text,
                timestamp: Date.now(),
              }],
            };
          }
          return { ...ses, statusText: text };
        }),
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
              model: msg.model,
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

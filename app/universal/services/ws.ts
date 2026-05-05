/**
 * WebSocket client for OpenAgent.
 * Works on all platforms (React Native, Web, Electron).
 */

import type { ClientMessage, ServerMessage } from '../../common/types';

export type MessageHandler = (msg: ServerMessage) => void;

export class OpenAgentWS {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private handlers: Set<MessageHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  // Sessions we've already ``session_open``'d on the current WS. The
  // gateway tears down server-side StreamSessions on WS drop, so we
  // wipe this set on every (re)connect — the next ``sendMessage`` call
  // for a given session_id will lazily re-open it.
  private openedSessions: Set<string> = new Set();
  // Outbound buffer for messages produced while the socket isn't OPEN
  // (CONNECTING / CLOSING / closed during the 3-second reconnect
  // window). Without this, ``send()`` was a silent no-op and messages
  // typed during a reconnect blink were lost — the chat UI showed
  // "Thinking..." forever because the user message never reached the
  // gateway. Drained on auth_ok (server confirmed we're authenticated)
  // so frames aren't sent before the auth gate accepts them. Capped to
  // protect against pathological reconnect loops.
  private pendingOut: string[] = [];
  private static MAX_PENDING = 200;
  private authed = false;

  constructor(url: string, token?: string) {
    this.url = url;
    // Auth is enforced by the loopback sidecar transport; the legacy
    // token field is preserved so the AUTH frame still parses on the
    // server side, but it can be omitted (default empty string).
    this.token = token ?? '';
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('[WS] connected, sending auth...');
      // Fresh WS → server-side StreamSessions for our prior sessions
      // are gone. Drop the cached "we already opened it" tracking so
      // the next sendMessage re-opens.
      this.openedSessions.clear();
      this.authed = false;
      // Auth is the only frame the server accepts pre-auth; everything
      // else has to wait for ``auth_ok`` before draining.
      this.ws?.send(JSON.stringify({ type: 'auth', token: this.token }));
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        // Server confirmed auth — release any messages typed while we
        // were CONNECTING or in the reconnect window.
        if ((msg as { type?: string }).type === 'auth_ok' && !this.authed) {
          this.authed = true;
          this.flushPending();
        }
        this.handlers.forEach((h) => h(msg));
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = (event) => {
      console.log(`[WS] closed: code=${event.code} reason=${event.reason}`);
      this.openedSessions.clear();
      this.authed = false;
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    };

    this.ws.onerror = (event) => {
      console.error('[WS] error:', event);
      this.ws?.close();
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.openedSessions.clear();
    this.pendingOut = [];
    this.authed = false;
    this.ws?.close();
    this.ws = null;
  }

  send(msg: ClientMessage): void {
    const payload = JSON.stringify(msg);
    // Auth gate: server rejects any non-auth frame before ``auth_ok``,
    // so even on an OPEN socket we queue until handshake completes.
    if (this.ws?.readyState === WebSocket.OPEN && this.authed) {
      this.ws.send(payload);
      return;
    }
    if (this.pendingOut.length >= OpenAgentWS.MAX_PENDING) {
      // Pathological case — drop oldest to keep memory bounded. The
      // user's most recent intent is more useful than the stalest one.
      this.pendingOut.shift();
    }
    this.pendingOut.push(payload);
  }

  private flushPending(): void {
    if (!this.pendingOut.length) return;
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const queue = this.pendingOut;
    this.pendingOut = [];
    for (const payload of queue) ws.send(payload);
  }

  /** Send a typed user message into the user's stream session.
   *
   * Lazily opens a ``batched``-profile stream session on the first
   * call for a given ``sessionId`` (with ``speak: false`` by default
   * so chat-tab typed messages don't trigger TTS), then pushes a
   * ``text_final`` frame. The legacy ``message`` wire frame is no
   * longer used — every message flows through ``StreamSession``, the
   * same primitive voice mode uses.
   *
   * ``options.source`` should be ``"stt"`` for transcribed voice
   * notes (mirrors the bridge convention) — the stream session's
   * STT-bypass kicks in (instant barge-in) AND the mirror-modality
   * rule re-enables TTS for the reply even when the session was
   * opened with ``speak: false``.
   */
  sendMessage(
    text: string,
    sessionId: string,
    options?: { source?: 'user_typed' | 'stt' | 'system' },
  ): void {
    if (!this.openedSessions.has(sessionId)) {
      this.sendSessionOpen(sessionId, {
        profile: 'batched',
        clientKind: 'webapp-chat',
        // Chat-tab sessions stay silent on typed-text replies. Voice
        // notes (source="stt") still get spoken replies via the
        // mirror-modality rule on the server side.
        speak: false,
      });
    }
    this.sendTextFinal(sessionId, text, { source: options?.source ?? 'user_typed' });
  }

  sendCommand(
    name: ClientMessage & { type: 'command' } extends { name: infer N } ? N : never,
    sessionId?: string,
  ): void {
    // Scope scope-sensitive commands (stop/new/clear/reset) to the
    // specific chat tab so other tabs stay intact. Pass `undefined` for
    // global admin commands (help/usage/update/restart).
    const payload: any = { type: 'command', name };
    if (sessionId !== undefined) payload.session_id = sessionId;
    this.send(payload);
  }

  // ── Stream protocol helpers (audio/video bytes go base64 on the wire) ─

  /** Open a long-lived stream session. Idempotent within one WS
   *  lifetime; on reconnect the cache is wiped and the next caller
   *  re-sends ``session_open``. */
  sendSessionOpen(
    sessionId: string,
    options?: {
      profile?: 'realtime' | 'batched';
      llmPin?: string;
      sttPin?: string;
      ttsPin?: string;
      language?: string;
      clientKind?: string;
      coalesceWindowMs?: number;
      // Default true (matches voice-mode UX). Set to ``false`` for
      // chat-style sessions where typed replies should stay silent
      // even when a TTS provider is configured.
      speak?: boolean;
    },
  ): void {
    if (this.openedSessions.has(sessionId)) return;
    const profile = options?.profile ?? 'realtime';
    const speak = options?.speak ?? true;
    this.send({
      type: 'session_open',
      session_id: sessionId,
      profile,
      llm_pin: options?.llmPin,
      stt_pin: options?.sttPin,
      tts_pin: options?.ttsPin,
      language: options?.language,
      client_kind: options?.clientKind,
      coalesce_window_ms: options?.coalesceWindowMs,
      speak,
    });
    this.openedSessions.add(sessionId);
  }

  /** Close a previously-opened stream session. */
  sendSessionClose(sessionId: string): void {
    this.send({ type: 'session_close', session_id: sessionId });
    this.openedSessions.delete(sessionId);
  }

  /** Push one audio chunk into a realtime session. */
  sendAudioChunkIn(
    sessionId: string,
    base64: string,
    options?: { endOfSpeech?: boolean; sampleRate?: number; encoding?: string },
  ): void {
    this.send({
      type: 'audio_chunk_in',
      session_id: sessionId,
      data: base64,
      end_of_speech: options?.endOfSpeech,
      sample_rate: options?.sampleRate,
      encoding: options?.encoding,
    });
  }

  /** Mark end-of-speech without sending a final audio chunk. */
  sendAudioEndIn(sessionId: string): void {
    this.send({ type: 'audio_end_in', session_id: sessionId });
  }

  /** Push one video frame into a realtime session. */
  sendVideoFrame(
    sessionId: string,
    stream: string,
    base64: string,
    options?: { width?: number; height?: number; keyframe?: boolean },
  ): void {
    this.send({
      type: 'video_frame',
      session_id: sessionId,
      stream,
      data: base64,
      width: options?.width,
      height: options?.height,
      keyframe: options?.keyframe,
    });
  }

  /** Commit a typed user message into a realtime session (alternative
   * to the legacy ``message`` frame for stream-aware clients). */
  sendTextFinal(
    sessionId: string,
    text: string,
    options?: { source?: 'user_typed' | 'stt' | 'system' },
  ): void {
    this.send({
      type: 'text_final',
      session_id: sessionId,
      text,
      source: options?.source ?? 'user_typed',
    });
  }

  /** Stream a partial typed text delta (ghost-text preview UI). */
  sendTextDelta(sessionId: string, text: string, final = false): void {
    this.send({
      type: 'text_delta',
      session_id: sessionId,
      text,
      final,
    });
  }

  /** Trigger barge-in. Cancels the active assistant turn (if any). */
  sendInterrupt(
    sessionId: string,
    reason: 'user_speech' | 'user_text' | 'manual' = 'manual',
  ): void {
    this.send({ type: 'interrupt', session_id: sessionId, reason });
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

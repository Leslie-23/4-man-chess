"use client";

import type { PlayerColor } from "@fourman/game-engine";
import { MAX_CHAT_LENGTH, type AckResult, type ChatMessage } from "@fourman/shared";
import { useEffect, useRef, useState, type FormEvent } from "react";

interface ChatProps {
  messages: ChatMessage[];
  /** Our seat, so our own lines can be marked. */
  color: PlayerColor | null;
  onSend: (text: string) => Promise<AckResult>;
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The room's message board: players, spectators and the server's bots. */
export function Chat({ messages, color, onSend }: ChatProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLOListElement>(null);

  // Follow new messages, unless the reader has scrolled up to look back.
  const newest = messages.at(-1)?.id;
  useEffect(() => {
    const el = list.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [newest]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || sending) return;
    setSending(true);
    const result = await onSend(draft);
    setSending(false);
    setError(result.ok ? null : result.error);
    if (result.ok) setDraft("");
  };

  return (
    <div className="chat">
      <ol className="chat-list" ref={list} aria-live="polite">
        {messages.length === 0 && <li className="muted small-text">No messages yet. Say hi.</li>}
        {messages.map((m) => (
          <li key={m.id} className={m.color !== null && m.color === color && !m.bot ? "chat-line mine" : "chat-line"}>
            <span className={m.color ? `swatch ${m.color}` : "swatch spectator"} />
            <span className="chat-body">
              <strong>{m.name}</strong>
              {m.bot && <span className="chat-tag">bot</span>}
              {!m.color && <span className="chat-tag">watching</span>}
              <span className="chat-time">{time(m.at)}</span>
              <span className="chat-text">{m.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <form className="inline" onSubmit={(e) => void submit(e)}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_CHAT_LENGTH}
          placeholder="Message the table"
          aria-label="Chat message"
        />
        <button type="submit" className="primary" disabled={!draft.trim() || sending}>Send</button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

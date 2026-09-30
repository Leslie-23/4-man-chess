"use client";

import { MAX_CHAT_LENGTH, type AckResult, type ChatMessage } from "@fourman/shared";
import { useEffect, useRef, useState, type FormEvent } from "react";

/** The table's message board. */
export function Chat({ messages, onSend }: { messages: ChatMessage[]; onSend: (text: string) => Promise<AckResult> }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const newest = messages.at(-1)?.id;
  useEffect(() => {
    const el = list.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [newest]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    const result = await onSend(draft);
    setError(result.ok ? null : result.error);
    if (result.ok) setDraft("");
  };

  return (
    <div className="chat">
      <ol className="chat-list" ref={list}>
        {messages.length === 0 && <li className="muted small">No messages yet. Trash talk is encouraged.</li>}
        {messages.map((m) => (
          <li key={m.id}>
            <strong>{m.name}</strong> <span>{m.text}</span>
          </li>
        ))}
      </ol>
      <form className="inline" onSubmit={(e) => void submit(e)}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={MAX_CHAT_LENGTH} placeholder="Message the table" aria-label="Chat message" />
        <button type="submit" className="primary" disabled={!draft.trim()}>Send</button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

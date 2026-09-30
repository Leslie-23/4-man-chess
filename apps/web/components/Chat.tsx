"use client";

import type { PlayerColor } from "@fourman/game-engine";
import { MAX_CHAT_LENGTH, MOVE_TIME_OPTIONS, type AckResult, type ChatMessage, type MovePoll } from "@fourman/shared";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useCountdown } from "../lib/useCountdown";

interface ChatProps {
  messages: ChatMessage[];
  /** Our seat, so our own lines can be marked. */
  color: PlayerColor | null;
  onSend: (text: string) => Promise<AckResult>;
  /** The time-per-move vote, when one is open. */
  poll: MovePoll | null;
  pollDeadline: number | null;
  moveSeconds: number | null;
  /** Whether we may open a poll: seated people only, before the game ends. */
  canStartPoll: boolean;
  onStartPoll: () => Promise<AckResult>;
  onVote: (seconds: number | null) => Promise<AckResult>;
  /** Display name per seat, for "who voted". */
  who: (color: PlayerColor) => string;
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const optionLabel = (seconds: number | null) => (seconds === null ? "No limit" : `${seconds}s`);

/** The room's message board: players, spectators, the server's bots, and the time-per-move poll. */
export function Chat(props: ChatProps) {
  const { messages, color, onSend, poll, moveSeconds, canStartPoll, onStartPoll } = props;
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

  const run = async (action: () => Promise<AckResult>) => {
    const result = await action();
    setError(result.ok ? null : result.error);
    return result.ok;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || sending) return;
    setSending(true);
    const ok = await run(() => onSend(draft));
    setSending(false);
    if (ok) setDraft("");
  };

  return (
    <div className="chat">
      {poll && <PollCard poll={poll} deadline={props.pollDeadline} color={color} who={props.who} onVote={(s) => void run(() => props.onVote(s))} />}
      <ol className="chat-list" ref={list} aria-live="polite">
        {messages.length === 0 && <li className="muted small-text">No messages yet. Say hi.</li>}
        {messages.map((m) =>
          m.system ? (
            <li key={m.id} className="chat-notice">{m.text}</li>
          ) : (
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
          ),
        )}
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
      <div className="chat-tools">
        <span className="muted">Time per move: <strong>{moveSeconds === null ? "no limit" : `${moveSeconds}s`}</strong></span>
        {canStartPoll && !poll && (
          <button type="button" className="tiny" onClick={() => void run(onStartPoll)}>Start a vote</button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

interface PollCardProps {
  poll: MovePoll;
  deadline: number | null;
  color: PlayerColor | null;
  who: (color: PlayerColor) => string;
  onVote: (seconds: number | null) => void;
}

function PollCard({ poll, deadline, color, onVote, who }: PollCardProps) {
  const left = useCountdown(deadline);
  const mine = color && color in poll.votes ? poll.votes[color] : undefined;
  const canVote = color !== null && poll.voters.includes(color);
  const voted = Object.keys(poll.votes).length;

  return (
    <div className="poll" role="group" aria-label="Vote on time per move">
      <div className="poll-head">
        <strong>How long per move?</strong>
        <span className="muted">
          {voted}/{poll.voters.length} voted{left !== null && ` · ${left}s left`}
        </span>
      </div>
      <div className="poll-options">
        {MOVE_TIME_OPTIONS.map((seconds) => {
          const voters = poll.voters.filter((c) => c in poll.votes && poll.votes[c] === seconds);
          return (
            <button
              key={String(seconds)}
              type="button"
              className={mine === seconds ? "poll-option on" : "poll-option"}
              aria-pressed={mine === seconds}
              disabled={!canVote}
              onClick={() => onVote(seconds)}
              title={voters.map(who).join(", ") || undefined}
            >
              <span>{optionLabel(seconds)}</span>
              <span className="poll-count">{voters.length}</span>
            </button>
          );
        })}
      </div>
      {!canVote && <p className="muted small-text">Only the people playing get a vote.</p>}
    </div>
  );
}

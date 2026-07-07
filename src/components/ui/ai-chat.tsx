'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bot, ChevronDown, Loader2, Send, Sparkles, User, X,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Role = 'user' | 'assistant';

interface Message {
  id: string;
  role: Role;
  text: string;
  ts: number;
  error?: boolean;
}

// ── Markdown-lite renderer ────────────────────────────────────────────────────
// Handles **bold**, `code`, bullet lists, and line breaks — no deps needed.

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, li) => {
    // bullet
    const bulletMatch = line.match(/^[-•*]\s+(.*)/);
    const content = bulletMatch ? bulletMatch[1] : line;

    const parts: React.ReactNode[] = [];
    let remaining = content;
    let key = 0;

    while (remaining.length > 0) {
      // **bold**
      const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)/s);
      // `code`
      const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)/s);

      if (boldMatch && (!codeMatch || boldMatch[1].length <= codeMatch[1].length)) {
        if (boldMatch[1]) parts.push(<span key={key++}>{boldMatch[1]}</span>);
        parts.push(<strong key={key++} className="font-semibold text-text">{boldMatch[2]}</strong>);
        remaining = boldMatch[3];
      } else if (codeMatch) {
        if (codeMatch[1]) parts.push(<span key={key++}>{codeMatch[1]}</span>);
        parts.push(
          <code key={key++} className="rounded bg-surface-hover px-1 py-0.5 font-mono text-xs text-primary">
            {codeMatch[2]}
          </code>,
        );
        remaining = codeMatch[3];
      } else {
        parts.push(<span key={key++}>{remaining}</span>);
        break;
      }
    }

    if (bulletMatch) {
      return (
        <div key={li} className="flex gap-2 items-start">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
          <span>{parts}</span>
        </div>
      );
    }
    return (
      <div key={li} className={line.trim() === '' ? 'h-2' : ''}>
        {parts}
      </div>
    );
  });
}

// ── Suggestion chips ──────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'Show my wallets and balances',
  'What mints are active right now?',
  'Check system status',
  'Show my mint history',
  'What are my execution settings?',
];

// ── Main component ────────────────────────────────────────────────────────────

export function AIChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const msgCounter = useRef(0);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Focus input when chat opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const uid = ++msgCounter.current;
    const userMsg: Message = {
      id: `u-${uid}`,
      role: 'user',
      text: trimmed,
      ts: uid,
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // Build history including the new user message we just added
      const history = [...messages].map(m => ({
        role: m.role,
        content: m.text,
      }));

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });

      const data = await res.json() as { reply?: string; error?: string; shortcut?: boolean };

      const aid = ++msgCounter.current;
      const replyText = data.reply ?? data.error ?? 'Something went wrong.';
      const aiMsg: Message = {
        id: `a-${aid}`,
        role: 'assistant',
        text: data.shortcut ? `⚡ Direct mint (no AI)\n\n${replyText}` : replyText,
        ts: aid,
        error: !!data.error || !res.ok,
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch {
      const eid = ++msgCounter.current;
      setMessages(prev => [...prev, {
        id: `a-${eid}`,
        role: 'assistant',
        text: 'Network error — please try again.',
        ts: eid,
        error: true,
      }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <>
      {/* ── Floating trigger button ─────────────────────────────────────── */}
      <button
        onClick={() => setOpen(v => !v)}
        aria-label={open ? 'Close AI chat' : 'Open AI chat'}
        className={`
          fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center
          rounded-full shadow-lg transition-all duration-300
          ${open
            ? 'bg-surface border border-border text-muted hover:text-text'
            : 'bg-primary text-white hover:opacity-90 hover:scale-105'}
        `}
      >
        {open
          ? <ChevronDown className="h-5 w-5" />
          : (
            <span className="relative flex items-center justify-center">
              <Sparkles className="h-6 w-6" />
              <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-success border-2 border-white" />
            </span>
          )
        }
      </button>

      {/* ── Chat panel ─────────────────────────────────────────────────── */}
      <div
        className={`
          fixed bottom-24 right-6 z-50 flex flex-col
          w-[min(420px,calc(100vw-3rem))] h-[min(600px,calc(100vh-8rem))]
          rounded-2xl border border-border bg-surface shadow-2xl
          transition-all duration-300 origin-bottom-right
          ${open ? 'scale-100 opacity-100 pointer-events-auto' : 'scale-95 opacity-0 pointer-events-none'}
        `}
        role="dialog"
        aria-label="AutoMint AI chat"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 rounded-t-2xl border-b border-border bg-surface px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text">AutoMint AI</p>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
              <p className="text-xs text-muted">Online · 45 tools available</p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-text transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {isEmpty && (
            <div className="flex flex-col items-center gap-4 pt-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <Sparkles className="h-7 w-7 text-primary" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-text">AutoMint AI</p>
                <p className="mt-1 text-sm text-muted leading-relaxed">
                  I can manage your wallets, queue mints, analyze contracts,
                  track whales, and more. Just tell me what you need.
                </p>
              </div>

              {/* Suggestion chips */}
              <div className="flex flex-col gap-2 w-full mt-2">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => void sendMessage(s)}
                    className="text-left rounded-xl border border-border px-3 py-2 text-sm text-secondary hover:bg-surface-hover hover:text-text hover:border-border-strong transition-all duration-150"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {/* Avatar */}
              <div className={`
                shrink-0 flex h-7 w-7 items-center justify-center rounded-full mt-0.5
                ${msg.role === 'user' ? 'bg-primary/20' : 'bg-primary/10'}
              `}>
                {msg.role === 'user'
                  ? <User className="h-3.5 w-3.5 text-primary" />
                  : <Bot className="h-3.5 w-3.5 text-primary" />
                }
              </div>

              {/* Bubble */}
              <div className={`
                max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed space-y-0.5
                ${msg.role === 'user'
                  ? 'bg-primary text-white rounded-tr-sm'
                  : msg.error
                    ? 'bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-tl-sm'
                    : 'bg-surface-hover border border-border text-text rounded-tl-sm'
                }
              `}>
                {msg.role === 'user'
                  ? <p>{msg.text}</p>
                  : <div className="space-y-0.5">{renderMarkdown(msg.text)}</div>
                }
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div className="flex gap-2.5">
              <div className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-border bg-surface-hover px-3.5 py-3">
                <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce [animation-delay:0ms]" />
                <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce [animation-delay:150ms]" />
                <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="shrink-0 border-t border-border px-3 py-3">
          <div className="flex items-end gap-2 rounded-xl border border-border bg-surface-hover px-3 py-2 focus-within:border-primary/40 transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message AutoMint AI…"
              rows={1}
              disabled={loading}
              className="flex-1 resize-none bg-transparent text-sm text-text placeholder:text-muted outline-none max-h-32 leading-relaxed disabled:opacity-50"
              style={{ height: 'auto', minHeight: '24px' }}
              onInput={e => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }}
            />
            <button
              onClick={() => void sendMessage(input)}
              disabled={!input.trim() || loading}
              className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              aria-label="Send message"
            >
              {loading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Send className="h-3.5 w-3.5" />
              }
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-muted/60">
            Press <kbd className="font-mono">Enter</kbd> to send · <kbd className="font-mono">Shift+Enter</kbd> for new line
          </p>
        </div>
      </div>
    </>
  );
}

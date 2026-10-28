import { useEffect, useRef, useState } from "react";
import Button from "./ui/Button.jsx";

const formatMessageTime = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

export default function RoomChat({
  messages,
  userId,
  loading,
  error,
  sendError,
  unreadCount,
  onSend,
  onRetry,
  onOpened,
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const messageListRef = useRef(null);
  const shouldScrollToBottomRef = useRef(true);

  useEffect(() => {
    if (shouldScrollToBottomRef.current && messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    onOpened();
  }, [onOpened]);

  const submitMessage = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      await onSend(text);
      setDraft("");
    } catch {
      // The parent displays the server-provided send error.
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="flex min-h-0 h-full flex-col" aria-label="Room chat">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-700 px-3 py-3">
        <div>
          <h2 className="font-semibold">In-call messages</h2>
          <p className="text-xs text-neutral-300">Messages are visible to room members</p>
        </div>
        {unreadCount > 0 && (
          <span className="rounded-full bg-blue-600 px-2.5 py-1 text-xs font-semibold" aria-label={`${unreadCount} unread messages`}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </header>

      <div
        ref={messageListRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        onScroll={(event) => {
          const element = event.currentTarget;
          shouldScrollToBottomRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
      >
        {loading && messages.length === 0 && (
          <p className="py-6 text-center text-sm text-neutral-300">Loading messages…</p>
        )}
        {!loading && messages.length === 0 && !error && (
          <p className="py-6 text-center text-sm text-neutral-300">
            No messages yet. Start the conversation.
          </p>
        )}
        {error && (
          <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100" role="alert">
            <p>{error}</p>
            <Button type="button" variant="ghost" size="md" onClick={onRetry} className="mt-2 min-h-10 rounded-md px-2 font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300">
              Retry
            </Button>
          </div>
        )}
        {messages.map((message) => {
          const ownMessage = message.senderId === userId;
          return (
            <article
              key={message.id}
              className={`max-w-[92%] rounded-xl px-3 py-2 ${
                ownMessage
                  ? "ml-auto bg-blue-600 text-white"
                  : "mr-auto bg-slate-800 text-neutral-100"
              }`}
            >
              <div className="mb-1 flex min-w-0 items-baseline justify-between gap-3">
                <p className="truncate text-xs font-semibold">
                  {ownMessage ? "You" : message.senderName}
                </p>
                <time className="shrink-0 text-[10px] opacity-75" dateTime={message.createdAt}>
                  {formatMessageTime(message.createdAt)}
                </time>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                {message.text}
              </p>
            </article>
          );
        })}
      </div>

      <form onSubmit={submitMessage} className="shrink-0 border-t border-slate-700 p-3">
        <label htmlFor="room-chat-input" className="sr-only">Write a room message</label>
        <div className="flex items-end gap-2">
          <textarea
            id="room-chat-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 1000))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={2}
            maxLength={1000}
            placeholder="Send a message"
            className="min-h-11 min-w-0 flex-1 resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-neutral-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
          />
          <Button
            type="submit"
            disabled={!draft.trim() || sending}
            loading={sending}
            variant="primary"
            size="md"
            className="min-h-11 shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
        {sendError && <p className="mt-2 text-xs text-red-200" role="alert">{sendError}</p>}
        <p className="mt-1 text-right text-[10px] text-neutral-400">Enter to send · Shift + Enter for a new line</p>
      </form>
    </section>
  );
}

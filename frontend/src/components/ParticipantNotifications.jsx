function ParticipantToast({ notification }) {
  const message = notification.action === "joined"
    ? `${notification.username} joined the room`
    : `${notification.username} left the room`;

  return (
    <li
      className="participant-toast flex items-center gap-3 rounded-xl border border-[#D1D5DB] bg-white px-4 py-3 text-sm text-[#1F2937] shadow-lg"
      role="status"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#EFF4FF] font-semibold text-[#003399]">
        {notification.username.trim().charAt(0).toUpperCase() || "?"}
      </span>
      <span className="min-w-0 flex-1 break-words">{message}</span>
    </li>
  );
}

export default function ParticipantNotifications({ notifications }) {
  if (notifications.length === 0) return null;

  return (
    <ol
      className="pointer-events-none fixed right-3 top-20 z-50 flex w-[calc(100%-1.5rem)] max-w-sm flex-col gap-2 sm:right-6 sm:top-24"
      aria-live="polite"
      aria-label="Participant activity"
    >
      {notifications.map((notification) => (
        <ParticipantToast key={notification.id} notification={notification} />
      ))}
    </ol>
  );
}

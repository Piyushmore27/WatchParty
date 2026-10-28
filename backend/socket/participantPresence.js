export const getParticipantPresenceKey = (roomCode, userId) =>
  `${roomCode}:${userId}`;

export const hasConnectedParticipantSocket = (onlineUsers, roomCode, userId) => {
  for (const session of onlineUsers.values()) {
    if (
      session.roomCode === roomCode &&
      session.userId === userId &&
      session.isRoomMember &&
      !session.isDisconnected
    ) {
      return true;
    }
  }
  return false;
};

export const getActiveParticipants = (participants, onlineUsers, roomCode) => {
  const activeUserIds = new Set();
  for (const session of onlineUsers.values()) {
    if (session.roomCode === roomCode && session.isRoomMember) {
      activeUserIds.add(session.userId);
    }
  }

  const seenUserIds = new Set();
  const activeParticipants = [];
  for (const { userId, username, role, joinedAt } of participants) {
    if (!activeUserIds.has(userId) || seenUserIds.has(userId)) continue;
    seenUserIds.add(userId);
    activeParticipants.push({ userId, username, role, joinedAt });
  }
  return activeParticipants;
};

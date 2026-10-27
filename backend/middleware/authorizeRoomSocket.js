export const authorizeRoomSocket = async ({
  socket,
  data,
  onlineUsers,
  getRoomByCode,
  allowedRoles,
  requireRoomOwner = false,
}) => {
  if (
    typeof data?.roomCode !== "string" ||
    typeof data?.userId !== "string"
  ) {
    throw new Error("Room code and user ID are required");
  }

  const roomCode = data.roomCode.trim().toUpperCase();
  const session = onlineUsers.get(socket.id);
  if (
    !/^[A-Z0-9]{8}$/.test(roomCode) ||
    !session ||
    session.userId !== data.userId ||
    session.roomCode !== roomCode
  ) {
    throw new Error("Socket session is not authorized");
  }

  const room = await getRoomByCode(roomCode);
  const participant = room.participants.find(
    (person) => person.userId === session.userId
  );
  if (!participant || !allowedRoles.includes(participant.role)) {
    throw new Error(
      allowedRoles.length === 1 && allowedRoles[0] === "Host"
        ? "Only the current Host can perform this action"
        : "You do not have permission to perform this action"
    );
  }
  if (requireRoomOwner && room.hostId !== session.userId) {
    throw new Error("Only the current Host can perform this action");
  }

  return {
    roomCode,
    userId: session.userId,
    role: participant.role,
    room,
  };
};

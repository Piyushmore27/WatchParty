
import Room from "../models/Room.js";
import ChatMessage from "../models/ChatMessage.js";
import crypto from "node:crypto";

export const generateRoomCode = async () => {
  let roomCode;
  let roomExists = true;

  while (roomExists) {
    roomCode = crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase();

    roomExists = await Room.exists({ roomCode });
  }

  return roomCode;
};

export const createRoom = async ({ username, userId, sessionTokenHash }) => {
  const roomCode = await generateRoomCode();

  const room = await Room.create({
    roomCode,
    hostId: userId,
    participants: [
      {
        userId,
        username,
        role: "Host",
        sessionTokenHash,
      },
    ],
    video: {
      videoId: "",
      currentTime: 0,
      playState: "paused",
      syncedAt: new Date(),
    },
  });

  return room;
};


export const createJoinRequest = async ({
  roomCode,
  requestId,
  username,
  userId,
  sessionTokenHash,
}) => {
  const normalizedCode = roomCode.toUpperCase();
  const existingRoom = await Room.findOne({
    roomCode: normalizedCode,
    isActive: true,
  }).select("-__v +joinRequests.sessionTokenHash");
  if (!existingRoom) throw new Error("Room-not-found");

  const existingRequest = existingRoom.joinRequests.find(
    (request) => request.requestId === requestId
  );
  if (existingRequest) {
    if (
      existingRequest.userId !== userId ||
      existingRequest.sessionTokenHash !== sessionTokenHash
    ) {
      throw new Error("Join-request-id-conflict");
    }
    return { request: existingRequest, created: false };
  }
  if (existingRoom.participants.some((participant) => participant.userId === userId)) {
    throw new Error("Already-room-member");
  }
  if (
    existingRoom.joinRequests.some(
      (request) => request.status === "pending" && request.userId === userId
    )
  ) {
    throw new Error("Duplicate-pending-join-request");
  }

  const room = await Room.findOneAndUpdate(
    {
      roomCode: normalizedCode,
      isActive: true,
      "joinRequests.requestId": { $ne: requestId },
      "joinRequests": {
        $not: {
          $elemMatch: {
            userId,
            status: "pending",
          },
        },
      },
    },
    {
      $push: {
        joinRequests: {
          requestId,
          username,
          userId,
          sessionTokenHash,
          status: "pending",
        },
      },
    },
    { new: true, runValidators: true }
  ).select("+joinRequests.sessionTokenHash");

  if (!room) {
    const conflictingRoom = await Room.findOne({
      roomCode: normalizedCode,
      isActive: true,
    }).select("-__v +joinRequests.sessionTokenHash");
    const conflictingRequest = conflictingRoom?.joinRequests.find(
      (request) => request.requestId === requestId
    );
    if (
      conflictingRequest?.userId === userId &&
      conflictingRequest.sessionTokenHash === sessionTokenHash
    ) {
      return { request: conflictingRequest, created: false };
    }
    if (
      conflictingRoom?.joinRequests.some(
        (request) => request.status === "pending" && request.userId === userId
      )
    ) {
      throw new Error("Duplicate-pending-join-request");
    }
    throw new Error("Join-request-conflict");
  }

  return {
    request: room.joinRequests.find((request) => request.requestId === requestId),
    created: true,
  };
};

export const getRoomByCode = async (roomCode, { includeSessionTokenHashes = false } = {}) => {
    let query = Room.findOne({
        roomCode: roomCode.toUpperCase(),
        isActive: true,
    });
    query = includeSessionTokenHashes
      ? query.select("-__v +participants.sessionTokenHash")
      : query.select("-__v");
    const room = await query;

    if(!room){
        throw new Error("Room-not-found");
    }
    return room;
}

export const isParticipantSessionValid = (room, userId, sessionToken) => {
  if (
    typeof sessionToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)
  ) {
    return false;
  }

  const participant = room.participants.find((person) => person.userId === userId);
  if (!participant?.sessionTokenHash) return false;

  const suppliedHash = crypto.createHash("sha256").update(sessionToken).digest();
  const storedHash = Buffer.from(participant.sessionTokenHash, "hex");
  return storedHash.length === suppliedHash.length &&
    crypto.timingSafeEqual(storedHash, suppliedHash);
};

export const getRoomVideoState = (room, now = Date.now()) => {
  const video = room.video || {};
  let currentTime = video.currentTime || 0;
  const syncedAt = video.syncedAt ? new Date(video.syncedAt).getTime() : NaN;

  if (video.playState === "playing" && Number.isFinite(syncedAt)) {
    currentTime += Math.max(0, now - syncedAt) / 1000;
  }

  return {
    videoId: video.videoId || "",
    currentTime,
    playState: video.playState || "paused",
    syncedAt: new Date(now).toISOString(),
  };
};

export const getRecentChatMessages = async (roomCode, limit = 50) => {
  const messages = await ChatMessage.find({
    roomCode: roomCode.toUpperCase(),
  })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 100))
    .lean();

  return messages.reverse().map((message) => ({
    id: message._id.toString(),
    senderId: message.senderId,
    senderName: message.senderName,
    text: message.text,
    createdAt: message.createdAt,
  }));
};

export const saveRoomChatMessage = async ({
  roomCode,
  senderId,
  senderName,
  text,
}) => {
  const message = await ChatMessage.create({
    roomCode: roomCode.toUpperCase(),
    senderId,
    senderName,
    text,
  });
  return {
    id: message._id.toString(),
    senderId: message.senderId,
    senderName: message.senderName,
    text: message.text,
    createdAt: message.createdAt,
  };
};

export const updateRoomVideo = async (roomCode, updates, expectedVideoState) => {
  const normalizedCode = roomCode.toUpperCase();
  const videoUpdates = { ...updates, syncedAt: new Date() };
  const setUpdates = Object.fromEntries(
    Object.entries(videoUpdates).map(([key, value]) => [`video.${key}`, value])
  );
  const filter = { roomCode: normalizedCode, isActive: true };
  if (expectedVideoState?.videoId) {
    filter["video.videoId"] = expectedVideoState.videoId;
  }
  if (expectedVideoState?.playState) {
    filter["video.playState"] = expectedVideoState.playState;
  }
  const room = await Room.findOneAndUpdate(
    filter,
    { $set: setUpdates },
    { new: true, runValidators: true }
  );

  if (!room) {
    throw new Error(expectedVideoState ? "Room-state-changed" : "Room-not-found");
  }

  return room;
};

export const removeRoomParticipant = async (
  roomCode,
  actorUserId,
  targetUserId
) => {
  if (typeof targetUserId !== "string" || targetUserId === actorUserId) {
    throw new Error("Host-cannot-be-removed");
  }

  const room = await Room.findOneAndUpdate(
    {
      roomCode: roomCode.toUpperCase(),
      isActive: true,
      hostId: { $ne: targetUserId },
      $and: [
        {
          participants: {
            $elemMatch: {
              userId: actorUserId,
              role: { $in: ["Host", "Moderator"] },
            },
          },
        },
        {
          participants: {
            $elemMatch: {
              userId: targetUserId,
              role: { $in: ["Participant", "Moderator"] },
            },
          },
        },
      ],
    },
    {
      $pull: {
        participants: {
          userId: targetUserId,
          role: { $in: ["Participant", "Moderator"] },
        },
      },
    },
    { new: true, runValidators: true }
  );

  if (!room) {
    throw new Error("Participant-not-found-or-not-removable");
  }

  return room;
};

export const updateParticipantRole = async (
  roomCode,
  actorUserId,
  targetUserId,
  role
) => {
  if (!["Moderator", "Participant"].includes(role)) {
    throw new Error("Invalid-participant-role");
  }
  if (typeof targetUserId !== "string" || targetUserId === actorUserId) {
    throw new Error("Participant-role-cannot-be-changed");
  }

  const room = await Room.findOneAndUpdate(
    {
      roomCode: roomCode.toUpperCase(),
      isActive: true,
      hostId: { $ne: targetUserId },
      $and: [
        {
          participants: {
            $elemMatch: {
              userId: actorUserId,
              role: { $in: ["Host", "Moderator"] },
            },
          },
        },
        {
          participants: {
            $elemMatch: {
              userId: targetUserId,
              role: { $in: ["Participant", "Moderator"] },
            },
          },
        },
      ],
    },
    { $set: { "participants.$[target].role": role } },
    {
      new: true,
      runValidators: true,
      arrayFilters: [
        {
          "target.userId": targetUserId,
          "target.role": { $in: ["Participant", "Moderator"] },
        },
      ],
    }
  );

  if (!room) {
    throw new Error("Participant-not-found-or-not-manageable");
  }

  return room;
};

export const transferHostAndLeave = async (roomCode, hostUserId) => {
  const normalizedCode = roomCode.toUpperCase();
  const room = await Room.findOne({
    roomCode: normalizedCode,
    isActive: true,
    hostId: hostUserId,
    participants: {
      $elemMatch: { userId: hostUserId, role: "Host" },
    },
  }).select("hostId participants video isActive");

  if (!room) throw new Error("Host-session-invalid");

  const nextHost = room.participants
    .filter((participant) => participant.role === "Moderator")
    .sort((first, second) => first.joinedAt - second.joinedAt)[0];

  if (!nextHost) throw new Error("Host-leave-requires-moderator");

  const updatedRoom = await Room.collection.findOneAndUpdate(
    {
      roomCode: normalizedCode,
      isActive: true,
      hostId: hostUserId,
      $and: [
        {
          participants: {
            $elemMatch: { userId: hostUserId, role: "Host" },
          },
        },
        {
          participants: {
            $elemMatch: {
              userId: nextHost.userId,
              role: "Moderator",
            },
          },
        },
      ],
    },
    [
      {
        $set: {
          hostId: nextHost.userId,
          participants: {
            $filter: {
              input: {
                $map: {
                  input: "$participants",
                  as: "participant",
                  in: {
                    $cond: [
                      { $eq: ["$$participant.userId", nextHost.userId] },
                      { $mergeObjects: ["$$participant", { role: "Host" }] },
                      {
                        $cond: [
                          { $eq: ["$$participant.role", "Host"] },
                          { $mergeObjects: ["$$participant", { role: "Participant" }] },
                          "$$participant",
                        ],
                      },
                    ],
                  },
                },
              },
              as: "participant",
              cond: { $ne: ["$$participant.userId", hostUserId] },
            },
          },
        },
      },
    ],
    {
      returnDocument: "after",
      includeResultMetadata: false,
    }
  );

  if (!updatedRoom) {
    const latestRoom = await Room.findOne({
      roomCode: normalizedCode,
      isActive: true,
      hostId: hostUserId,
    }).select("participants");
    if (!latestRoom) throw new Error("Host-session-invalid");
    if (!latestRoom.participants.some((participant) => participant.role === "Moderator")) {
      throw new Error("Host-leave-requires-moderator");
    }
    throw new Error("Host-departure-conflict");
  }
  return updatedRoom;
};

export const endRoom = async (roomCode, hostUserId) => {
  const room = await Room.findOneAndUpdate(
    {
      roomCode: roomCode.toUpperCase(),
      isActive: true,
      hostId: hostUserId,
      participants: {
        $elemMatch: { userId: hostUserId, role: "Host" },
      },
    },
    { $set: { isActive: false } },
    { new: true }
  );

  if (!room) throw new Error("Host-session-invalid");
  return room;
};

const authorizedManagerFilter = (actorUserId) => ({
  participants: {
    $elemMatch: {
      userId: actorUserId,
      role: { $in: ["Host", "Moderator"] },
    },
  },
});

export const listPendingJoinRequests = async (roomCode, actorUserId) => {
  const room = await Room.findOne({
    roomCode: roomCode.toUpperCase(),
    isActive: true,
    ...authorizedManagerFilter(actorUserId),
  }).select("hostId joinRequests");

  if (!room) throw new Error("Manager-not-authorized");
  return room.joinRequests
    .filter((request) => request.status === "pending")
    .map(({ requestId, userId, username, requestedAt }) => ({
      requestId,
      userId,
      username,
      requestedAt,
    }));
};

export const getJoinRequestStatus = async ({
  roomCode,
  requestId,
  userId,
  sessionTokenHash,
}) => {
  const room = await Room.findOne({
    roomCode: roomCode.toUpperCase(),
    isActive: true,
    joinRequests: {
      $elemMatch: {
        requestId,
        userId,
        sessionTokenHash,
      },
    },
  }).select("+joinRequests.sessionTokenHash");

  if (!room) throw new Error("Join-request-not-found");
  const request = room.joinRequests.find(
    (entry) =>
      entry.requestId === requestId &&
      entry.userId === userId &&
      entry.sessionTokenHash === sessionTokenHash
  );

  if (request.status === "approved") {
    const participant = room.participants.find((entry) => entry.userId === userId);
    if (!participant) throw new Error("Join-request-state-invalid");
    return {
      status: request.status,
      userId,
      role: participant.role,
      room: {
        roomCode: room.roomCode,
        hostId: room.hostId,
        participants: room.participants.map(
          ({ userId: participantId, username, role, joinedAt }) => ({
            userId: participantId,
            username,
            role,
            joinedAt,
          })
        ),
        video: getRoomVideoState(room),
      },
    };
  }

  return {
    status: request.status,
    request: {
      requestId: request.requestId,
      userId: request.userId,
      username: request.username,
      requestedAt: request.requestedAt,
    },
  };
};

export const resolveJoinRequest = async ({
  roomCode,
  actorUserId,
  requestId,
  decision,
}) => {
  if (!["approved", "rejected"].includes(decision)) {
    throw new Error("Invalid-join-request-decision");
  }

  const normalizedCode = roomCode.toUpperCase();
  const resolvedAt = new Date();
  const filter = {
    roomCode: normalizedCode,
    isActive: true,
    joinRequests: {
      $elemMatch: {
        requestId,
        status: "pending",
      },
    },
    ...authorizedManagerFilter(actorUserId),
  };

  if (decision === "approved") {
    const pendingRoom = await Room.findOne({
      roomCode: normalizedCode,
      isActive: true,
      "joinRequests": {
        $elemMatch: {
          requestId,
          status: "pending",
        },
      },
      ...authorizedManagerFilter(actorUserId),
    }).select("+joinRequests.sessionTokenHash");
    const pendingRequest = pendingRoom?.joinRequests.find(
      (entry) => entry.requestId === requestId && entry.status === "pending"
    );
    if (!pendingRequest) throw new Error("Join-request-already-resolved");

    const room = await Room.findOneAndUpdate(
      {
        ...filter,
        $and: [
          {
            participants: {
              $not: { $elemMatch: { userId: pendingRequest.userId } },
            },
          },
        ],
      },
      {
        $set: {
          "joinRequests.$[request].status": "approved",
          "joinRequests.$[request].resolvedAt": resolvedAt,
          "joinRequests.$[request].resolvedBy": actorUserId,
        },
        $push: {
          participants: {
            userId: pendingRequest.userId,
            username: pendingRequest.username,
            sessionTokenHash: pendingRequest.sessionTokenHash,
            role: "Participant",
            joinedAt: resolvedAt,
          },
        },
      },
      {
        new: true,
        runValidators: true,
        arrayFilters: [
          {
            "request.requestId": requestId,
            "request.status": "pending",
          },
        ],
      }
    ).select("+joinRequests.sessionTokenHash +participants.sessionTokenHash");

    if (!room) throw new Error("Join-request-already-resolved");
    const request = room.joinRequests.find((entry) => entry.requestId === requestId);
    return { room, request };
  }

  const room = await Room.findOneAndUpdate(
    filter,
    {
      $set: {
        "joinRequests.$.status": "rejected",
        "joinRequests.$.resolvedAt": resolvedAt,
        "joinRequests.$.resolvedBy": actorUserId,
      },
    },
    { new: true, runValidators: true }
  ).select("+joinRequests.sessionTokenHash");

  if (!room) throw new Error("Join-request-already-resolved");
  return {
    room,
    request: room.joinRequests.find((entry) => entry.requestId === requestId),
  };
};

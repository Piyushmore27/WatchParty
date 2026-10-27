import {
    getRoomByCode,
    getJoinRequestStatus,
    getRoomVideoState,
    getRecentChatMessages,
    listPendingJoinRequests,
    isParticipantSessionValid,
    endRoom,
    removeRoomParticipant,
    resolveJoinRequest,
    transferHostAndLeave,
    updateParticipantRole,
    updateRoomVideo,
    saveRoomChatMessage,
} from "../services/roomService.js";
import { authorizeRoomSocket } from "../middleware/authorizeRoomSocket.js";
import crypto from "node:crypto";

const SYNC_PERSIST_INTERVAL_MS = 5_000;
const CHAT_MAX_LENGTH = 1000;
const CHAT_RATE_LIMIT_MS = 700;
const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

const isValidTime = (value) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;

export const registerRoomSocket = (io) => {
    const onlineUsers = new Map();
    const lastSyncPersistedAt = new Map();
    const announcedJoinRequests = new Set();
    const lastChatMessageAt = new Map();

    const authorizeVideoControl = async (socket, data, callback) => {
        try {
            const authorized = await authorizeRoomSocket({
                socket,
                data,
                onlineUsers,
                getRoomByCode,
                allowedRoles: ["Host", "Moderator"],
            });
            return { ...authorized, userId: authorized.userId };
        } catch (error) {
            console.error("Video control authorization failed:", error);
            callback?.({
                success: false,
                message: error.message === "Room-not-found"
                    ? "Room not found"
                    : error.message,
            });
            return null;
        }
    };

    const authorizeManagerAction = async (socket, data, callback) => {
        try {
            const authorized = await authorizeRoomSocket({
                socket,
                data,
                onlineUsers,
                getRoomByCode,
                allowedRoles: ["Host", "Moderator"],
            });
            return {
                ...authorized,
                actorUserId: authorized.userId,
            };
        } catch (error) {
            console.error("Room manager authorization failed:", error);
            callback?.({
                success: false,
                message: error.message === "Room-not-found"
                    ? "Room not found"
                    : error.message,
            });
            return null;
        }
    };

    const authorizeActualHost = async (socket, data, callback) => {
        try {
            const authorized = await authorizeRoomSocket({
                socket,
                data,
                onlineUsers,
                getRoomByCode,
                allowedRoles: ["Host"],
                requireRoomOwner: true,
            });
            return {
                ...authorized,
                hostUserId: authorized.userId,
            };
        } catch (error) {
            console.error("Host authorization failed:", error);
            callback?.({
                success: false,
                message: error.message === "Room-not-found"
                    ? "Room not found or already ended"
                    : error.message,
            });
            return null;
        }
    };

    const serializeParticipants = (participants) =>
        participants.map(({ userId, username, role, joinedAt }) => ({
            userId,
            username,
            role,
            joinedAt,
        }));

    const notifyManagers = async (roomCode, eventName, payload) => {
        try {
            const room = await getRoomByCode(roomCode);
            const managerIds = new Set(
                room.participants
                    .filter(({ role }) => ["Host", "Moderator"].includes(role))
                    .map(({ userId }) => userId)
            );
            for (const [socketId, session] of onlineUsers) {
                if (session.roomCode === roomCode && managerIds.has(session.userId)) {
                    io.to(socketId).emit(eventName, payload);
                }
            }
        } catch (error) {
            console.error(`Unable to notify room managers for ${eventName}:`, error);
        }
    };

    const publishPendingRequests = async (roomCode) => {
        try {
            const room = await getRoomByCode(roomCode);
            const managers = room.participants
                .filter(({ role }) => ["Host", "Moderator"].includes(role))
                .map(({ userId }) => userId);
            const pendingRequests = await Promise.all(
                managers.map(async (managerId) => ({
                    managerId,
                    requests: await listPendingJoinRequests(roomCode, managerId),
                }))
            );
            for (const [socketId, session] of onlineUsers) {
                const entry = pendingRequests.find(({ managerId }) => managerId === session.userId);
                if (session.roomCode === roomCode && entry) {
                    io.to(socketId).emit("room:join-requests-updated", {
                        requests: entry.requests,
                    });
                }
            }
        } catch (error) {
            console.error("Unable to publish pending join requests:", error);
        }
    };

    const getRequestedVideoId = (data, room) => {
        const videoId = data.videoId || room.video?.videoId;
        return typeof videoId === "string" && VIDEO_ID_PATTERN.test(videoId)
            ? videoId
            : null;
    };

    const publishState = (roomCode, state, userId, eventName) => {
        const payload = {
            videoId: state.videoId,
            currentTime: state.currentTime,
            playState: state.playState,
            syncedAt: new Date().toISOString(),
            userId,
        };
        io.to(roomCode).emit(eventName, payload);
        return payload;
    };

    io.on("connection", (socket) => {
        socket.on("room:join", async (data, callback) => {
            try {
                if (
                    typeof data?.roomCode !== "string" ||
                    typeof data?.userId !== "string" ||
                    typeof data?.sessionToken !== "string"
                ) {
                    return callback?.({
                        success: false,
                        message: "Room code, user ID, and session token are required",
                    });
                }

                const normalizedCode = data.roomCode.trim().toUpperCase();
                if (!/^[A-Z0-9]{8}$/.test(normalizedCode)) {
                    return callback?.({
                        success: false,
                        message: "Invalid room code",
                    });
                }

                const room = await getRoomByCode(normalizedCode, {
                    includeSessionTokenHashes: true,
                });
                if (!isParticipantSessionValid(room, data.userId, data.sessionToken)) {
                    return callback?.({
                        success: false,
                        message: "Room session is invalid. Rejoin through the home page.",
                    });
                }

                for (const joinedRoom of socket.rooms) {
                    if (joinedRoom !== socket.id) await socket.leave(joinedRoom);
                }
                await socket.join(normalizedCode);
                onlineUsers.set(socket.id, {
                    roomCode: normalizedCode,
                    userId: data.userId,
                });

                callback?.({
                    success: true,
                    message: "Joined Socket.IO room successfully",
                    roomCode: normalizedCode,
                    room: {
                        hostId: room.hostId,
                        participants: room.participants.map(
                            ({ userId, username, role, joinedAt }) => ({
                                userId,
                                username,
                                role,
                                joinedAt,
                            })
                        ),
                        video: getRoomVideoState(room),
                        pendingJoinRequests: ["Host", "Moderator"].includes(
                            room.participants.find(
                                ({ userId }) => userId === data.userId
                            )?.role
                        )
                            ? await listPendingJoinRequests(normalizedCode, data.userId)
                            : [],
                    },
                });
                io.to(normalizedCode).emit("room:participants-updated", {
                    participants: room.participants.map(
                        ({ userId, username, role, joinedAt }) => ({
                            userId,
                            username,
                            role,
                            joinedAt,
                        })
                    ),
                });
            } catch (error) {
                console.error("room:join error:", error);
                callback?.({
                    success: false,
                    message:
                        error.message === "Room-not-found"
                            ? "Room not found"
                            : "Unable to join room",
                });
            }
        });

        socket.on("room:join-request:watch", async (data, callback) => {
            if (
                typeof data?.roomCode !== "string" ||
                typeof data?.requestId !== "string" ||
                typeof data?.userId !== "string" ||
                typeof data?.requestToken !== "string" ||
                !/^[A-Z0-9]{8}$/i.test(data.roomCode) ||
                !/^[A-Za-z0-9_-]{43}$/.test(data.requestToken)
            ) {
                return callback?.({
                    success: false,
                    message: "A valid join request session is required",
                });
            }

            const roomCode = data.roomCode.toUpperCase();
            const sessionTokenHash = crypto
                .createHash("sha256")
                .update(data.requestToken)
                .digest("hex");
            try {
                const result = await getJoinRequestStatus({
                    roomCode,
                    requestId: data.requestId,
                    userId: data.userId,
                    sessionTokenHash,
                });
                if (result.status === "pending") {
                    onlineUsers.set(socket.id, {
                        roomCode,
                        userId: data.userId,
                        requestId: data.requestId,
                        requestTokenHash: sessionTokenHash,
                    });
                    const latestStatus = await getJoinRequestStatus({
                        roomCode,
                        requestId: data.requestId,
                        userId: data.userId,
                        sessionTokenHash,
                    });
                    if (latestStatus.status !== "pending") {
                        onlineUsers.delete(socket.id);
                        return callback?.({
                            success: true,
                            status: latestStatus.status,
                            userId: latestStatus.userId,
                        });
                    }
                    const announcementId = `${roomCode}:${data.requestId}`;
                    if (!announcedJoinRequests.has(announcementId)) {
                        announcedJoinRequests.add(announcementId);
                        await notifyManagers(roomCode, "room:join-request:new", result.request);
                    }
                    await publishPendingRequests(roomCode);
                }
                callback?.({
                    success: true,
                    status: result.status,
                    userId: result.userId,
                });
            } catch (error) {
                if (error.message === "Join-request-not-found") {
                    return callback?.({
                        success: false,
                        message: "Join request was not found or is no longer valid",
                    });
                }
                console.error("room:join-request:watch error:", error);
                callback?.({
                    success: false,
                    message: "Unable to check join request status",
                });
            }
        });

        socket.on("disconnect", () => {
            onlineUsers.delete(socket.id);
            lastChatMessageAt.delete(socket.id);
        });

        socket.on("chat:history:load", async (data, callback) => {
            try {
                const authorized = await authorizeRoomSocket({
                    socket,
                    data,
                    onlineUsers,
                    getRoomByCode,
                    allowedRoles: ["Host", "Moderator", "Participant"],
                });
                const messages = await getRecentChatMessages(
                    authorized.roomCode,
                    Number.isInteger(data.limit) ? data.limit : 50
                );
                callback?.({ success: true, messages });
            } catch (error) {
                if (
                    error.message === "Room-not-found" ||
                    error.message === "Socket session is not authorized" ||
                    error.message === "You do not have permission to perform this action"
                ) {
                    return callback?.({
                        success: false,
                        message: error.message === "Room-not-found"
                            ? "Room not found or inactive"
                            : error.message,
                    });
                }
                console.error("chat:history:load error:", {
                    roomCode: data?.roomCode,
                    name: error.name,
                    message: error.message,
                });
                callback?.({
                    success: false,
                    message: "Unable to load room chat history",
                });
            }
        });

        socket.on("chat:message:send", async (data, callback) => {
            try {
                const authorized = await authorizeRoomSocket({
                    socket,
                    data,
                    onlineUsers,
                    getRoomByCode,
                    allowedRoles: ["Host", "Moderator", "Participant"],
                });
                if (typeof data.text !== "string") {
                    return callback?.({
                        success: false,
                        message: "Message text is required",
                    });
                }
                const text = data.text.trim();
                if (!text) {
                    return callback?.({
                        success: false,
                        message: "Enter a message before sending",
                    });
                }
                if (text.length > CHAT_MAX_LENGTH) {
                    return callback?.({
                        success: false,
                        message: `Messages cannot exceed ${CHAT_MAX_LENGTH} characters`,
                    });
                }

                const now = Date.now();
                const previousSentAt = lastChatMessageAt.get(socket.id) || 0;
                if (now - previousSentAt < CHAT_RATE_LIMIT_MS) {
                    return callback?.({
                        success: false,
                        message: "Please wait a moment before sending another message",
                    });
                }

                const sender = authorized.room.participants.find(
                    (participant) => participant.userId === authorized.userId
                );
                if (!sender) {
                    return callback?.({
                        success: false,
                        message: "You are no longer a member of this room",
                    });
                }
                const message = await saveRoomChatMessage({
                    roomCode: authorized.roomCode,
                    senderId: sender.userId,
                    senderName: sender.username,
                    text,
                });
                lastChatMessageAt.set(socket.id, now);
                io.to(authorized.roomCode).emit("chat:message:new", message);
                callback?.({ success: true, message });
            } catch (error) {
                if (
                    error.message === "Room-not-found" ||
                    error.message === "Socket session is not authorized" ||
                    error.message === "You do not have permission to perform this action"
                ) {
                    return callback?.({
                        success: false,
                        message: error.message === "Room-not-found"
                            ? "Room not found or inactive"
                            : error.message,
                    });
                }
                console.error("chat:message:send error:", {
                    roomCode: data?.roomCode,
                    name: error.name,
                    message: error.message,
                });
                callback?.({
                    success: false,
                    message: "Message could not be saved. Please try again.",
                });
            }
        });

        socket.on("room:host:leave", async (data, callback) => {
            const authorized = await authorizeActualHost(socket, data, callback);
            if (!authorized) return;

            let room;
            try {
                room = await transferHostAndLeave(
                    authorized.roomCode,
                    authorized.hostUserId
                );
            } catch (error) {
                if (error.message === "Host-leave-requires-moderator") {
                    return callback?.({
                        success: false,
                        message: "Please promote a participant to Moderator before leaving, so the meeting can continue.",
                    });
                }
                if (error.message === "Host-departure-conflict") {
                    return callback?.({
                        success: false,
                        message: "The room changed while ownership was transferring. Refresh the participant list and try again.",
                    });
                }
                if (error.message === "Host-session-invalid") {
                    return callback?.({
                        success: false,
                        message: "Your session is no longer the active Host of this room. Refresh the room and try again.",
                    });
                }
                console.error("room:host:leave unexpected failure:", {
                    roomCode: authorized.roomCode,
                    name: error.name,
                    code: error.code,
                    message: error.message,
                });
                return callback?.({
                    success: false,
                    message: "The Host transfer could not be completed because of a database error. No departure was confirmed; please retry.",
                });
            }

            callback?.({
                success: true,
                newHostId: room.hostId,
            });

            try {
                io.to(authorized.roomCode)
                    .except(socket.id)
                    .emit("room:participants-updated", {
                        hostId: room.hostId,
                        participants: serializeParticipants(room.participants),
                    });

                const formerHostSocketIds = [];
                for (const [socketId, session] of onlineUsers) {
                    if (
                        session.roomCode === authorized.roomCode &&
                        session.userId === authorized.hostUserId
                    ) {
                        formerHostSocketIds.push(socketId);
                        onlineUsers.delete(socketId);
                    }
                }
                for (const socketId of formerHostSocketIds) {
                    const formerHostSocket = io.sockets.sockets.get(socketId);
                    if (formerHostSocket) {
                        if (socketId !== socket.id) {
                            io.to(socketId).emit("room:host:left", {
                                newHostId: room.hostId,
                                message: "Host role transferred; you have left the meeting.",
                            });
                        }
                        await formerHostSocket.leave(authorized.roomCode);
                        if (socketId !== socket.id) {
                            setTimeout(() => formerHostSocket.disconnect(true), 100);
                        }
                    }
                }
            } catch (error) {
                console.error("room:host:leave socket cleanup failed after committed transfer:", {
                    roomCode: authorized.roomCode,
                    name: error.name,
                    code: error.code,
                    message: error.message,
                });
            }
        });

        socket.on("room:end", async (data, callback) => {
            const authorized = await authorizeActualHost(socket, data, callback);
            if (!authorized) return;

            try {
                await endRoom(authorized.roomCode, authorized.hostUserId);
                lastSyncPersistedAt.delete(authorized.roomCode);
                io.to(authorized.roomCode).emit("room:ended", {
                    message: "The Host has ended this meeting.",
                });

                const roomSocketIds = [];
                for (const [socketId, session] of onlineUsers) {
                    if (session.roomCode === authorized.roomCode) {
                        roomSocketIds.push(socketId);
                        onlineUsers.delete(socketId);
                    }
                }
                for (const socketId of roomSocketIds) {
                    const roomSocket = io.sockets.sockets.get(socketId);
                    if (roomSocket && !roomSocket.rooms.has(authorized.roomCode)) {
                        io.to(socketId).emit("room:ended", {
                            message: "The Host has ended this meeting.",
                        });
                    }
                }
                for (const requestKey of announcedJoinRequests) {
                    if (requestKey.startsWith(`${authorized.roomCode}:`)) {
                        announcedJoinRequests.delete(requestKey);
                    }
                }

                callback?.({ success: true });
                setTimeout(() => {
                    for (const socketId of roomSocketIds) {
                        io.sockets.sockets.get(socketId)?.disconnect(true);
                    }
                }, 100);
            } catch (error) {
                if (error.message === "Host-session-invalid") {
                    return callback?.({
                        success: false,
                        message: "Only the current Host can end this meeting",
                    });
                }
                console.error("room:end error:", error);
                callback?.({
                    success: false,
                    message: "Unable to end the meeting",
                });
            }
        });

        socket.on("room:role:update", async (data, callback) => {
            const authorized = await authorizeManagerAction(socket, data, callback);
            if (!authorized) return;

            if (
                typeof data.targetUserId !== "string" ||
                !["Moderator", "Participant"].includes(data.role)
            ) {
                return callback?.({
                    success: false,
                    message: "Choose a valid participant and role",
                });
            }
            try {
                const room = await updateParticipantRole(
                    authorized.roomCode,
                    authorized.actorUserId,
                    data.targetUserId,
                    data.role
                );
                const participants = serializeParticipants(room.participants);
                io.to(authorized.roomCode).emit("room:participants-updated", {
                    participants,
                });
                await publishPendingRequests(authorized.roomCode);
                callback?.({ success: true, participants });
            } catch (error) {
                if (
                    error.message === "Invalid-participant-role" ||
                    error.message === "Participant-role-cannot-be-changed" ||
                    error.message === "Participant-not-found-or-not-manageable"
                ) {
                    const message = error.message === "Invalid-participant-role"
                        ? "Choose Moderator or Participant"
                        : error.message === "Participant-role-cannot-be-changed"
                            ? "You cannot change your own role"
                            : "Participant not found or role cannot be changed";
                    return callback?.({ success: false, message });
                }
                console.error("room:role:update error:", error);
                callback?.({
                    success: false,
                    message: "Unable to update participant role",
                });
            }
        });

        socket.on("room:participant:remove", async (data, callback) => {
            const authorized = await authorizeManagerAction(socket, data, callback);
            if (!authorized) return;

            if (typeof data.targetUserId !== "string") {
                return callback?.({
                    success: false,
                    message: "A participant is required",
                });
            }
            if (data.targetUserId === authorized.actorUserId) {
                return callback?.({
                    success: false,
                    message: "You cannot remove yourself",
                });
            }

            try {
                const room = await removeRoomParticipant(
                    authorized.roomCode,
                    authorized.actorUserId,
                    data.targetUserId
                );
                const participants = serializeParticipants(room.participants);
                io.to(authorized.roomCode).emit("room:participants-updated", {
                    participants,
                });
                await publishPendingRequests(authorized.roomCode);

                const removedSocketIds = [];
                for (const [socketId, session] of onlineUsers) {
                    if (
                        session.roomCode === authorized.roomCode &&
                        session.userId === data.targetUserId
                    ) {
                        removedSocketIds.push(socketId);
                    }
                }

                for (const socketId of removedSocketIds) {
                    io.to(socketId).emit("room:removed", {
                        message: "A room manager removed you from this room",
                    });
                    onlineUsers.delete(socketId);
                    const removedSocket = io.sockets.sockets.get(socketId);
                    if (removedSocket) {
                        await removedSocket.leave(authorized.roomCode);
                        setTimeout(() => removedSocket.disconnect(true), 50);
                    }
                }

                callback?.({ success: true, participants });
            } catch (error) {
                if (
                    error.message === "Host-cannot-be-removed" ||
                    error.message === "Participant-not-found-or-not-removable"
                ) {
                    return callback?.({
                        success: false,
                        message: error.message === "Host-cannot-be-removed"
                            ? "The host cannot be removed"
                            : "Participant not found or cannot be removed",
                    });
                }
                console.error("room:participant:remove error:", error);
                callback?.({
                    success: false,
                    message: "Unable to remove participant",
                });
            }
        });

        socket.on("room:join-requests:list", async (data, callback) => {
            const authorized = await authorizeManagerAction(socket, data, callback);
            if (!authorized) return;

            try {
                const requests = await listPendingJoinRequests(
                    authorized.roomCode,
                    authorized.actorUserId
                );
                callback?.({ success: true, requests });
            } catch (error) {
                console.error("room:join-requests:list error:", error);
                callback?.({
                    success: false,
                    message: "Unable to load join requests",
                });
            }
        });

        socket.on("room:join-request:resolve", async (data, callback) => {
            const authorized = await authorizeManagerAction(socket, data, callback);
            if (!authorized) return;
            if (
                typeof data.requestId !== "string" ||
                !["approved", "rejected"].includes(data.decision)
            ) {
                return callback?.({
                    success: false,
                    message: "A valid join request and decision are required",
                });
            }

            try {
                const { room, request } = await resolveJoinRequest({
                    roomCode: authorized.roomCode,
                    actorUserId: authorized.actorUserId,
                    requestId: data.requestId,
                    decision: data.decision,
                });
                const participants = serializeParticipants(room.participants);
                if (data.decision === "approved") {
                    io.to(authorized.roomCode).emit("room:participants-updated", {
                        participants,
                    });
                }

                const requestTokenHash = request.sessionTokenHash;
                announcedJoinRequests.delete(`${authorized.roomCode}:${request.requestId}`);
                for (const [socketId, session] of onlineUsers) {
                    if (
                        session.roomCode === authorized.roomCode &&
                        session.requestId === request.requestId &&
                        session.requestTokenHash === requestTokenHash
                    ) {
                        io.to(socketId).emit("room:join-request:resolved", {
                            requestId: request.requestId,
                            status: request.status,
                            userId: request.userId,
                            message: request.status === "approved"
                                ? "Your request was approved"
                                : "Your request was rejected",
                        });
                    }
                }
                await publishPendingRequests(authorized.roomCode);
                callback?.({ success: true, status: request.status, participants });
            } catch (error) {
                if (error.message === "Join-request-already-resolved") {
                    return callback?.({
                        success: false,
                        message: "This join request has already been resolved",
                    });
                }
                console.error("room:join-request:resolve error:", error);
                callback?.({
                    success: false,
                    message: "Unable to resolve join request",
                });
            }
        });

        socket.on("video:play", async (data, callback) => {
            const authorized = await authorizeVideoControl(socket, data, callback);
            if (!authorized) return;

            if (!isValidTime(data.currentTime)) {
                return callback?.({
                    success: false,
                    message: "A valid non-negative currentTime is required",
                });
            }

            const videoId = getRequestedVideoId(data, authorized.room);
            if (!videoId || (authorized.room.video?.videoId && videoId !== authorized.room.video.videoId)) {
                return callback?.({
                    success: false,
                    message: "A valid current YouTube video ID is required",
                });
            }

            try {
                lastSyncPersistedAt.delete(authorized.roomCode);
                const updatedRoom = await updateRoomVideo(authorized.roomCode, {
                    videoId,
                    currentTime: data.currentTime,
                    playState: "playing",
                });
                const state = publishState(
                    authorized.roomCode,
                    {
                        videoId: updatedRoom.video.videoId,
                        currentTime: data.currentTime,
                        playState: "playing",
                    },
                    authorized.userId,
                    "video:play"
                );
                callback?.({ success: true, state });
            } catch (error) {
                console.error("video:play error:", error);
                callback?.({
                    success: false,
                    message: "Unable to synchronize playback",
                });
            }
        });

        socket.on("video:pause", async (data, callback) => {
            const authorized = await authorizeVideoControl(socket, data, callback);
            if (!authorized) return;

            if (!isValidTime(data.currentTime)) {
                return callback?.({
                    success: false,
                    message: "A valid non-negative currentTime is required",
                });
            }

            const videoId = getRequestedVideoId(data, authorized.room);
            if (!videoId || (authorized.room.video?.videoId && videoId !== authorized.room.video.videoId)) {
                return callback?.({
                    success: false,
                    message: "A valid current YouTube video ID is required",
                });
            }

            try {
                lastSyncPersistedAt.delete(authorized.roomCode);
                const updatedRoom = await updateRoomVideo(authorized.roomCode, {
                    videoId,
                    currentTime: data.currentTime,
                    playState: "paused",
                });
                const state = publishState(
                    authorized.roomCode,
                    {
                        videoId: updatedRoom.video.videoId,
                        currentTime: data.currentTime,
                        playState: "paused",
                    },
                    authorized.userId,
                    "video:pause"
                );
                callback?.({ success: true, state });
            } catch (error) {
                console.error("video:pause error:", error);
                callback?.({
                    success: false,
                    message: "Unable to synchronize playback",
                });
            }
        });

        socket.on("video:seek", async (data, callback) => {
            const authorized = await authorizeVideoControl(socket, data, callback);
            if (!authorized) return;

            if (!isValidTime(data.currentTime)) {
                return callback?.({
                    success: false,
                    message: "A valid non-negative currentTime is required",
                });
            }

            const videoId = getRequestedVideoId(data, authorized.room);
            if (!videoId || (authorized.room.video?.videoId && videoId !== authorized.room.video.videoId)) {
                return callback?.({
                    success: false,
                    message: "A valid current YouTube video ID is required",
                });
            }

            try {
                lastSyncPersistedAt.delete(authorized.roomCode);
                const playState =
                    authorized.room.video?.playState === "playing"
                        ? "playing"
                        : "paused";
                const updatedRoom = await updateRoomVideo(authorized.roomCode, {
                    videoId,
                    currentTime: data.currentTime,
                    playState,
                });
                const state = publishState(
                    authorized.roomCode,
                    {
                        videoId: updatedRoom.video.videoId,
                        currentTime: data.currentTime,
                        playState,
                    },
                    authorized.userId,
                    "video:seek"
                );
                callback?.({ success: true, state });
            } catch (error) {
                console.error("video:seek error:", error);
                callback?.({
                    success: false,
                    message: "Unable to synchronize seek",
                });
            }
        });

        socket.on("video:change", async (data, callback) => {
            const authorized = await authorizeVideoControl(socket, data, callback);
            if (!authorized) return;

            if (
                typeof data.videoId !== "string" ||
                !VIDEO_ID_PATTERN.test(data.videoId)
            ) {
                return callback?.({
                    success: false,
                    message: "A valid YouTube video ID is required",
                });
            }

            try {
                lastSyncPersistedAt.delete(authorized.roomCode);
                const updatedRoom = await updateRoomVideo(authorized.roomCode, {
                    videoId: data.videoId,
                    currentTime: 0,
                    playState: "paused",
                });
                const state = publishState(
                    authorized.roomCode,
                    {
                        videoId: updatedRoom.video.videoId,
                        currentTime: 0,
                        playState: "paused",
                    },
                    authorized.userId,
                    "video:change"
                );
                callback?.({
                    success: true,
                    message: "Video changed successfully",
                    state,
                });
            } catch (error) {
                console.error("video:change error:", error);
                callback?.({
                    success: false,
                    message: "Unable to change video",
                });
            }
        });

        socket.on("video:sync", async (data, callback) => {
            const authorized = await authorizeVideoControl(socket, data, callback);
            if (!authorized) return;

            if (!isValidTime(data.currentTime)) {
                return callback?.({
                    success: false,
                    message: "A valid non-negative currentTime is required",
                });
            }

            if (
                authorized.room.video?.playState !== "playing" ||
                data.videoId !== authorized.room.video?.videoId
            ) {
                return callback?.({
                    success: false,
                    message: "Room playback state has changed",
                });
            }

            try {
                const now = Date.now();
                let syncedAt = authorized.room.video.syncedAt;
                const lastPersisted = lastSyncPersistedAt.get(authorized.roomCode) || 0;

                if (now - lastPersisted >= SYNC_PERSIST_INTERVAL_MS) {
                    const updatedRoom = await updateRoomVideo(authorized.roomCode, {
                        currentTime: data.currentTime,
                    }, {
                        videoId: authorized.room.video.videoId,
                        playState: "playing",
                    });
                    syncedAt = updatedRoom.video.syncedAt;
                    lastSyncPersistedAt.set(authorized.roomCode, now);
                }

                const payload = {
                    videoId: authorized.room.video.videoId,
                    currentTime: data.currentTime,
                    playState: "playing",
                    syncedAt: new Date(now).toISOString(),
                    userId: authorized.userId,
                };
                io.to(authorized.roomCode).emit("video:sync", payload);
                callback?.({ success: true, syncedAt });
            } catch (error) {
                if (error.message === "Room-state-changed") {
                    return callback?.({
                        success: false,
                        message: "Room playback state has changed",
                    });
                }
                console.error("video:sync error:", error);
                callback?.({
                    success: false,
                    message: "Unable to synchronize playback",
                });
            }
        });
    });
};

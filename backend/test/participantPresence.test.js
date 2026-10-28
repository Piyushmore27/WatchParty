import test from "node:test";
import assert from "node:assert/strict";
import {
  getActiveParticipants,
  hasConnectedParticipantSocket,
} from "../socket/participantPresence.js";

const participants = [
  { userId: "host", username: "Host", role: "Host", joinedAt: "1" },
  { userId: "moderator", username: "Mod", role: "Moderator", joinedAt: "2" },
  { userId: "guest", username: "Guest", role: "Participant", joinedAt: "3" },
];

test("lists only active admitted participants in the requested room", () => {
  const onlineUsers = new Map([
    ["host-socket", { roomCode: "ROOMA001", userId: "host", isRoomMember: true }],
    ["request-socket", { roomCode: "ROOMA001", userId: "guest" }],
    ["other-room-socket", { roomCode: "ROOMB002", userId: "moderator", isRoomMember: true }],
  ]);

  assert.deepEqual(
    getActiveParticipants(participants, onlineUsers, "ROOMA001"),
    [participants[0]]
  );
});

test("deduplicates multiple sockets for a user and preserves their stored role", () => {
  const onlineUsers = new Map([
    ["first-tab", { roomCode: "ROOMA001", userId: "moderator", isRoomMember: true }],
    ["refreshed-tab", { roomCode: "ROOMA001", userId: "moderator", isRoomMember: true }],
    ["guest-tab", { roomCode: "ROOMA001", userId: "guest", isRoomMember: true }],
  ]);

  assert.deepEqual(
    getActiveParticipants(participants, onlineUsers, "ROOMA001"),
    [participants[1], participants[2]]
  );
});

test("does not list stale persisted participants without a live room socket", () => {
  assert.deepEqual(getActiveParticipants(participants, new Map(), "ROOMA001"), []);
});

test("lists every active participant beyond the first two", () => {
  const roomParticipants = [
    ...participants,
    ...Array.from({ length: 10 }, (_, index) => ({
      userId: `guest-${index}`,
      username: `Guest ${index}`,
      role: "Participant",
      joinedAt: String(index + 4),
    })),
  ];
  const onlineUsers = new Map(
    roomParticipants.map(({ userId }) => [
      `${userId}-socket`,
      { roomCode: "ROOMA001", userId, isRoomMember: true },
    ])
  );

  assert.equal(getActiveParticipants(roomParticipants, onlineUsers, "ROOMA001").length, 13);
});

test("recognizes connected sessions without counting a disconnected refresh as live", () => {
  const onlineUsers = new Map([
    ["disconnected-tab", {
      roomCode: "ROOMA001",
      userId: "guest",
      isRoomMember: true,
      isDisconnected: true,
    }],
  ]);

  assert.equal(hasConnectedParticipantSocket(onlineUsers, "ROOMA001", "guest"), false);
  onlineUsers.set("new-tab", {
    roomCode: "ROOMA001",
    userId: "guest",
    isRoomMember: true,
  });
  assert.equal(hasConnectedParticipantSocket(onlineUsers, "ROOMA001", "guest"), true);
});

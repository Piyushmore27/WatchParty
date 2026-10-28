
import { useCallback, useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { socket } from "../socket/socket.js";
import YouTubePlayer from "../components/YouTubePlayer.jsx";
import RoomChat from "../components/RoomChat.jsx";
import ParticipantNotifications from "../components/ParticipantNotifications.jsx";
import Button from "../components/ui/Button.jsx";

const SYNC_INTERVAL_MS = 2500;
const DRIFT_THRESHOLD_SECONDS = 1.5;

const isValidVideoId = (videoId) =>
    typeof videoId === "string" && /^[a-zA-Z0-9_-]{11}$/.test(videoId);

const isValidPlaybackTime = (time) =>
    typeof time === "number" && Number.isFinite(time) && time >= 0;

export default function RoomPage() {
    const { roomCode } = useParams();
    const navigate = useNavigate();

    const [room, setRoom] = useState(null);
    const [status, setStatus] = useState("Connecting...");
    const [error, setError] = useState("");
    const playerRef = useRef(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [videoInput, setVideoInput] = useState("");
    const [shareStatus, setShareStatus] = useState("");
    const [playerReady, setPlayerReady] = useState(false);
    const [needsPlaybackGesture, setNeedsPlaybackGesture] = useState(false);
    const [participantActionId, setParticipantActionId] = useState("");
    const [participantActionError, setParticipantActionError] = useState("");
    const [joinRequests, setJoinRequests] = useState([]);
    const [joinRequestActionId, setJoinRequestActionId] = useState("");
    const [joinRequestError, setJoinRequestError] = useState("");
    const [joinRequestStatus, setJoinRequestStatus] = useState("pending");
    const [sessionVersion, setSessionVersion] = useState(0);
    const [hostActionPending, setHostActionPending] = useState(false);
    const [hostActionError, setHostActionError] = useState("");
    const [meetingEnded, setMeetingEnded] = useState(false);
    const [meetingLeft, setMeetingLeft] = useState(false);
    const [activeSidebarTab, setActiveSidebarTab] = useState("people");
    const [chatMessages, setChatMessages] = useState([]);
    const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
    const [chatHistoryError, setChatHistoryError] = useState("");
    const [chatSendError, setChatSendError] = useState("");
    const [unreadMessageCount, setUnreadMessageCount] = useState(0);
    const [participantNotifications, setParticipantNotifications] = useState([]);
    const participantNotificationTimersRef = useRef(new Map());
    const userId = sessionStorage.getItem("userId");
    const sessionToken = sessionStorage.getItem("sessionToken");
    const pendingRequestId = sessionStorage.getItem("pendingJoinRequestId");
    const pendingRequestToken = sessionStorage.getItem("pendingJoinRequestToken");
    const pendingUserId = sessionStorage.getItem("pendingJoinUserId");
    const activeSidebarTabRef = useRef("people");
    const playerReadyRef = useRef(false);
    const socketJoinedRef = useRef(false);
    const autoplayBlockedRef = useRef(false);
    const pendingRoomStateRef = useRef(null);
    const playbackAnchorRef = useRef(null);
    const pausedRestoreRef = useRef(null);
    const isSeekingRef = useRef(false);
    const seenParticipantNotificationIdsRef = useRef(new Set());
    const participantListVersionRef = useRef(-1);
    const latestParticipantSnapshotRef = useRef(null);
    const uniqueParticipants = new Map(
        (room?.participants || [])
            .filter((person) => typeof person?.userId === "string" && person.userId)
            .map((person) => [person.userId, person])
    );
    const participants = [...uniqueParticipants.values()].sort((first, second) => {
        const firstIsHost = first.role === "Host" || first.userId === room?.hostId;
        const secondIsHost = second.role === "Host" || second.userId === room?.hostId;
        return Number(secondIsHost) - Number(firstIsHost);
    });
    const receiveParticipantNotification = useCallback((notification) => {
        if (
            !notification?.id ||
            typeof notification.username !== "string" ||
            !["joined", "left"].includes(notification.action)
        ) {
            return;
        }
        const seenIds = seenParticipantNotificationIdsRef.current;
        if (seenIds.has(notification.id)) return;
        seenIds.add(notification.id);
        if (seenIds.size > 200) {
            seenIds.clear();
            seenIds.add(notification.id);
        }
        const timer = window.setTimeout(() => {
            participantNotificationTimersRef.current.delete(notification.id);
            setParticipantNotifications((current) =>
                current.filter((item) => item.id !== notification.id)
            );
        }, 2750);
        participantNotificationTimersRef.current.set(notification.id, timer);
        setParticipantNotifications((current) => [...current, notification]);
    }, []);

    const applyParticipantSnapshot = useCallback((data) => {
        if (!Array.isArray(data?.participants)) return;
        if (
            Number.isInteger(data.participantsVersion) &&
            data.participantsVersion < participantListVersionRef.current
        ) {
            return;
        }

        if (Number.isInteger(data.participantsVersion)) {
            participantListVersionRef.current = data.participantsVersion;
        }
        const snapshot = {
            participants: data.participants,
            ...(data.hostId ? { hostId: data.hostId } : {}),
            participantsVersion: data.participantsVersion,
        };
        latestParticipantSnapshotRef.current = snapshot;

        if (!data.participants.some((participant) => participant.userId === userId)) {
            sessionStorage.removeItem("userId");
            sessionStorage.removeItem("sessionToken");
            socket.disconnect();
            navigate("/");
            return;
        }
        setRoom((previousRoom) => ({
            ...(previousRoom || {}),
            ...snapshot,
        }));
    }, [navigate, userId]);

    useEffect(() => () => {
        for (const timer of participantNotificationTimersRef.current.values()) {
            window.clearTimeout(timer);
        }
        participantNotificationTimersRef.current.clear();
    }, []);

    useEffect(() => {
        if (!meetingEnded && !meetingLeft) return undefined;
        const redirectTimer = window.setTimeout(() => navigate("/"), 2500);
        return () => window.clearTimeout(redirectTimer);
    }, [meetingEnded, meetingLeft, navigate]);

    const canControlVideo = room?.participants?.some(
        (person) => person.userId === userId && ["Host", "Moderator"].includes(person.role)
    );
    const isHost = room?.hostId === userId ||
        room?.participants?.some((person) => person.userId === userId && person.role === "Host");

    const mergeChatMessages = useCallback((incomingMessages) => {
        setChatMessages((existing) => {
            const uniqueMessages = new Map(
                existing.map((message) => [message.id, message])
            );
            incomingMessages.forEach((message) => {
                if (message?.id) uniqueMessages.set(message.id, message);
            });
            return [...uniqueMessages.values()].sort(
                (first, second) =>
                    new Date(first.createdAt).getTime() -
                    new Date(second.createdAt).getTime()
            );
        });
    }, []);

    const loadChatHistory = useCallback(() => {
        if (!userId) return;
        if (!socketJoinedRef.current) {
            setChatHistoryLoading(false);
            setChatHistoryError("Reconnect to the room to load chat history.");
            return;
        }
        setChatHistoryLoading(true);
        setChatHistoryError("");
        socket.emit("chat:history:load", {
            roomCode,
            userId,
            limit: 50,
        }, (result) => {
            setChatHistoryLoading(false);
            if (!result?.success || !Array.isArray(result.messages)) {
                setChatHistoryError(result?.message || "Unable to load room chat history");
                return;
            }
            mergeChatMessages(result.messages);
        });
    }, [mergeChatMessages, roomCode, userId]);

    const sendChatMessage = useCallback((text) => new Promise((resolve, reject) => {
        setChatSendError("");
        if (!socketJoinedRef.current) {
            const message = "You are disconnected from the room.";
            setChatSendError(message);
            reject(new Error(message));
            return;
        }
        socket.emit("chat:message:send", { roomCode, userId, text }, (result) => {
            if (!result?.success) {
                const message = result?.message || "Unable to send message";
                setChatSendError(message);
                reject(new Error(message));
                return;
            }
            resolve();
        });
    }), [roomCode, userId]);
    const handleChatOpened = useCallback(() => {
        activeSidebarTabRef.current = "chat";
        setUnreadMessageCount(0);
    }, []);

    const openChat = () => {
        activeSidebarTabRef.current = "chat";
        setActiveSidebarTab("chat");
        setUnreadMessageCount(0);
        loadChatHistory();
    };

    const openPeople = () => {
        activeSidebarTabRef.current = "people";
        setActiveSidebarTab("people");
    };
    const applyRoomVideoState = useCallback((incomingState, forceSeek = false, restorePaused = false) => {
        if (
            !incomingState ||
            !isValidPlaybackTime(incomingState.currentTime) ||
            !["playing", "paused"].includes(incomingState.playState)
        ) {
            return;
        }

        const videoId = incomingState.videoId || "";
        if (videoId && !isValidVideoId(videoId)) return;
        const syncedAt = incomingState.syncedAt
            ? new Date(incomingState.syncedAt).getTime()
            : Date.now();
        const elapsed = incomingState.playState === "playing" && Number.isFinite(syncedAt)
            ? Math.max(0, Date.now() - syncedAt) / 1000
            : 0;
        const targetTime = incomingState.currentTime + elapsed;
        const state = {
            videoId,
            currentTime: videoId ? targetTime : 0,
            playState: videoId ? incomingState.playState : "paused",
            syncedAt: Date.now(),
        };
        if (!videoId) {
            setIsPlaying(false);
            setCurrentTime(0);
            setDuration(0);
        }
        if (state.playState === "paused") {
            autoplayBlockedRef.current = false;
            setNeedsPlaybackGesture(false);
        }

        pendingRoomStateRef.current = state;
        playbackAnchorRef.current = state;
        if (restorePaused) {
            pausedRestoreRef.current = {
                currentTime: targetTime,
                expiresAt: Date.now() + 5000,
            };
            setCurrentTime(targetTime);
        } else {
            pausedRestoreRef.current = null;
        }
        setRoom((previousRoom) =>
            previousRoom
                ? { ...previousRoom, video: state }
                : previousRoom
        );
        if (!videoId) return;
        if (!playerReadyRef.current || !socketJoinedRef.current) return;

        const player = playerRef.current;
        if (!player || typeof player.getVideoId !== "function") return;
        const loadedVideoId = player.getVideoId();

        if (state.playState === "paused" && restorePaused) {
            if (!player.cueVideoById(videoId, targetTime)) {
                setError("The video player is not ready to restore the paused room video.");
                return;
            }
            return;
        }

        if (loadedVideoId !== videoId) {
            const loaded = state.playState === "playing"
                ? player.loadVideoById(videoId, targetTime, true)
                : player.cueVideoById(videoId, targetTime);
            if (!loaded) {
                setError("The video player is not ready to load the room video.");
                return;
            }
        } else {
            const actualTime = player.getCurrentTime();
            if (
                forceSeek ||
                !isValidPlaybackTime(actualTime) ||
                Math.abs(actualTime - targetTime) > DRIFT_THRESHOLD_SECONDS
            ) {
                player.seekTo(targetTime);
            }
        }

        if (state.playState === "playing") {
            player.playVideo();
        } else {
            player.pauseVideo();
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        let cleanupSocket;
        socketJoinedRef.current = false;
        pendingRoomStateRef.current = null;
        playbackAnchorRef.current = null;

        const clearRoomCredentials = () => {
            [
                "userId",
                "sessionToken",
                "pendingJoinRequestId",
                "pendingJoinRequestToken",
                "pendingJoinUserId",
            ].forEach((key) => sessionStorage.removeItem(key));
        };
        const onMeetingEnded = (data) => {
            if (cancelled) return;
            clearRoomCredentials();
            setMeetingEnded(true);
            setStatus("Meeting ended");
            setError(data?.message || "The Host has ended this meeting.");
            setIsPlaying(false);
            if (
                playerReadyRef.current &&
                typeof playerRef.current?.pauseVideo === "function"
            ) {
                playerRef.current.pauseVideo();
            }
            socket.disconnect();
        };

        const acceptJoinRequest = (approvedUserId) => {
            if (!approvedUserId || !pendingRequestToken) return;
            sessionStorage.setItem("userId", approvedUserId);
            sessionStorage.setItem("sessionToken", pendingRequestToken);
            sessionStorage.removeItem("pendingJoinRequestId");
            sessionStorage.removeItem("pendingJoinRequestToken");
            sessionStorage.removeItem("pendingJoinUserId");
            setJoinRequestStatus("approved");
            setSessionVersion((version) => version + 1);
        };

        const joinRoom = async () => {
            if (!userId || !sessionToken) {
                if (!pendingRequestId || !pendingRequestToken || !pendingUserId) {
                    setError("Your room session is missing. Return home and join the room again.");
                    setStatus("Not joined");
                    return;
                }

                setError("");
                setStatus("Waiting for approval");
                setJoinRequestStatus("pending");
                const onConnect = () => {
                    socket.emit("room:join-request:watch", {
                        roomCode,
                        requestId: pendingRequestId,
                        userId: pendingUserId,
                        requestToken: pendingRequestToken,
                    }, (result) => {
                        if (cancelled) return;
                        if (!result?.success) {
                            setError(result?.message || "Unable to check your join request");
                            setStatus("Connection failed");
                            return;
                        }
                        if (result.status === "approved") {
                            acceptJoinRequest(result.userId);
                        } else if (result.status === "rejected") {
                            sessionStorage.removeItem("pendingJoinRequestId");
                            sessionStorage.removeItem("pendingJoinRequestToken");
                            sessionStorage.removeItem("pendingJoinUserId");
                            setJoinRequestStatus("rejected");
                            setStatus("Request rejected");
                        } else {
                            setJoinRequestStatus("pending");
                        }
                    });
                };
                const onResolved = (result) => {
                    if (cancelled || result?.requestId !== pendingRequestId) return;
                    if (result.status === "approved") {
                        acceptJoinRequest(result.userId);
                    } else if (result.status === "rejected") {
                        sessionStorage.removeItem("pendingJoinRequestId");
                        sessionStorage.removeItem("pendingJoinRequestToken");
                        sessionStorage.removeItem("pendingJoinUserId");
                        setJoinRequestStatus("rejected");
                        setStatus("Request rejected");
                        socket.disconnect();
                    }
                };
                const onConnectError = (err) => {
                    if (!cancelled) {
                        setError(err.message);
                        setStatus("Connection failed");
                    }
                };
                const onDisconnect = () => {
                    if (!cancelled) {
                        setStatus("Reconnecting...");
                    }
                };

                socket.on("connect", onConnect);
                socket.on("connect_error", onConnectError);
                socket.on("disconnect", onDisconnect);
                socket.on("room:join-request:resolved", onResolved);
                socket.on("room:ended", onMeetingEnded);
                cleanupSocket = () => {
                    socket.off("connect", onConnect);
                    socket.off("connect_error", onConnectError);
                    socket.off("disconnect", onDisconnect);
                    socket.off("room:join-request:resolved", onResolved);
                    socket.off("room:ended", onMeetingEnded);
                    socket.disconnect();
                };
                if (socket.connected) onConnect();
                else socket.connect();
                return;
            }

            try {
                const onConnect = () => {
                    socket.emit("room:join", { roomCode, userId, sessionToken }, (socketResult) => {
                        if (cancelled) return;
                        if (!socketResult?.success || !socketResult.room) {
                            socketJoinedRef.current = false;
                            setError(socketResult?.message || "Unable to join live room");
                            setStatus("Connection failed");
                            return;
                        }

                        socketJoinedRef.current = true;
                        const joinedRoom = socketResult.room;
                        applyParticipantSnapshot(joinedRoom);
                        setRoom((currentRoom) => ({
                            ...(currentRoom || {}),
                            ...joinedRoom,
                            ...(latestParticipantSnapshotRef.current &&
                                latestParticipantSnapshotRef.current.participantsVersion >=
                                    (joinedRoom.participantsVersion ?? -1)
                                ? latestParticipantSnapshotRef.current
                                : {}),
                            video: joinedRoom.video,
                        }));
                        setJoinRequests(joinedRoom.pendingJoinRequests || []);
                        setStatus("Connected to watch party!");
                        setError("");
                        loadChatHistory();
                        applyRoomVideoState(
                            joinedRoom.video,
                            true,
                            joinedRoom.video?.playState === "paused"
                        );
                    });
                };

                const onConnectError = (err) => {
                    if (!cancelled) {
                        setError(err.message);
                        setStatus("Connection failed");
                    }
                };

                const onDisconnect = () => {
                    socketJoinedRef.current = false;
                    setParticipantActionId("");
                    if (!cancelled) setStatus("Reconnecting...");
                };

                const onParticipantsUpdated = (data) => {
                    if (!cancelled) applyParticipantSnapshot(data);
                };
                const onParticipantNotification = (data) => {
                    if (
                        !cancelled &&
                        data?.roomCode === roomCode?.toUpperCase()
                    ) {
                        receiveParticipantNotification(data);
                    }
                };
                const onJoinRequestsUpdated = (data) => {
                    if (!cancelled && Array.isArray(data?.requests)) {
                        setJoinRequests(data.requests);
                    }
                };

                const onRoomRemoved = () => {
                    sessionStorage.removeItem("userId");
                    sessionStorage.removeItem("sessionToken");
                    socket.disconnect();
                    navigate("/");
                };
                const onHostLeft = () => {
                    clearRoomCredentials();
                    setMeetingLeft(true);
                    socket.disconnect();
                };

                const onVideoState = (data) => {
                    if (cancelled || data?.userId === userId) return;
                    applyRoomVideoState(data, true, data?.playState === "paused");
                };

                const onVideoSync = (data) => {
                    if (
                        cancelled ||
                        data?.userId === userId ||
                        !isValidPlaybackTime(data?.currentTime) ||
                        data.playState !== "playing" ||
                        !isValidVideoId(data.videoId)
                    ) {
                        return;
                    }

                    const syncedAt = data.syncedAt
                        ? new Date(data.syncedAt).getTime()
                        : Date.now();
                    const expectedTime = data.currentTime +
                        (Number.isFinite(syncedAt) ? Math.max(0, Date.now() - syncedAt) / 1000 : 0);
                    const player = playerRef.current;

                    playbackAnchorRef.current = {
                        ...data,
                        currentTime: expectedTime,
                        syncedAt: Date.now(),
                    };
                    pendingRoomStateRef.current = playbackAnchorRef.current;
                    if (!playerReadyRef.current || !socketJoinedRef.current || !player) return;

                    if (player.getVideoId() !== data.videoId) {
                        applyRoomVideoState(data, true);
                        return;
                    }

                    const actualTime = player.getCurrentTime();
                    if (
                        isValidPlaybackTime(actualTime) &&
                        Math.abs(actualTime - expectedTime) > DRIFT_THRESHOLD_SECONDS
                    ) {
                        player.seekTo(expectedTime);
                    }
                    if (player.getPlayerState() !== 1 && !autoplayBlockedRef.current) {
                        player.playVideo();
                    }
                };
                const onChatMessage = (message) => {
                    if (cancelled || !message?.id) return;
                    mergeChatMessages([message]);
                    if (
                        message.senderId !== userId &&
                        activeSidebarTabRef.current !== "chat"
                    ) {
                        setUnreadMessageCount((count) => count + 1);
                    }
                };

                socket.on("room:participants-updated", onParticipantsUpdated);
                socket.on("room:participant-notification", onParticipantNotification);
                socket.on("room:join-requests-updated", onJoinRequestsUpdated);
                socket.on("room:removed", onRoomRemoved);
                socket.on("room:host:left", onHostLeft);
                socket.on("room:ended", onMeetingEnded);
                socket.on("connect", onConnect);
                socket.on("connect_error", onConnectError);
                socket.on("disconnect", onDisconnect);
                socket.on("video:play", onVideoState);
                socket.on("video:pause", onVideoState);
                socket.on("video:seek", onVideoState);
                socket.on("video:change", onVideoState);
                socket.on("video:sync", onVideoSync);
                socket.on("chat:message:new", onChatMessage);
                cleanupSocket = () => {
                    socket.off("room:participants-updated", onParticipantsUpdated);
                    socket.off("room:participant-notification", onParticipantNotification);
                    socket.off("room:join-requests-updated", onJoinRequestsUpdated);
                    socket.off("room:removed", onRoomRemoved);
                    socket.off("room:host:left", onHostLeft);
                    socket.off("room:ended", onMeetingEnded);
                    socket.off("connect", onConnect);
                    socket.off("connect_error", onConnectError);
                    socket.off("disconnect", onDisconnect);
                    socket.off("video:play", onVideoState);
                    socket.off("video:pause", onVideoState);
                    socket.off("video:seek", onVideoState);
                    socket.off("video:change", onVideoState);
                    socket.off("video:sync", onVideoSync);
                    socket.off("chat:message:new", onChatMessage);
                    socketJoinedRef.current = false;
                    socket.disconnect();
                };

                const wasConnected = socket.connected;
                if (wasConnected) {
                    onConnect();
                } else {
                    socket.connect();
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "Unable to load room");
                    setStatus("Unable to load room");
                }
            }
        };

        joinRoom();
        return () => {
            cancelled = true;
            cleanupSocket?.();
        };
    }, [
        applyRoomVideoState,
        applyParticipantSnapshot,
        loadChatHistory,
        mergeChatMessages,
        navigate,
        pendingRequestId,
        pendingRequestToken,
        pendingUserId,
        roomCode,
        receiveParticipantNotification,
        sessionToken,
        sessionVersion,
        userId,
    ]);

    useEffect(() => {
        if (meetingEnded || meetingLeft) return undefined;
        const interval = setInterval(() => {
            const player = playerRef.current;
            if (!playerReadyRef.current || !player) return;

            const time = player.getCurrentTime();
            const videoDuration = player.getDuration();
            if (isValidPlaybackTime(time)) {
                const pausedRestore = pausedRestoreRef.current;
                const isWaitingForCuePosition = pausedRestore &&
                    Date.now() < pausedRestore.expiresAt &&
                    pausedRestore.currentTime > 0 &&
                    time < pausedRestore.currentTime - DRIFT_THRESHOLD_SECONDS;
                if (!isSeekingRef.current && !isWaitingForCuePosition) {
                    setCurrentTime(time);
                }
                if (pausedRestore && Date.now() >= pausedRestore.expiresAt) {
                    pausedRestoreRef.current = null;
                }
            }
            if (isValidPlaybackTime(videoDuration)) setDuration(videoDuration);
        }, 500);

        return () => clearInterval(interval);
    }, [meetingEnded, meetingLeft]);

    useEffect(() => {
        if (meetingEnded) return undefined;
        const interval = setInterval(() => {
            if (!canControlVideo || !isPlaying || !socketJoinedRef.current) return;
            const player = playerRef.current;
            const currentTime = player?.getCurrentTime();
            const videoId = player?.getVideoId() || room?.video?.videoId;
            if (!isValidPlaybackTime(currentTime) || !isValidVideoId(videoId)) return;

            socket.emit("video:sync", {
                roomCode,
                userId,
                videoId,
                currentTime,
            }, (result) => {
                if (!result?.success && result?.message !== "Room playback state has changed") {
                    setError(result?.message || "Unable to synchronize playback");
                }
            });
        }, SYNC_INTERVAL_MS);

        return () => clearInterval(interval);
    }, [canControlVideo, isPlaying, meetingEnded, room?.video?.videoId, roomCode, userId]);

    useEffect(() => {
        if (meetingEnded || isHost) return undefined;

        const interval = setInterval(() => {
            const anchor = playbackAnchorRef.current;
            const player = playerRef.current;
            if (
                !socketJoinedRef.current ||
                !playerReadyRef.current ||
                !anchor ||
                anchor.playState !== "playing" ||
                !player
            ) {
                return;
            }

            const expectedTime = anchor.currentTime +
                Math.max(0, Date.now() - anchor.syncedAt) / 1000;
            const actualTime = player.getCurrentTime();
            if (
                isValidPlaybackTime(actualTime) &&
                Math.abs(actualTime - expectedTime) > DRIFT_THRESHOLD_SECONDS
            ) {
                player.seekTo(expectedTime);
            }
            if (player.getVideoId() !== anchor.videoId) {
                applyRoomVideoState(anchor, true);
            } else if (player.getPlayerState() !== 1 && !autoplayBlockedRef.current) {
                player.playVideo();
            }
        }, SYNC_INTERVAL_MS);

        return () => clearInterval(interval);
    }, [applyRoomVideoState, isHost, meetingEnded]);

    const emitPlaybackCommand = (eventName, requestedTime) => {
        const player = playerRef.current;
        if (!canControlVideo || !socketJoinedRef.current || !player) return;
        const videoId = player.getVideoId() || room?.video?.videoId;
        if (!isValidVideoId(videoId)) {
            setError("Select a YouTube video before controlling playback.");
            return;
        }
        const actualTime = isValidPlaybackTime(requestedTime)
            ? requestedTime
            : player.getCurrentTime();
        if (!isValidPlaybackTime(actualTime)) {
            setError("The video player is not ready to synchronize playback.");
            return;
        }

        socket.emit(eventName, {
            roomCode,
            userId,
            videoId,
            currentTime: actualTime,
        }, (response) => {
            if (!response?.success) {
                setError(response?.message || "Unable to synchronize playback");
                return;
            }
            if (response.state) applyRoomVideoState(response.state, true);
        });
    };

    const handlePlay = () => emitPlaybackCommand("video:play");
    const handlePause = () => emitPlaybackCommand("video:pause");

    const manageParticipant = (eventName, targetUserId, role) => {
        if (!canControlVideo || !socketJoinedRef.current || participantActionId) return;

        setParticipantActionId(targetUserId);
        setParticipantActionError("");
        socket.emit(eventName, {
            roomCode,
            userId,
            targetUserId,
            ...(role ? { role } : {}),
        }, (result) => {
            setParticipantActionId("");
            if (!result?.success) {
                setParticipantActionError(result?.message || "Unable to update participant");
                return;
            }

            if (Array.isArray(result.participants)) applyParticipantSnapshot(result);
        });
    };

    const resolveRequest = (requestId, decision) => {
        if (!canControlVideo || !socketJoinedRef.current || joinRequestActionId) return;
        setJoinRequestActionId(requestId);
        setJoinRequestError("");
        socket.emit("room:join-request:resolve", {
            roomCode,
            userId,
            requestId,
            decision,
        }, (result) => {
            setJoinRequestActionId("");
            if (!result?.success) {
                setJoinRequestError(result?.message || "Unable to resolve join request");
                return;
            }
            if (Array.isArray(result.requests)) setJoinRequests(result.requests);
            else {
                setJoinRequests((previous) =>
                    previous.filter((request) => request.requestId !== requestId)
                );
            }
            if (Array.isArray(result.participants)) applyParticipantSnapshot(result);
        });
    };

    const handlePlayerReady = () => {
        const player = playerRef.current;
        const requiredMethods = [
            "playVideo",
            "pauseVideo",
            "seekTo",
            "loadVideoById",
            "cueVideoById",
            "getCurrentTime",
            "getDuration",
            "getPlayerState",
            "getVideoId",
        ];
        if (!player || requiredMethods.some((method) => typeof player[method] !== "function")) {
            setError("The YouTube player did not expose the expected playback API.");
            setStatus("Player initialization failed");
            return;
        }

        playerReadyRef.current = true;
        setPlayerReady(true);
        if (socketJoinedRef.current && pendingRoomStateRef.current) {
            applyRoomVideoState(
                pendingRoomStateRef.current,
                true,
                pendingRoomStateRef.current.playState === "paused"
            );
        }
    };
    const shareRoomCode = async () => {
        try {
            await navigator.clipboard.writeText(roomCode || "");
            setError("");
            setShareStatus("Room code copied");
        } catch {
            setError("Unable to copy the room code. Please copy it manually.");
            setShareStatus("");
        }
    };

    const leaveMeeting = () => {
        if (isHost) {
            const hasModerator = participants.some((person) => person.role === "Moderator");
            if (!hasModerator) {
                setHostActionError(
                    "Please promote a participant to Moderator before leaving, so the meeting can continue."
                );
                return;
            }
            if (!socketJoinedRef.current || hostActionPending) return;
            setHostActionPending(true);
            setHostActionError("");
            socket.emit("room:host:leave", { roomCode, userId }, (result) => {
                setHostActionPending(false);
                if (!result?.success) {
                    setHostActionError(
                        result?.message || "Unable to safely transfer the Host role."
                    );
                    return;
                }
                [
                    "userId",
                    "sessionToken",
                    "pendingJoinRequestId",
                    "pendingJoinRequestToken",
                    "pendingJoinUserId",
                ].forEach((key) => sessionStorage.removeItem(key));
                socket.disconnect();
                setMeetingLeft(true);
            });
            return;
        }
        if (!socketJoinedRef.current) {
            socket.disconnect();
            navigate("/");
            return;
        }
        socket.emit("room:leave", { roomCode, userId }, (result) => {
            if (!result?.success) {
                setError(result?.message || "Unable to leave the room cleanly");
                return;
            }
            socket.disconnect();
            setMeetingLeft(true);
        });
    };

    const endMeeting = () => {
        if (!isHost || !socketJoinedRef.current || hostActionPending) return;
        if (!window.confirm("End this meeting for everyone? This cannot be undone.")) return;

        setHostActionPending(true);
        setHostActionError("");
        socket.emit("room:end", { roomCode, userId }, (result) => {
            setHostActionPending(false);
            if (!result?.success) {
                setHostActionError(result?.message || "Unable to end the meeting.");
            }
        });
    };

    const formatTime = (time) => {
        const minutes = Math.floor(time / 60);
        const seconds = String(Math.floor(time % 60)).padStart(2, "0");
        return `${minutes}:${seconds}`;
    };

    if (meetingEnded) {
        return (
            <main className="flex h-dvh items-center justify-center bg-[#DEDEDE] px-4 text-[#1F2937]">
                <section className="w-full max-w-md rounded-xl border border-[#D1D5DB] bg-white p-6 text-center shadow-sm">
                    <h1 className="text-xl font-semibold">Meeting ended</h1>
                    <p className="mt-3 text-sm leading-6 text-[#4B5563]" role="status">
                        {error || "The Host has ended this meeting. Returning home…"}
                    </p>
                </section>
            </main>
        );
    }

    if (meetingLeft) {
        return (
            <main className="flex h-dvh items-center justify-center bg-[#DEDEDE] px-4 text-[#1F2937]">
                <section className="w-full max-w-md rounded-xl border border-[#D1D5DB] bg-white p-6 text-center shadow-sm">
                    <h1 className="text-xl font-semibold">You left the meeting</h1>
                    <p className="mt-3 text-sm leading-6 text-[#4B5563]" role="status">
                        You have left the room. Returning home…
                    </p>
                </section>
            </main>
        );
    }

    if (!userId && (pendingRequestId || joinRequestStatus === "rejected")) {
        return (
            <main className="flex h-dvh items-center justify-center bg-[#DEDEDE] px-4 text-[#1F2937]">
                <section className="w-full max-w-md rounded-xl border border-[#D1D5DB] bg-white p-6 text-center shadow-sm">
                    <h1 className="text-xl font-semibold">
                        {joinRequestStatus === "rejected" ? "Request not approved" : "Waiting to join"}
                    </h1>
                    <p className="mt-3 text-sm leading-6 text-[#4B5563]" role="status">
                        {joinRequestStatus === "rejected"
                            ? "The Host or Moderator rejected your request. You can submit a new request from the home page."
                            : "Waiting for the Host or Moderator to approve your request."}
                    </p>
                    {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
                    <Button
                        variant="primary"
                        size="md"
                        type="button"
                        onClick={() => {
                            socket.disconnect();
                            navigate("/");
                        }}
                        className="mt-5 rounded-lg bg-[#003399] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#002570]"
                    >
                        Return home
                    </Button>
                </section>
            </main>
        );
    }

    return (
        <main className="flex min-h-dvh flex-col bg-[#DEDEDE] text-[#1F2937] xl:h-dvh xl:overflow-hidden">
            <ParticipantNotifications
                notifications={participantNotifications.filter(
                    (notification) => notification.roomCode === roomCode?.toUpperCase()
                )}
            />
            <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#D1D5DB] px-4 py-3 sm:gap-4 sm:px-8">
                <div>
                    <h1 className="text-lg font-semibold">Watch party</h1>
                    <p className="mt-0.5 text-xs text-[#4B5563] sm:text-sm">
                        Room code: <span className="font-medium tracking-wider text-[#1F2937]">{roomCode}</span>
                    </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-[#4B5563] sm:text-sm" role="status">
                    <span className={`h-2 w-2 rounded-full ${status === "Connected to watch party!" ? "bg-green-400" : "bg-amber-400"}`} />
                    {status}
                </div>
            </header>

            <div className="mx-auto grid w-full max-w-[1500px] flex-1 grid-cols-1 gap-3 overflow-visible p-3 sm:gap-4 sm:p-5 lg:gap-5 lg:p-6 xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_320px] xl:grid-rows-1 xl:overflow-hidden xl:p-8">
                <section className="flex min-h-0 min-w-0 flex-col">
                    <div className="relative mx-auto aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-white xl:mx-0 xl:aspect-auto xl:h-[42dvh]">
                        {isValidVideoId(room?.video?.videoId) ? (
                            <>
                                <YouTubePlayer
                                    ref={playerRef}
                                    onPlayerReady={handlePlayerReady}
                                    onStateChange={(event) => {
                                        setIsPlaying(event.data === 1);
                                        if (event.data === 1) {
                                            autoplayBlockedRef.current = false;
                                            setNeedsPlaybackGesture(false);
                                        }

                                        const playerDuration = playerRef.current?.getDuration();
                                        if (isValidPlaybackTime(playerDuration)) setDuration(playerDuration);
                                    }}
                                    onAutoplayBlocked={() => {
                                        autoplayBlockedRef.current = true;
                                        setNeedsPlaybackGesture(true);
                                    }}
                                />
                                <div
                                    className="absolute inset-0 z-10"
                                    aria-hidden="true"
                                    title="Use the room controls to control playback"
                                />
                            </>
                        ) : (
                            <div className="grid h-full w-full place-items-center px-6 text-center">
                                <p className="max-w-sm text-sm leading-6 text-[#4B5563] sm:text-base">
                                    No video selected. The Host can paste a YouTube link to start watching.
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="mt-2 shrink-0 rounded-xl border border-[#D1D5DB] bg-white p-3 shadow-sm sm:mt-4 sm:p-5">
                        <div className="flex items-center gap-4">
                            <Button
                                variant="primary"
                                size="sm"
                                type="button"
                                onClick={isPlaying ? handlePause : handlePlay}
                                aria-label={isPlaying ? "Pause video" : "Play video"}
                                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#003399] text-lg text-white transition hover:bg-[#002570] disabled:cursor-not-allowed disabled:bg-[#9CA3AF] disabled:opacity-100 sm:h-11 sm:w-11"
                                disabled={!isValidVideoId(room?.video?.videoId) || !canControlVideo || !playerReady || status !== "Connected to watch party!"}
                                title={canControlVideo ? undefined : "Only the host or a moderator can control the video"}
                            >
                                {isPlaying ? "Ⅱ" : "▶"}
                            </Button>
                            <div className="min-w-0 flex-1">
                                <input
                                    aria-label="Seek video"
                                    type="range"
                                    min="0"
                                    max={duration || 0}
                                    step="1"
                                    value={Math.min(currentTime, duration || 0)}
                                    onPointerDown={() => {
                                        isSeekingRef.current = true;
                                    }}
                                    onChange={(event) => setCurrentTime(Number(event.target.value))}
                                    onPointerUp={(event) => {
                                        isSeekingRef.current = false;
                                        emitPlaybackCommand("video:seek", Number(event.currentTarget.value));
                                    }}
                                    onKeyUp={(event) => {
                                        if (event.key.startsWith("Arrow")) {
                                            emitPlaybackCommand("video:seek", Number(event.currentTarget.value));
                                        }
                                    }}
                                    disabled={!duration || !canControlVideo || !playerReady}
                                    className="w-full cursor-pointer accent-[#003399] disabled:cursor-not-allowed"
                                />
                                <div className="mt-1 flex justify-between text-xs tabular-nums text-[#4B5563]">
                                    <span>{formatTime(currentTime)}</span>
                                    <span>{formatTime(duration)}</span>
                                </div>
                            </div>
                        </div>

                        {needsPlaybackGesture && (
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                                <span className="text-xs text-[#1F2937]">
                                    Your browser blocked autoplay. Start playback to catch up with the room.
                                </span>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    type="button"
                                    disabled={!playerReady}
                                    onClick={() => {
                                        const player = playerRef.current;
                                        if (player && typeof player.playVideo === "function" && player.playVideo()) {
                                            autoplayBlockedRef.current = false;
                                            setNeedsPlaybackGesture(false);
                                        }
                                    }}
                                    className="rounded-md bg-[#003399] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#002570] disabled:bg-[#9CA3AF] disabled:opacity-100"
                                >
                                    Start video
                                </Button>
                            </div>
                        )}

                        <details className="mt-3 border-t border-[#D1D5DB] pt-3 sm:mt-5 sm:pt-4">
                            <summary className="cursor-pointer text-sm font-medium text-[#1F2937] marker:text-[#003399]">
                                Change video
                            </summary>
                            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                                <input
                                    id="video-url"
                                    type="text"
                                    placeholder="Paste a YouTube link or video ID"
                                    value={videoInput}
                                    onChange={(event) => setVideoInput(event.target.value)}
                                    disabled={!canControlVideo || status !== "Connected to watch party!"}
                                    className="min-w-0 flex-1 rounded-lg border border-[#D1D5DB] bg-white px-3 py-2.5 text-sm text-[#1F2937] outline-none placeholder:text-[#6B7280] focus:border-[#003399] focus:ring-2 focus:ring-[#003399]/20 disabled:bg-[#F3F4F6] disabled:opacity-100"
                                />
                                <Button
                                    variant="primary"
                                    size="md"
                                    type="button"
                                    disabled={!canControlVideo || status !== "Connected to watch party!"}
                                    onClick={() => {
                                        const input = videoInput.trim();
                                        const match = input.match(
                                            /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})(?:[?&].*)?$/
                                        );
                                        const videoId = match ? match[1] : input;

                                        if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
                                            setError("Please enter a valid YouTube video URL or ID.");
                                            return;
                                        }

                                        socket.emit("video:change", { roomCode, userId, videoId }, (result) => {
                                            if (result?.success) {
                                                setVideoInput("");
                                                setError("");
                                                if (result.state) applyRoomVideoState(result.state, true);
                                            } else {
                                                setError(result?.message || "Unable to change video");
                                            }
                                        });
                                    }}
                                    className="shrink-0 rounded-lg bg-[#003399] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#002570] disabled:cursor-not-allowed disabled:bg-[#9CA3AF] disabled:opacity-100"
                                >
                                    Load video
                                </Button>
                            </div>
                        </details>
                    </div>
                </section>

                <aside className="flex min-h-[360px] max-h-[65dvh] min-w-0 flex-col overflow-hidden rounded-xl border border-[#D1D5DB] bg-white p-3 shadow-sm sm:p-4 lg:p-5 xl:min-h-0 xl:max-h-none">
                    <div className="mb-3 grid shrink-0 grid-cols-2 rounded-lg bg-[#F3F4F6] p-1" role="tablist" aria-label="Room sidebar">
                        <Button
                            variant={activeSidebarTab === "people" ? "primary" : "ghost"}
                            size="md"
                            type="button"
                            id="people-tab"
                            role="tab"
                            aria-selected={activeSidebarTab === "people"}
                            aria-controls="people-panel"
                            onClick={openPeople}
                            className={`min-h-10 rounded-md px-3 text-sm font-medium transition ${activeSidebarTab === "people" ? "bg-[#003399] text-white hover:bg-[#002570]" : "text-[#4B5563] hover:bg-[#E5E7EB] hover:text-[#1F2937]"}`}
                        >
                            People <span className="ml-1 text-xs">({participants.length})</span>
                        </Button>
                        <Button
                            variant={activeSidebarTab === "chat" ? "primary" : "ghost"}
                            size="md"
                            type="button"
                            id="chat-tab"
                            role="tab"
                            aria-selected={activeSidebarTab === "chat"}
                            aria-controls="chat-panel"
                            onClick={openChat}
                            className={`min-h-10 rounded-md px-3 text-sm font-medium transition ${activeSidebarTab === "chat" ? "bg-[#003399] text-white hover:bg-[#002570]" : "text-[#4B5563] hover:bg-[#E5E7EB] hover:text-[#1F2937]"}`}
                        >
                            Chat
                            {unreadMessageCount > 0 && (
                                <span className="ml-2 rounded-full bg-[#003399] px-2 py-0.5 text-xs text-white" aria-label={`${unreadMessageCount} unread messages`}>
                                    {unreadMessageCount > 99 ? "99+" : unreadMessageCount}
                                </span>
                            )}
                        </Button>
                    </div>
                    {activeSidebarTab === "people" ? (
                    <div id="people-panel" role="tabpanel" aria-labelledby="people-tab" className="flex min-h-0 flex-1 flex-col">
                    {canControlVideo && (
                        <section className="mb-3 max-h-48 shrink-0 overflow-y-auto border-b border-[#D1D5DB] pb-3 sm:mb-4 sm:pb-4">
                            <div className="mb-2 flex items-center justify-between">
                                <h2 className="font-semibold">Join requests</h2>
                                <span className="rounded-full bg-[#EFF4FF] px-2.5 py-1 text-xs text-[#003399]">
                                    {joinRequests.length}
                                </span>
                            </div>
                            {joinRequests.length === 0 ? (
                                <p className="py-2 text-xs text-[#4B5563]">No pending requests</p>
                            ) : (
                                <div className="space-y-2">
                                    {joinRequests.map((request) => (
                                        <div key={request.requestId} className="rounded-lg bg-[#F9FAFB] p-2.5">
                                            <p className="truncate text-sm font-medium">{request.username}</p>
                                            {request.requestedAt && (
                                                <p className="mt-0.5 text-xs text-[#4B5563]">
                                                    {new Date(request.requestedAt).toLocaleTimeString()}
                                                </p>
                                            )}
                                            <div className="mt-2 flex gap-2">
                                                <Button
                                                    variant="primary"
                                                    size="sm"
                                                    type="button"
                                                    disabled={Boolean(joinRequestActionId)}
                                                    loading={joinRequestActionId === request.requestId}
                                                    onClick={() => resolveRequest(request.requestId, "approved")}
                                                    className="rounded-md bg-[#003399] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#002570] disabled:bg-[#9CA3AF] disabled:opacity-100"
                                                >
                                                    {joinRequestActionId === request.requestId ? "Working…" : "Approve"}
                                                </Button>
                                                <Button
                                                    variant="danger"
                                                    size="sm"
                                                    type="button"
                                                    disabled={Boolean(joinRequestActionId)}
                                                    onClick={() => resolveRequest(request.requestId, "rejected")}
                                                    className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                                                >
                                                    Reject
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {joinRequestError && (
                                <p className="mt-2 text-xs text-red-700" role="alert">{joinRequestError}</p>
                            )}
                        </section>
                    )}
                    <div className="flex shrink-0 items-center justify-between border-b border-[#D1D5DB] pb-2 sm:pb-4">
                        <h2 className="font-semibold">People</h2>
                        <span className="rounded-full bg-[#EFF4FF] px-2.5 py-1 text-xs text-[#003399]">
                            {participants.length}
                        </span>
                    </div>
                    <div
                        className="min-h-0 flex-1 divide-y divide-[#E5E7EB] overflow-y-auto overscroll-contain"
                        aria-label="Room participants"
                    >
                        {participants.map((person) => {
                            const isHost = person.role === "Host" || person.userId === room?.hostId;
                            return (
                                <div key={person.userId} className="min-w-0 py-2 lg:py-4">
                                    <div className="flex items-center gap-2 lg:gap-3">
                                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#EFF4FF] text-sm font-semibold text-[#003399] lg:h-10 lg:w-10">
                                            {person.username?.trim()?.charAt(0)?.toUpperCase() || "?"}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-xs font-medium sm:text-sm">{person.username}</p>
                                            <p className="mt-0.5 text-xs text-[#4B5563]">
                                                {person.userId === userId ? "You" : person.role}
                                            </p>
                                        </div>
                                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${isHost ? "bg-[#EFF4FF] text-[#003399]" : "bg-[#F3F4F6] text-[#4B5563]"}`}>
                                            {person.role}
                                        </span>
                                    </div>
                                    {canControlVideo && person.userId !== room.hostId && person.userId !== userId && (
                                        <div className="mt-2 flex gap-2 pl-11 lg:pl-[52px]">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                type="button"
                                                disabled={Boolean(participantActionId) || status !== "Connected to watch party!"}
                                                loading={participantActionId === person.userId}
                                                onClick={() => manageParticipant(
                                                    "room:role:update",
                                                    person.userId,
                                                    person.role === "Moderator" ? "Participant" : "Moderator"
                                                )}
                                                className="rounded-md border border-[#003399]/30 px-2 py-1 text-xs font-medium text-[#003399] transition hover:bg-[#EFF4FF] disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {participantActionId === person.userId
                                                    ? "Updating…"
                                                    : person.role === "Moderator"
                                                        ? "Demote"
                                                        : "Make moderator"}
                                            </Button>
                                            <Button
                                                variant="danger"
                                                size="sm"
                                                type="button"
                                                disabled={Boolean(participantActionId) || status !== "Connected to watch party!"}
                                                loading={participantActionId === person.userId}
                                                onClick={() => manageParticipant(
                                                    "room:participant:remove",
                                                    person.userId
                                                )}
                                                className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {participantActionId === person.userId ? "Working…" : "Remove"}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {participants.length === 0 && (
                            <p className="py-3 text-sm text-[#4B5563] lg:py-6">Loading participants…</p>
                        )}
                    </div>
                    {participantActionError && (
                        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
                            {participantActionError}
                        </p>
                    )}
                    </div>
                    ) : (
                        <div id="chat-panel" role="tabpanel" aria-labelledby="chat-tab" className="min-h-0 flex-1">
                            <RoomChat
                                messages={chatMessages}
                                userId={userId}
                                loading={chatHistoryLoading}
                                error={chatHistoryError}
                                sendError={chatSendError}
                                unreadCount={unreadMessageCount}
                                onSend={sendChatMessage}
                                onRetry={loadChatHistory}
                                onOpened={handleChatOpened}
                            />
                        </div>
                    )}
                    <div className="shrink-0 border-t border-[#D1D5DB] pt-2 sm:pt-4">
                        {isHost && (
                            <Button
                                variant="danger"
                                size="md"
                                type="button"
                                onClick={endMeeting}
                                disabled={hostActionPending || status !== "Connected to watch party!"}
                                loading={hostActionPending}
                                className="mb-2 w-full rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 sm:py-2.5 sm:text-sm"
                            >
                                {hostActionPending ? "Please wait…" : "End Meeting for Everyone"}
                            </Button>
                        )}
                        <div className="flex gap-2 xl:block">
                            <Button
                                variant="outline"
                                size="md"
                                type="button"
                                onClick={shareRoomCode}
                                className="w-full rounded-lg border border-[#003399]/30 px-3 py-2 text-xs font-medium text-[#003399] transition hover:bg-[#EFF4FF] sm:py-2.5 sm:text-sm"
                            >
                                {shareStatus || "Share room code"}
                            </Button>
                            <Button
                                variant="primary"
                                size="md"
                                type="button"
                                onClick={leaveMeeting}
                                disabled={hostActionPending}
                                loading={hostActionPending}
                                className="w-full rounded-lg bg-[#003399] px-3 py-2 text-xs font-medium text-white transition hover:bg-[#002570] disabled:bg-[#9CA3AF] sm:py-2.5 sm:text-sm xl:mt-2"
                            >
                                {hostActionPending ? "Leaving…" : "Leave meeting"}
                            </Button>
                        </div>
                    </div>
                    {hostActionError && (
                        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="alert">
                            {hostActionError}
                        </p>
                    )}
                </aside>
            </div>

            {error && (
                <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 mx-auto max-w-[1500px] sm:inset-x-6 lg:inset-x-8">
                    <p className="pointer-events-auto rounded-lg border border-[#003399]/20 bg-white px-4 py-3 text-sm text-[#1F2937] shadow-lg" role="alert">
                        {error}
                    </p>
                </div>
            )}
        </main>
    );
}

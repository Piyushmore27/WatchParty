
import crypto from "node:crypto"
import {
    createJoinRequest,
    createRoom,
    getRoomByCode,
    isParticipantSessionValid,
} from "../services/roomService.js";

const createSession = () => {
    const sessionToken = crypto.randomBytes(32).toString("base64url");
    return {
        sessionToken,
        sessionTokenHash: crypto.createHash("sha256").update(sessionToken).digest("hex"),
    };
};

const serializeParticipants = (participants) =>
    participants.map(({ userId, username, role, joinedAt }) => ({
        userId,
        username,
        role,
        joinedAt,
    }));

export const createRoomController = async(req,res, next)=> {
    try {
        const {username }= req.body;

        if(typeof username !== "string" || !username.trim()){
             return res.status(400).json({
                success: false,
                message: "Username is required",
            });
        }
        const userId = crypto.randomUUID();
        const { sessionToken, sessionTokenHash } = createSession();

        const room = await createRoom({
            username: username.trim(),
            userId,
            sessionTokenHash,
        });
        return res.status(201).json({
            success: true,
            message: "Watch party room created",
            userId,
            sessionToken,
            room: {
                roomCode: room.roomCode,
                hostId: room.hostId,
                participants: serializeParticipants(room.participants),
                video: room.video,
                createdAt: room.createdAt,
            },

        });
    } catch (err) {
        next(err);
    }
};

export const joinRoomController = async (req,res,next) => {
    try{
        const { username, requestId, requestToken, userId }= req.body;
        const { roomCode } = req.params;

        if(typeof username !== "string" || !username.trim()){
            return res.status(400).json({
                success:false,
                message: "Username is required",
            });
        }
        if(!roomCode || !/^[a-zA-Z0-9]{8}$/.test(roomCode)){
            return res.status(400).json({
                success:false,
                message: "Invalid room code",
            });
        }
        if (
            typeof requestId !== "string" ||
            !/^[0-9a-f-]{36}$/i.test(requestId) ||
            typeof userId !== "string" ||
            !/^[0-9a-f-]{36}$/i.test(userId) ||
            typeof requestToken !== "string" ||
            !/^[A-Za-z0-9_-]{43}$/.test(requestToken)
        ) {
            return res.status(400).json({
                success: false,
                message: "A valid join request ID and token are required",
            });
        }

        const sessionTokenHash = crypto.createHash("sha256").update(requestToken).digest("hex");
        const { request } = await createJoinRequest({
            roomCode,
            username: username.trim(),
            requestId,
            userId,
            sessionTokenHash,
        });
        return res.status(200).json({
            success: true,
            message: "Join request submitted",
            userId,
            requestToken,
            room: {
                roomCode: roomCode.toUpperCase(),
                requestId: request.requestId,
                status: request.status,
                requestedAt: request.requestedAt,
            },
        });
    }catch(error){
        if(error.message === "Room-not-found"){
            return res.status(404).json({
                success:false,
                message: "Room not found or inactive",
            });
        }
        if (
            error.message === "Join-request-id-conflict" ||
            error.message === "Join-request-conflict" ||
            error.message === "Duplicate-pending-join-request"
        ) {
            return res.status(409).json({
                success: false,
                message: error.message === "Duplicate-pending-join-request"
                    ? "A join request from this session is already pending"
                    : "This join request ID is already in use",
            });
        }
        if (error.message === "Already-room-member") {
            return res.status(409).json({
                success: false,
                message: "You are already a member of this room",
            });
        }
        next(error);
    }
};

export const getRoomController = async (req,res,next)=> {
    try {
        const { roomCode } = req.params;
        const { userId, sessionToken } = req.query;
        if(!/^[a-zA-Z0-9]{8}$/.test(roomCode || "")){
            return res.status(400).json({
                success: false,
                message: "Invalid room code",
            });
        }
        if (typeof userId !== "string" || typeof sessionToken !== "string") {
            return res.status(401).json({
                success: false,
                message: "An authorized room session is required",
            });
        }

        const room = await getRoomByCode(roomCode, {
            includeSessionTokenHashes: true,
        });
        if (!isParticipantSessionValid(room, userId, sessionToken)) {
            return res.status(403).json({
                success: false,
                message: "Room session is invalid",
            });
        }
        return res.status(200).json({
            success:true,
            room:{
                roomCode: room.roomCode,
                hostId: room.hostId,
                participants: serializeParticipants(room.participants),
                video:room.video,
                createdAt: room.createdAt,
                updatedAt: room.updatedAt,
            },
        });
    } catch (error) {
        if(error.message === "Room-not-found"){
            return res.status(404).json({
                success:false,
                message:"Room not found or inactive",
            });
        }
        next(error);
    }
};
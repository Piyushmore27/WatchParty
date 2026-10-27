
import mongoose from "mongoose";

const participantsSchema = new mongoose.Schema(
    {
        userId:{
            type: String,
            required: true,
        },
        sessionTokenHash: {
            type: String,
            select: false,
        },
        username: {
            type:String,
            required: true,
            trim: true,
        },
        role:{
            type: String,
            enum: ["Host","Moderator","Participant"],
            default: "Participant",
        },

        joinedAt: {
            type: Date,
            default: Date.now,
        },
    },
    {_id: false}

);

const videoSchema = new mongoose.Schema(
  {
    videoId: {
      type: String,
      default: "",
    },

    currentTime: {
      type: Number,
      default: 0,
      min: 0,
    },

    playState: {
      type: String,
      enum: ["playing", "paused"],
      default: "paused",
    },

    syncedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const joinRequestSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      required: true,
    },
    userId: {
      type: String,
      required: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
    },
    sessionTokenHash: {
      type: String,
      required: true,
      select: false,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      required: true,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    resolvedBy: {
      type: String,
      default: null,
    },
  },
  { _id: false }
);

const roomSchema = new mongoose.Schema(
  {
    roomCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    hostId: {
      type: String,
      required: true,
    },

    participants: {
      type: [participantsSchema],
      default: [],
    },

    joinRequests: {
      type: [joinRequestSchema],
      default: [],
    },

    video: {
      type: videoSchema,
      default: () => ({
        videoId: "",
        currentTime: 0,
        playState: "paused",
      }),
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const Room = mongoose.model("Room", roomSchema);

export default Room;
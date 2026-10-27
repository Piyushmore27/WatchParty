import express from "express";
import { createRoomController, joinRoomController,getRoomController } from "../controller/roomController.js";

const router = express.Router();

router.post("/",createRoomController);

router.post("/:roomCode/join",joinRoomController);

router.get("/:roomCode",getRoomController);

export default router;
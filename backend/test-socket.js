
import { io } from "socket.io-client";

const SERVER_URL = "http://localhost:8080";

// Postman se create-room response ki actual values daalna
const ROOM_CODE = "0F7EF5E2";
const USER_ID = "cbc4866d-e1eb-4590-994e-00cf0b0a1aa2";

const socket = io(SERVER_URL);

socket.on("connect", () => {
  console.log("Connected to Socket.IO:", socket.id);

  socket.emit(
    "room:join",
    {
      roomCode: ROOM_CODE,
      userId: USER_ID,
    },
    (response) => {
      console.log("Room join response:", response);
    //   socket.disconnect();
    }
  );
});

socket.on("room:participants-updated", (data) => {
  console.log("Updated participants:", data.participants);
});

socket.on("connect_error", (error) => {
  console.error("Socket connection failed:", error.message);
});

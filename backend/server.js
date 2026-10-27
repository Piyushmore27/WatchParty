
import "dotenv/config";
import http from "node:http";
import app from "./app.js";
import connectDB from "./config/db.js";
import { Server } from "socket.io";
import { registerRoomSocket } from "./socket/roomSocket.js";

const startServer = async () => {
  try {
    await connectDB();

    const httpServer = http.createServer(app);
    const io = new Server(httpServer, {
        cors:{
            origin: process.env.CLIENT_URL || "http://localhost:5173",
            methods:["GET","POST"],
        },
    });
    registerRoomSocket(io);

    io.on("connection",(socket)=> {
        console.log("Socket connected: ",socket.id);

        socket.on("disconnect", ()=>{
            console.log("Socket disconnected :",socket.id);
        });
    });
    httpServer.listen(process.env.PORT,()=>{
        console.log(`server running at port: ${process.env.PORT}`)
    })
    
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();

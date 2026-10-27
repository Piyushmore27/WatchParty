import experss from "express";
import cors from "cors";
import roomRoutes from "./routes/roomRoutes.js";


const app =experss();

app.use(
    cors({
        origin: process.env.CLIENT_URL || "http://localhost:5173",
    })
);

app.use(experss.json());


app.use("/api/rooms",roomRoutes);

app.get("/api/health",(req,res)=> {
    res.status(200).json({
        success:true,
        message: "YouTube Watch Party API is running!",
    })
})

export default app;
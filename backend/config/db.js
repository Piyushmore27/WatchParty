import mongoose from "mongoose";
import "dotenv/config"
const connectDb = async () => {
    try {
        const connection = await mongoose.connect(process.env.MONGODB_URI);
        console.log(`MongoDB connected : ${await connection.connection.host}`)
        
    } catch (error) {
        console.error("MongoDB connection failed:", error.message);
        process.exit(1);
    }
}

export default connectDb;
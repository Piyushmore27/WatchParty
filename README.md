# YouTube Watch Party 🎬

A real-time YouTube Watch Party application that allows multiple users to watch YouTube videos together in synchronized rooms. Users can create rooms, invite others, communicate through real-time chat, and enjoy a collaborative viewing experience with role-based permissions.

## 🌐 Live Demo

- **Frontend:** https://watch-party-wheat-tau.vercel.app/
- **Backend API:** https://watchparty-ftpo.onrender.com

> Replace these placeholders with your deployed URLs before submitting the project.

## ✨ Features

### 🏠 Room Management
- Create watch party rooms with unique room codes.
- Join existing rooms using a room code.
- Share room codes with other participants.
- Restore room state when users refresh the page.
- Handle inactive rooms and meeting termination.

### 🎥 Synchronized Video Playback
- Integrate YouTube videos using the YouTube IFrame Player API.
- Synchronize Play and Pause actions across participants.
- Synchronize video seeking and video changes.
- Maintain playback position and playback state.
- Periodically correct playback drift between participants.
- Allow the host to start a video by providing a YouTube link.

### 👥 Role-Based Access Control
The application supports three roles:

- **Host:** Manages the room, controls playback, assigns roles, manages participants, and can end the meeting for everyone.
- **Moderator:** Helps manage participants and has playback permissions according to the application's authorization rules.
- **Participant:** Watches synchronized videos and uses the available room features without unauthorized administrative controls.

All privileged operations should be validated on the backend.

### ✅ Join Approval System
- New users can request access to a room.
- The Host or an authorized Moderator can approve or reject requests.
- Pending users cannot access protected room functionality.
- Room access is granted after approval.

### 💬 Real-Time Chat
- Send and receive messages in real time.
- Display sender information and message timestamps.
- Support room-specific conversations.
- Show unread-message indicators when implemented in the chat interface.
- Load persisted chat history when database persistence is enabled.
- Validate room membership and message payloads on the server.

### 🔄 Meeting Management
- End the meeting for all participants.
- Support safe host departure and transfer of host ownership according to the implemented rules.
- Manage participant roles and room membership.
- Handle socket disconnections and reconnections.

### 📱 Responsive User Interface
- Responsive layouts for mobile phones, tablets, laptops, and desktop screens.
- Flexible video player and room layout.
- Responsive chat and participant panels.
- Touch-friendly controls and mobile-compatible navigation.

## 🛠️ Tech Stack

### Frontend
- React
- Vite
- Tailwind CSS
- Socket.IO Client
- YouTube IFrame Player API

### Backend
- Node.js
- Express.js
- Socket.IO
- MongoDB
- Mongoose

### Development Tools
- Git and GitHub
- npm
- Visual Studio Code

## 🏗️ Architecture Overview

The application uses a client-server architecture with REST APIs for room-related operations and Socket.IO for real-time communication.

```text
                    ┌──────────────────────┐
                    │    React Frontend    │
                    │                      │
                    │ Room UI / Chat       │
                    │ YouTube Player       │
                    │ Socket.IO Client     │
                    └──────────┬───────────┘
                               │
                    HTTP APIs + WebSockets
                               │
                    ┌──────────▼───────────┐
                    │   Express Backend    │
                    │                      │
                    │ Routes & Controllers │
                    │ Services & Middleware│
                    │ Socket Event Handlers│
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │       MongoDB        │
                    │                      │
                    │ Room / Participant   │
                    │ Playback / Chat Data │
                    └──────────────────────┘
```

### How Real-Time Synchronization Works

1. A user creates or joins a room.
2. The frontend establishes a Socket.IO connection and joins the appropriate room.
3. When an authorized user performs a playback action, the client sends an event to the backend.
4. The backend validates the room membership and the user's permissions.
5. The server broadcasts the accepted playback update to the other participants in that room.
6. Each connected client updates its YouTube player accordingly.
7. Playback-state restoration and periodic drift correction help keep participants synchronized.

Participant presence is tracked from active room sockets and deduplicated by user ID. The server broadcasts the authoritative list through `room:participants-updated` after joins and departures, including explicit `room:leave` events and unexpected disconnects. Brief disconnects have a short reconnection grace period. The server sends room-scoped `room:participant-notification` events for completed joins and departures. MongoDB retains room membership and role data independently of the live list.

### How Chat Works

1. A participant submits a chat message.
2. The backend validates the message and the sender's room access.
3. The server processes the message and persists it when database persistence is enabled.
4. The message is delivered to authorized participants in the same room.
5. Clients display the message without refreshing the page.

## 📁 Project Structure

```text
Watch-Party/
├── backend/
│   ├── config/
│   │   └── db.js
│   ├── controllers/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── services/
│   ├── socket/
│   ├── app.js
│   ├── server.js
│   ├── package.json
│   └── .env.example
│
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── socket/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   └── .env.example
│
├── .gitignore
└── README.md
```

> The structure above is representative. Update it if your actual repository differs.

## ⚙️ Prerequisites

Install the following before running the application:

- Node.js and npm
- MongoDB Atlas account or a running MongoDB instance
- Git

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/Piyushmore27/WatchParty.git
cd Watch-Party
```

### 2. Configure the Backend

```bash
cd backend
npm install
```

Create a `.env` file inside the `backend` directory:

```env
PORT=8080
MONGODB_URI=your_mongodb_connection_string
CLIENT_URL=http://localhost:5173
```

Use the environment variable names expected by your actual backend configuration. If your project uses a different name for the MongoDB URI or frontend origin, update this example accordingly.

Start the backend:

```bash
npm run dev
```

If the project does not define a `dev` script, use the available script in `backend/package.json`, or run:

```bash
node server.js
```

### 3. Configure the Frontend

Open a new terminal:

```bash
cd frontend
npm install
```

Create a `.env` file inside the `frontend` directory:

```env
VITE_API_URL=http://localhost:8080
```

This variable should point to the backend base URL expected by the frontend, including the Socket.IO connection if the application uses the same URL for both.

Start the frontend:

```bash
npm run dev
```

### 4. Open the Application

Open the local development URL shown by Vite, usually:

`http://localhost:5173`

Ensure the backend is running and connected to MongoDB before creating a room.

## 🔐 Environment Variables

| Variable | Purpose |
|---|---|
| `PORT` | Backend server port |
| `MONGODB_URI` | MongoDB connection string |
| `CLIENT_URL` | Allowed frontend origin for CORS |
| `VITE_API_URL` | Frontend backend and Socket.IO base URL |

Only include variables that your application actually uses. Never commit real database credentials, tokens, or secrets to GitHub.

## 🧪 Testing Checklist

Before submitting the application, verify:

- [ ] Users can create and join rooms.
- [ ] Room codes work correctly.
- [ ] YouTube playback is synchronized across multiple users.
- [ ] Play, Pause, Seek, and video changes work correctly.
- [ ] Playback state is restored after refresh.
- [ ] Join requests can be approved and rejected.
- [ ] Role-based permissions are enforced.
- [ ] Participants cannot perform unauthorized administrative actions.
- [ ] Real-time chat works across multiple clients.
- [ ] Chat messages remain isolated between rooms.
- [ ] Chat history persists after refresh if persistence is implemented.
- [ ] Meeting termination and host departure work correctly.
- [ ] The interface works on mobile, tablet, and desktop.
- [ ] Production builds complete successfully.

## 🚢 Deployment

The frontend and backend can be deployed separately.

### Frontend
Deploy the Vite application to a static hosting provider such as Vercel.

Configure:

```env
VITE_API_URL=https://watchparty-ftpo.onrender.com
```

### Backend
Deploy the Express and Socket.IO server to a Node.js hosting provider.

Configure the required environment variables, including the MongoDB connection string and the deployed frontend origin.

Ensure that:
- The server listens on the hosting provider's assigned port.
- CORS allows the deployed frontend origin.
- Socket.IO connections work over HTTPS/WSS.
- Production environment variables are configured securely.
- MongoDB is accessible from the deployed backend.

After deployment, add the actual frontend and backend URLs to the Live Demo section above.

## 🔒 Security Considerations

- Validate room membership and permissions on the server.
- Validate all incoming API requests and socket event payloads.
- Avoid trusting client-provided roles or sender identities.
- Keep credentials and environment files out of version control.
- Restrict access to room data and chat history.
- Use rate limiting for sensitive endpoints and chat events where appropriate.

If the application currently uses browser-stored user IDs without cryptographic authentication, these IDs alone should not be considered secure proof of identity. Stronger authentication may be needed for production use.

## 🔮 Future Improvements

Potential enhancements include:

- User authentication and persistent profiles.
- Emoji reactions and richer chat interactions.
- Host transfer controls and additional meeting settings.
- Redis-based Socket.IO scaling for multiple backend instances.
- Improved room lifecycle management.
- Automated integration and end-to-end tests.

## 👨‍💻 Author

**Developer:** Piyush More

**Project:** YouTube Watch Party System

**GitHub:** github.com/Piyushmore27

---

Built to make watching YouTube videos together a synchronized and collaborative experience.

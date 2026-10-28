import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../components/ui/Button.jsx";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080";

const createRequestToken = () => {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5">
      <path d="M4.167 10h11.666M10 4.167 15.833 10 10 15.833" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const [name, setName] = useState(() => localStorage.getItem("watchPartyName") || "");
  const [savedName, setSavedName] = useState(() => localStorage.getItem("watchPartyName") || "");
  const [roomCode, setRoomCode] = useState("");
  const [activeAction, setActiveAction] = useState("");
  const [error, setError] = useState("");
  const nameIsSaved = Boolean(savedName && name.trim() === savedName);
  const normalizedRoomCode = roomCode.trim().toUpperCase();

  const saveName = (event) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    localStorage.setItem("watchPartyName", trimmedName);
    setName(trimmedName);
    setSavedName(trimmedName);
    setError("");
  };

  const enterRoom = async (action) => {
    setActiveAction(action);
    setError("");

    try {
      const requestCredentials = action === "join"
        ? {
            requestId: sessionStorage.getItem("pendingJoinRequestId") || window.crypto.randomUUID(),
            userId: sessionStorage.getItem("pendingJoinUserId") || window.crypto.randomUUID(),
            requestToken: sessionStorage.getItem("pendingJoinRequestToken") || createRequestToken(),
          }
        : null;
      if (requestCredentials) {
        sessionStorage.setItem("pendingJoinRequestId", requestCredentials.requestId);
        sessionStorage.setItem("pendingJoinRequestToken", requestCredentials.requestToken);
        sessionStorage.setItem("pendingJoinUserId", requestCredentials.userId);
      }
      const response = await fetch(
        action === "host"
          ? `${API_URL}/api/rooms`
          : `${API_URL}/api/rooms/${encodeURIComponent(normalizedRoomCode)}/join`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: savedName,
            ...(requestCredentials || {}),
          }),
        },
      );
      const result = await response.json();

      if (!response.ok || !result.success || !result.room?.roomCode) {
        throw new Error(result.message || `Request failed: ${response.status}`);
      }

      sessionStorage.setItem("username", savedName);
      if (action === "host") {
        if (!result.userId || !result.sessionToken) {
          throw new Error("The server did not create a valid host session");
        }
        sessionStorage.setItem("userId", result.userId);
        sessionStorage.setItem("sessionToken", result.sessionToken);
        sessionStorage.removeItem("pendingJoinRequestId");
        sessionStorage.removeItem("pendingJoinRequestToken");
        sessionStorage.removeItem("pendingJoinUserId");
      } else {
        if (!requestCredentials || !result.room.requestId) {
          throw new Error("The server did not return a valid join request");
        }
        sessionStorage.removeItem("userId");
        sessionStorage.removeItem("sessionToken");
        sessionStorage.setItem("pendingJoinRequestId", result.room.requestId);
        sessionStorage.setItem("pendingJoinRequestToken", requestCredentials.requestToken);
        sessionStorage.setItem("pendingJoinUserId", requestCredentials.userId);
      }
      navigate(`/room/${result.room.roomCode}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Something went wrong. Please try again.");
    } finally {
      setActiveAction("");
    }
  };

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#DEDEDE] text-[#1F2937]">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 sm:px-8">
        <header className="flex shrink-0 items-center justify-between border-b border-[#D1D5DB] py-3 sm:py-5">
          <a href="/" className="flex items-center gap-3" aria-label="Watch Play home">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#003399]/10 text-[#003399]">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-6 w-6">
                <rect x="3" y="5" width="18" height="14" rx="4" stroke="currentColor" strokeWidth="1.7" />
                <path d="m10 9 5 3-5 3V9Z" fill="currentColor" />
              </svg>
            </span>
            <span className="text-lg font-semibold tracking-tight">watch<span className="text-[#003399]">play</span></span>
          </a>
        </header>

        <section className="grid min-h-0 flex-1 content-center gap-4 py-4 sm:gap-8 lg:grid-cols-[1fr_0.9fr] lg:gap-16 lg:py-8">
          <div className="max-w-xl">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#003399] sm:mb-4 sm:text-sm">
              A better way to watch together
            </p>
            <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Movie night, even when you&apos;re apart.
            </h1>
            <p className="mt-3 hidden max-w-lg text-base leading-7 text-[#4B5563] sm:mt-5 sm:block sm:text-lg">
              Start a room, invite your friends, and settle in to watch something together.
            </p>

            <div className="mt-4 max-w-lg rounded-xl border border-[#D1D5DB] bg-white p-3 text-left shadow-sm sm:mt-8 sm:p-5">
              <label className="min-w-0 flex-1">
                <span className="mb-1.5 block text-sm font-medium text-[#1F2937] sm:mb-2">Your name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveName(event);
                  }}
                  placeholder="What should we call you?"
                  maxLength={40}
                  autoComplete="name"
                  className="w-full rounded-lg border border-[#D1D5DB] bg-white px-4 py-2.5 text-base text-[#1F2937] outline-none transition placeholder:text-[#6B7280] focus:border-[#003399] focus:ring-2 focus:ring-[#003399]/20 sm:py-3"
                />
              </label>
              <Button
                variant="primary"
                size="md"
                type="button"
                onClick={saveName}
                disabled={!name.trim()}
                className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#003399] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#002570] disabled:cursor-not-allowed disabled:bg-[#9CA3AF] disabled:opacity-100 sm:mt-3 sm:min-h-11 sm:py-2.5"
              >
                {nameIsSaved ? "Name saved" : "Save name"}
              </Button>
            </div>
            {nameIsSaved && (
              <p className="mt-2 text-sm text-emerald-700 sm:mt-3" role="status">
                You&apos;re all set, {savedName}.
              </p>
            )}
          </div>

          <div className="mx-auto w-full max-w-lg">
            <div className="rounded-xl border border-[#D1D5DB] bg-white p-4 shadow-sm sm:p-7">
              <div className="mb-3 sm:mb-6">
                <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Join the watch party</h2>
                <p className="mt-1 text-sm leading-6 text-[#4B5563] sm:mt-2">Start a new room or enter a code from a friend.</p>
              </div>

              <div className="space-y-3 sm:space-y-4">
                <Button
                  variant="primary"
                  size="lg"
                  type="button"
                  onClick={() => enterRoom("host")}
                  disabled={!nameIsSaved || Boolean(activeAction)}
                  loading={activeAction === "host"}
                  className="group flex w-full items-center gap-4 rounded-lg bg-[#003399] p-3 text-left text-white transition hover:bg-[#002570] disabled:cursor-not-allowed disabled:bg-[#9CA3AF] disabled:opacity-100 disabled:hover:bg-[#9CA3AF] sm:p-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{activeAction === "host" ? "Creating your room…" : "Start a watch party"}</span>
                    <span className="mt-1 hidden text-sm text-white/85 sm:block">Create a room and invite your friends</span>
                  </span>
                  <ArrowIcon />
                </Button>

                <div className="rounded-lg border border-[#D1D5DB] bg-[#F9FAFB] p-3 sm:p-4">
                  <label htmlFor="room-code" className="mb-2 block text-sm font-medium text-[#1F2937]">Joining a friend?</label>
                  <div className="flex gap-2">
                    <input
                      id="room-code"
                      type="text"
                      value={roomCode}
                      onChange={(event) => setRoomCode(event.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && nameIsSaved && normalizedRoomCode.length === 8 && !activeAction) enterRoom("join");
                      }}
                      placeholder="Enter 8-character code"
                      maxLength={8}
                      autoCapitalize="characters"
                      className="min-w-0 flex-1 rounded-lg border border-[#D1D5DB] bg-white px-3 py-2.5 font-mono uppercase tracking-widest text-[#1F2937] outline-none transition placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-[#6B7280] focus:border-[#003399] focus:ring-2 focus:ring-[#003399]/20 sm:py-3"
                    />
                    <Button
                      variant="primary"
                      size="md"
                      type="button"
                      onClick={() => enterRoom("join")}
                      disabled={!nameIsSaved || normalizedRoomCode.length !== 8 || Boolean(activeAction)}
                      loading={activeAction === "join"}
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#003399] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#002570] disabled:cursor-not-allowed disabled:bg-[#9CA3AF] disabled:opacity-100 sm:py-3"
                    >
                      {activeAction === "join" ? "Joining…" : "Join"}
                      {activeAction !== "join" && <ArrowIcon />}
                    </Button>
                  </div>
                </div>
              </div>

              {error && (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:mt-4" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>
        </section>

        <footer className="hidden shrink-0 border-t border-[#D1D5DB] py-3 text-sm text-[#4B5563] sm:block sm:py-5">
          Watch together, wherever you are.
        </footer>
      </div>
    </main>
  );
}
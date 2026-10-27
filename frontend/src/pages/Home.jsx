import { useState } from "react";
import { useNavigate } from "react-router-dom";

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
    <main className="h-dvh overflow-hidden bg-slate-950 text-white">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-4 sm:px-8">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-800 py-3 sm:py-5">
          <a href="/" className="flex items-center gap-3" aria-label="Watch Play home">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-500/15 text-blue-300">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-6 w-6">
                <rect x="3" y="5" width="18" height="14" rx="4" stroke="currentColor" strokeWidth="1.7" />
                <path d="m10 9 5 3-5 3V9Z" fill="currentColor" />
              </svg>
            </span>
            <span className="text-lg font-semibold tracking-tight">watch<span className="text-blue-500">play</span></span>
          </a>
        </header>

        <section className="grid min-h-0 flex-1 content-center gap-4 py-4 sm:gap-8 lg:grid-cols-[1fr_0.9fr] lg:gap-16 lg:py-8">
          <div className="max-w-xl">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-blue-300 sm:mb-4 sm:text-sm">
              A better way to watch together
            </p>
            <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Movie night, even when you&apos;re apart.
            </h1>
            <p className="mt-3 hidden max-w-lg text-base leading-7 text-neutral-300 sm:mt-5 sm:block sm:text-lg">
              Start a room, invite your friends, and settle in to watch something together.
            </p>

            <div className="mt-4 max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-3 text-left sm:mt-8 sm:p-5">
              <label className="min-w-0 flex-1">
                <span className="mb-1.5 block text-sm font-medium text-neutral-100 sm:mb-2">Your name</span>
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
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-base text-white outline-none transition placeholder:text-neutral-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 sm:py-3"
                />
              </label>
              <button
                type="button"
                onClick={saveName}
                disabled={!name.trim()}
                className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45 sm:mt-3 sm:min-h-11 sm:py-2.5"
              >
                {nameIsSaved ? "Name saved" : "Save name"}
              </button>
            </div>
            {nameIsSaved && (
              <p className="mt-2 text-sm text-emerald-300 sm:mt-3" role="status">
                You&apos;re all set, {savedName}.
              </p>
            )}
          </div>

          <div className="mx-auto w-full max-w-lg">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-7">
              <div className="mb-3 sm:mb-6">
                <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Join the watch party</h2>
                <p className="mt-1 text-sm leading-6 text-neutral-300 sm:mt-2">Start a new room or enter a code from a friend.</p>
              </div>

              <div className="space-y-3 sm:space-y-4">
                <button
                  type="button"
                  onClick={() => enterRoom("host")}
                  disabled={!nameIsSaved || Boolean(activeAction)}
                  className="group flex w-full items-center gap-4 rounded-lg bg-blue-600 p-3 text-left text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-blue-600 sm:p-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{activeAction === "host" ? "Creating your room…" : "Start a watch party"}</span>
                    <span className="mt-1 hidden text-sm text-blue-100 sm:block">Create a room and invite your friends</span>
                  </span>
                  <ArrowIcon />
                </button>

                <div className="rounded-lg border border-slate-700 bg-slate-950 p-3 sm:p-4">
                  <label htmlFor="room-code" className="mb-2 block text-sm font-medium text-neutral-100">Joining a friend?</label>
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
                      className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono uppercase tracking-widest text-white outline-none transition placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-neutral-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 sm:py-3"
                    />
                    <button
                      type="button"
                      onClick={() => enterRoom("join")}
                      disabled={!nameIsSaved || normalizedRoomCode.length !== 8 || Boolean(activeAction)}
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 sm:py-3"
                    >
                      {activeAction === "join" ? "Joining…" : "Join"}
                      {activeAction !== "join" && <ArrowIcon />}
                    </button>
                  </div>
                </div>
              </div>

              {error && (
                <p className="mt-3 rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-200 sm:mt-4" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>
        </section>

        <footer className="hidden shrink-0 border-t border-slate-800 py-3 text-sm text-neutral-300 sm:block sm:py-5">
          Watch together, wherever you are.
        </footer>
      </div>
    </main>
  );
}
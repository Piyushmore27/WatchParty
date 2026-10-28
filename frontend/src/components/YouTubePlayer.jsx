
import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";

const YouTubePlayer = forwardRef(function YouTubePlayer(
    { onPlayerReady, onStateChange, onAutoplayBlocked },
    ref
) {
    const containerRef = useRef(null);
    const playerRef = useRef(null);
    const isReadyRef = useRef(false);
    const callbacksRef = useRef({ onPlayerReady, onStateChange, onAutoplayBlocked });
    const [playerError, setPlayerError] = useState("");

    useEffect(() => {
        callbacksRef.current = { onPlayerReady, onStateChange, onAutoplayBlocked };
    }, [onPlayerReady, onStateChange, onAutoplayBlocked]);

    useImperativeHandle(ref, () => ({
        playVideo() {
            if (!isReadyRef.current || typeof playerRef.current?.playVideo !== "function") {
                return false;
            }
            playerRef.current.playVideo();
            return true;
        },
        pauseVideo() {
            if (!isReadyRef.current || typeof playerRef.current?.pauseVideo !== "function") {
                return false;
            }
            playerRef.current.pauseVideo();
            return true;
        },
        seekTo(seconds) {
            if (
                !isReadyRef.current ||
                typeof playerRef.current?.seekTo !== "function" ||
                !Number.isFinite(seconds) ||
                seconds < 0
            ) {
                return false;
            }
            playerRef.current.seekTo(seconds, true);
            return true;
        },
        loadVideoById(id, startSeconds = 0, shouldPlay = true) {
            if (
                !isReadyRef.current ||
                !/^[a-zA-Z0-9_-]{11}$/.test(id) ||
                !Number.isFinite(startSeconds) ||
                startSeconds < 0
            ) {
                return false;
            }
            if (shouldPlay && typeof playerRef.current?.loadVideoById === "function") {
                playerRef.current.loadVideoById({ videoId: id, startSeconds });
            } else if (typeof playerRef.current?.cueVideoById === "function") {
                playerRef.current.cueVideoById({ videoId: id, startSeconds });
            } else {
                return false;
            }
            return true;
        },
        cueVideoById(id, startSeconds = 0) {
            if (
                !isReadyRef.current ||
                typeof playerRef.current?.cueVideoById !== "function" ||
                !/^[a-zA-Z0-9_-]{11}$/.test(id) ||
                !Number.isFinite(startSeconds) ||
                startSeconds < 0
            ) {
                return false;
            }
            playerRef.current.cueVideoById({ videoId: id, startSeconds });
            return true;
        },
        getCurrentTime() {
            if (!isReadyRef.current || typeof playerRef.current?.getCurrentTime !== "function") {
                return null;
            }
            const currentTime = playerRef.current.getCurrentTime();
            return Number.isFinite(currentTime) ? currentTime : null;
        },
        getPlayerState() {
            if (!isReadyRef.current || typeof playerRef.current?.getPlayerState !== "function") {
                return null;
            }
            return playerRef.current.getPlayerState();
        },
        getDuration() {
            if (!isReadyRef.current || typeof playerRef.current?.getDuration !== "function") {
                return null;
            }
            const duration = playerRef.current.getDuration();
            return Number.isFinite(duration) ? duration : null;
        },
        getVideoId() {
            if (!isReadyRef.current || typeof playerRef.current?.getVideoData !== "function") {
                return null;
            }
            return playerRef.current.getVideoData()?.video_id || null;
        },
    }), []);

    useEffect(() => {
        let cancelled = false;

        const initializePlayer = () => {
            if (cancelled || !containerRef.current) return;

            const playerElement = document.createElement("div");
            containerRef.current.replaceChildren(playerElement);

            const player = new window.YT.Player(playerElement, {
                width: "100%",
                height: "100%",
                playerVars: {
                    playsinline: 1,
                    controls: 0,
                    disablekb: 1,
                },
                events: {
                    onReady: (event) => {
                        if (cancelled) return;

                        playerRef.current = event.target;
                        isReadyRef.current = true;
                        callbacksRef.current.onPlayerReady?.(event.target);
                    },
                    onStateChange: (event) => {
                        callbacksRef.current.onStateChange?.(event);
                    },
                    onAutoplayBlocked: () => {
                        callbacksRef.current.onAutoplayBlocked?.();
                    },
                    onError: (event) => {
                        setPlayerError(`YouTube player error: ${event.data}`);
                    },
                },
            });

            playerRef.current = player;
        };

        const loadYouTubeAPI = () => {
            if (window.YT?.Player) {
                initializePlayer();
                return;
            }

            const existingScript = document.querySelector(
                'script[src="https://www.youtube.com/iframe_api"]'
            );

            if (!existingScript) {
                const script = document.createElement("script");
                script.src = "https://www.youtube.com/iframe_api";
                document.head.appendChild(script);
            }

            const previousCallback = window.onYouTubeIframeAPIReady;

            window.onYouTubeIframeAPIReady = () => {
                previousCallback?.();
                initializePlayer();
            };
        };

        loadYouTubeAPI();

        return () => {
            cancelled = true;
            isReadyRef.current = false;
            if (typeof playerRef.current?.destroy === "function") {
                playerRef.current.destroy();
            }
            playerRef.current = null;
        };
    }, []);

    return (
        <div>
            <div className="aspect-video w-full">
                <div ref={containerRef} className="h-full w-full" />
            </div>

            {playerError && (
                <p className="text-sm text-red-700">{playerError}</p>
            )}

        </div>
    );
});

export default YouTubePlayer;

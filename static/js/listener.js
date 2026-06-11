let youtubePlayer = null;
let youtubeReady = false;
let pendingYoutubeItem = null;
let pendingYoutubePosition = 0;
let pendingYoutubeShouldPlay = false;

const socket = io();

let playlist = [];
let currentItem = null;
let currentPlayingIndex = null;

const playlistDiv = document.getElementById("playlist");
const listenerAudio = document.getElementById("listenerAudio");
const lyricsBox = document.getElementById("lyricsBox");
const nowPlaying = document.getElementById("nowPlaying");
const listenerCount = document.getElementById("listenerCount");
const queuePreview = document.getElementById("queuePreview");

const playlistSearch = document.getElementById("playlistSearch");
const playlistFilter = document.getElementById("playlistFilter");

socket.on("connect", function () {
    socket.emit("join", { room_id: ROOM_ID });
});

socket.on("disconnect", function () {
    console.log("Disconnected from room");
});

function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerText = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add("show");
    }, 50);

    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
    }, 2800);
}

function toggleTheme() {
    document.body.classList.toggle("dark-mode");
    localStorage.setItem(
        "rythm_theme",
        document.body.classList.contains("dark-mode") ? "dark" : "light"
    );
}

if (localStorage.getItem("rythm_theme") === "dark") {
    document.body.classList.add("dark-mode");
}

function getYouTubeErrorMessage(code) {
    if (code === 2) return "Invalid YouTube video ID.";
    if (code === 5) return "The browser could not play this YouTube video.";
    if (code === 100) return "This YouTube video was not found or is unavailable.";
    if (code === 101 || code === 150) return "This YouTube video does not allow embedded playback.";
    return "Unknown YouTube playback error.";
}

window.onYouTubeIframeAPIReady = function () {
    youtubePlayer = new YT.Player("youtubePlayer", {
        height: "250",
        width: "100%",
        videoId: "",
        playerVars: {
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            iv_load_policy: 3,
            playsinline: 1,
            origin: window.location.origin
        },
        events: {
            onReady: () => {
                youtubeReady = true;

                if (pendingYoutubeItem) {
                    playYoutubeVideo(
                        pendingYoutubeItem.youtube_id,
                        pendingYoutubePosition,
                        pendingYoutubeShouldPlay
                    );
                }
            },
            onError: (event) => {
                const message = getYouTubeErrorMessage(event.data);
                console.error("YouTube listener playback error:", event.data, message);
                showToast(message, "warning");
            }
        }
    });
};

function playYoutubeVideo(videoId, position = 0, shouldPlay = true) {
    if (!youtubeReady || !youtubePlayer) {
        pendingYoutubeItem = { youtube_id: videoId };
        pendingYoutubePosition = position;
        pendingYoutubeShouldPlay = shouldPlay;
        return;
    }

    if (!shouldPlay) {
        youtubePlayer.cueVideoById({
            videoId: videoId,
            startSeconds: position || 0
        });
        return;
    }

    youtubePlayer.loadVideoById({
        videoId: videoId,
        startSeconds: position || 0
    });
}

function renderCoverArt(item = null) {
    const coverArt = document.querySelector(".cover-art");

    if (!coverArt) return;

    if (item && item.cover_url) {
        coverArt.innerHTML = `<img src="${item.cover_url}" alt="Cover">`;
        return;
    }

    if (item) {
        coverArt.innerHTML = item.type === "youtube" ? "YT" : "&#9835;";
        return;
    }

    coverArt.innerHTML = "&#9835;";
}

function renderQueuePreview() {
    if (!queuePreview) return;

    queuePreview.innerHTML = "";

    if (!playlist || playlist.length === 0) {
        queuePreview.innerHTML = "<p>No playlist items available.</p>";
        return;
    }

    playlist.forEach((item, index) => {
        const div = document.createElement("div");
        div.className = "queue-item";

        if (currentPlayingIndex === index) div.classList.add("playing");

        const typeLabel =
            item.type === "audio_only" ? "Audio Only" :
            item.type === "audio_lyrics" ? "Audio + Lyrics" :
            item.type === "lyrics_only" ? "Lyrics Only" :
            item.type === "youtube" ? "YouTube" :
            "Item";

        div.innerHTML = `
            <div>
                <b>${index + 1}. ${item.title}</b>
                <small>${item.artist || typeLabel}</small>
            </div>
            <span class="item-badge">${currentPlayingIndex === index ? "Playing" : typeLabel}</span>
        `;

        queuePreview.appendChild(div);
    });
}

socket.on("listener_count", function (data) {
    if (listenerCount) listenerCount.innerText = data.count;
});

socket.on("playlist_updated", function (data) {
    playlist = data;

    if (playlist.length === 0) {
        currentItem = null;
        currentPlayingIndex = null;
        listenerAudio.pause();
        listenerAudio.removeAttribute("src");
        nowPlaying.innerText = "Waiting for host...";
        lyricsBox.innerText = "No playlist items available.";
        renderCoverArt();
    }

    renderPlaylist();
});

socket.on("sync_state", function (state) {
    if (state.current_index !== null && playlist[state.current_index]) {
        currentPlayingIndex = state.current_index;
        loadItem(state.current_index);

        setTimeout(() => {
            if (currentItem.type === "youtube" && currentItem.youtube_id) {
                playYoutubeVideo(
                    currentItem.youtube_id,
                    state.position || 0,
                    state.is_playing
                );
            } else if (state.is_playing && currentItem.audio_url) {
                listenerAudio.currentTime = state.position || 0;
                listenerAudio.play();
            } else if (!state.is_playing && currentItem.audio_url) {
                listenerAudio.pause();
                listenerAudio.currentTime = state.position || 0;
            }
        }, 500);
    } else if (state.current_index === null) {
        currentPlayingIndex = null;
        renderQueuePreview();
    }

    renderPlaylist();
});

socket.on("play_item", function (data) {
    currentPlayingIndex = data.index;
    loadItem(data.index);
    renderPlaylist();

    setTimeout(() => {
        if (data.item.type === "youtube" && data.item.youtube_id) {
            playYoutubeVideo(data.item.youtube_id, data.position || 0, true);
        } else if (data.item.audio_url) {
            listenerAudio.currentTime = data.position || 0;
            listenerAudio.play();
        }
    }, 500);
});

socket.on("pause_item", function (data) {
    if (currentItem && currentItem.type === "youtube" && youtubeReady && youtubePlayer) {
        youtubePlayer.pauseVideo();
        youtubePlayer.seekTo(data.position || 0, true);
    }

    if (currentItem && currentItem.audio_url) {
        listenerAudio.pause();
        listenerAudio.currentTime = data.position || 0;
    }
});

socket.on("stop_item", function () {
    currentPlayingIndex = null;

    if (youtubeReady && youtubePlayer) {
        youtubePlayer.stopVideo();
    }

    listenerAudio.pause();
    listenerAudio.currentTime = 0;

    if (nowPlaying) {
        nowPlaying.innerText = "Waiting for host...";
    }

    renderCoverArt();
    renderPlaylist();
});

function loadItem(index) {
    currentItem = playlist[index];

    if (!currentItem) return;

    nowPlaying.innerText = currentItem.title || "Untitled";
    renderCoverArt(currentItem);

    listenerAudio.pause();
    listenerAudio.style.display = "none";

    const ytBox = document.getElementById("youtubePlayer");
    if (ytBox) ytBox.style.display = "none";

    if (currentItem.type === "youtube" && currentItem.youtube_id) {
        if (ytBox) ytBox.style.display = "block";

        playYoutubeVideo(currentItem.youtube_id, 0, false);
    } else if (currentItem.audio_url) {
        listenerAudio.src = currentItem.audio_url;
        listenerAudio.style.display = "block";
    } else {
        listenerAudio.removeAttribute("src");
    }

    lyricsBox.innerText = currentItem.lyrics || "No lyrics available.";
}

function renderPlaylist() {
    playlistDiv.innerHTML = "";

    if (playlist.length === 0) {
        playlistDiv.innerHTML = "<p>No playlist items available.</p>";
        renderQueuePreview();
        return;
    }

    const searchText = playlistSearch ? playlistSearch.value.toLowerCase() : "";
    const filterType = playlistFilter ? playlistFilter.value : "all";

    playlist.forEach((item, index) => {
        const title = item.title.toLowerCase();
        const artist = (item.artist || "").toLowerCase();

        const matchesSearch =
            title.includes(searchText) ||
            artist.includes(searchText);

        const matchesFilter =
            filterType === "all" || item.type === filterType;

        if (!matchesSearch || !matchesFilter) return;

        const div = document.createElement("div");
        div.className = "playlist-item";

        if (currentPlayingIndex === index) {
            div.classList.add("playing");
        }

        const icon =
            item.type === "youtube" ? "YT" :
            item.type === "lyrics_only" ? "Aa" :
            "&#9835;";
        const coverHTML = item.cover_url
            ? `<img src="${item.cover_url}" alt="cover">`
            : icon;

        const typeLabel =
            item.type === "audio_only" ? "Audio Only" :
            item.type === "audio_lyrics" ? "Audio + Lyrics" :
            item.type === "lyrics_only" ? "Lyrics Only" :
            "YouTube";

        div.innerHTML = `
            <div class="playlist-icon">${coverHTML}</div>

            <div class="playlist-info">
                <b>${index + 1}. ${item.title}</b>
                <small>${item.artist || "No description"}</small>
                <span class="item-badge">${typeLabel}</span>
            </div>
        `;

        playlistDiv.appendChild(div);
    });

    if (playlistDiv.innerHTML.trim() === "") {
        playlistDiv.innerHTML = "<p>No matching items found.</p>";
    }

    renderQueuePreview();
}

function enablePlayback() {
    listenerAudio.play().then(() => {
        listenerAudio.pause();
    }).catch(() => {});

    if (youtubeReady && youtubePlayer) {
        youtubePlayer.mute();
        youtubePlayer.playVideo();

        setTimeout(() => {
            youtubePlayer.pauseVideo();
            youtubePlayer.unMute();
        }, 500);
    }

    alert("Playback enabled. Host can now sync audio.");
}

renderCoverArt();
renderPlaylist();

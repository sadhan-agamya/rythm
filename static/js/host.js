const socket = io();

let playlist = INITIAL_PLAYLIST || [];
let selectedIndex = null;
let currentPlayingIndex = null;

let youtubePlayer = null;
let youtubeReady = false;

const playlistDiv = document.getElementById("playlist");
const hostAudio = document.getElementById("hostAudio");
const lyricsBox = document.getElementById("lyricsBox");
const autoNextToggle = document.getElementById("autoNextToggle");
const listenerCount = document.getElementById("listenerCount");
const hostNowPlaying = document.getElementById("hostNowPlaying");
const queuePreview = document.getElementById("queuePreview");

const playlistSearch = document.getElementById("playlistSearch");
const playlistFilter = document.getElementById("playlistFilter");

socket.emit("join", { room_id: ROOM_ID });

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

function onYouTubeIframeAPIReady() {
    youtubePlayer = new YT.Player("youtubePlayer", {
        height: "250",
        width: "100%",
        videoId: "",
        events: {
            onReady: () => {
                youtubeReady = true;
            },
            onStateChange: (event) => {
                if (event.data === YT.PlayerState.ENDED) {
                    socket.emit("song_ended", { room_id: ROOM_ID });
                }
            }
        }
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

    if (currentPlayingIndex === null || playlist.length === 0) {
        queuePreview.innerHTML = "<p>No active queue.</p>";
        return;
    }

    const nextItems = playlist.slice(currentPlayingIndex + 1, currentPlayingIndex + 4);

    if (nextItems.length === 0) {
        queuePreview.innerHTML = "<p>No upcoming items.</p>";
        return;
    }

    nextItems.forEach((item, i) => {
        const div = document.createElement("div");
        div.className = "queue-item";
        div.innerHTML = `
            <b>${i + 1}. ${item.title}</b>
            <small>${item.artist || item.type}</small>
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
        selectedIndex = null;
        currentPlayingIndex = null;
        hostAudio.pause();
        hostAudio.removeAttribute("src");
        lyricsBox.innerText = "No item selected.";
        hostNowPlaying.innerText = "Nothing selected";
        renderCoverArt();
    }

    if (selectedIndex !== null && selectedIndex >= playlist.length) {
        selectedIndex = playlist.length - 1;
    }

    renderPlaylist();
});

socket.on("auto_next_updated", function (data) {
    if (autoNextToggle) autoNextToggle.checked = data.enabled;
});

socket.on("sync_state", function (state) {
    if (autoNextToggle) {
        autoNextToggle.checked = state.auto_next || false;
    }

    currentPlayingIndex = state.current_index;

    if (state.current_index !== null && playlist[state.current_index]) {
        selectedIndex = state.current_index;
        loadItem(selectedIndex);

        const item = playlist[selectedIndex];

        setTimeout(() => {
            if (state.is_playing && item.type === "youtube" && youtubeReady && youtubePlayer) {
                youtubePlayer.seekTo(state.position || 0, true);
                youtubePlayer.playVideo();
            } else if (state.is_playing && item.audio_url) {
                hostAudio.currentTime = state.position || 0;
                hostAudio.play();
            }
        }, 500);
    }

    renderPlaylist();
});

socket.on("play_item", function (data) {
    selectedIndex = data.index;
    currentPlayingIndex = data.index;

    loadItem(selectedIndex);
    renderPlaylist();

    const item = data.item;

    setTimeout(() => {
        if (item.type === "youtube" && youtubeReady && youtubePlayer) {
            youtubePlayer.seekTo(data.position || 0, true);
            youtubePlayer.playVideo();
        } else if (item.audio_url) {
            hostAudio.currentTime = data.position || 0;
            hostAudio.play();
        }
    }, 500);
});

socket.on("pause_item", function (data) {
    const item = playlist[selectedIndex];

    if (item && item.type === "youtube" && youtubeReady && youtubePlayer) {
        youtubePlayer.pauseVideo();
        youtubePlayer.seekTo(data.position || 0, true);
    }

    if (item && item.audio_url) {
        hostAudio.pause();
        hostAudio.currentTime = data.position || 0;
    }
});

socket.on("stop_item", function () {
    currentPlayingIndex = null;

    if (youtubeReady && youtubePlayer) {
        youtubePlayer.stopVideo();
    }

    hostAudio.pause();
    hostAudio.currentTime = 0;

    if (hostNowPlaying) {
        hostNowPlaying.innerText = "Nothing playing";
    }

    renderCoverArt();
    renderPlaylist();
});

function renderPlaylist() {
    playlistDiv.innerHTML = "";

    if (playlist.length === 0) {
        playlistDiv.innerHTML = "<p>No playlist items added yet.</p>";
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

        if (selectedIndex === index) div.classList.add("active");
        if (currentPlayingIndex === index) div.classList.add("playing");

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

            <div class="playlist-actions">
                <button class="small-btn" onclick="moveItem(event, ${index}, -1)">&uarr;</button>
                <button class="small-btn" onclick="moveItem(event, ${index}, 1)">&darr;</button>
                <button class="delete-btn" onclick="deleteItem(event, ${index})">Delete</button>
            </div>
        `;

        div.onclick = () => {
            selectedIndex = index;
            loadItem(index);
            renderPlaylist();
        };

        playlistDiv.appendChild(div);
    });

    if (playlistDiv.innerHTML.trim() === "") {
        playlistDiv.innerHTML = "<p>No matching items found.</p>";
    }

    renderQueuePreview();
}

function loadItem(index) {
    if (index === null || !playlist[index]) return;

    const item = playlist[index];

    if (hostNowPlaying) {
        hostNowPlaying.innerText = item.title || "Untitled";
    }

    renderCoverArt(item);

    hostAudio.pause();
    hostAudio.style.display = "none";

    const ytBox = document.getElementById("youtubePlayer");
    if (ytBox) ytBox.style.display = "none";

    if (item.type === "youtube" && item.youtube_id) {
        if (ytBox) ytBox.style.display = "block";

        if (youtubeReady && youtubePlayer) {
            youtubePlayer.loadVideoById(item.youtube_id);
            youtubePlayer.pauseVideo();
        }
    } else if (item.audio_url) {
        hostAudio.src = item.audio_url;
        hostAudio.style.display = "block";
    } else {
        hostAudio.removeAttribute("src");
    }

    lyricsBox.innerText = item.lyrics || "No lyrics for this item.";
}

function playSelected() {
    if (playlist.length === 0) {
        showToast("Add at least one playlist item first.", "warning");
        return;
    }

    if (selectedIndex === null) {
        selectedIndex = 0;
        loadItem(selectedIndex);
        renderPlaylist();
    }

    const item = playlist[selectedIndex];
    let position = 0;

    if (item.type === "youtube" && youtubeReady && youtubePlayer) {
        position = youtubePlayer.getCurrentTime() || 0;
        youtubePlayer.playVideo();
    } else if (item.audio_url) {
        position = hostAudio.currentTime || 0;
        hostAudio.play();
    }

    socket.emit("host_play", {
        room_id: ROOM_ID,
        index: selectedIndex,
        position: position
    });
}

function pauseItem() {
    const item = playlist[selectedIndex];

    if (item && item.type === "youtube" && youtubeReady && youtubePlayer) {
        youtubePlayer.pauseVideo();
    }

    hostAudio.pause();

    socket.emit("host_pause", {
        room_id: ROOM_ID
    });
}

function stopItem() {
    const item = playlist[selectedIndex];

    if (item && item.type === "youtube" && youtubeReady && youtubePlayer) {
        youtubePlayer.stopVideo();
    }

    hostAudio.pause();
    hostAudio.currentTime = 0;

    if (hostNowPlaying) {
        hostNowPlaying.innerText = "Nothing playing";
    }

    renderCoverArt();

    socket.emit("host_stop", {
        room_id: ROOM_ID
    });
}

function skipItem() {
    if (playlist.length === 0) {
        showToast("No playlist items available.", "warning");
        return;
    }

    socket.emit("host_skip", {
        room_id: ROOM_ID
    });
}

function forceSync() {
    socket.emit("force_sync", {
        room_id: ROOM_ID
    });
    showToast("Sync sent to all listeners", "success");
}

function deleteItem(event, index) {
    event.stopPropagation();

    if (!confirm("Delete this playlist item?")) return;

    socket.emit("delete_item", {
        room_id: ROOM_ID,
        index: index
    });
    showToast("Item deleted", "success");
}

function moveItem(event, index, direction) {
    event.stopPropagation();

    socket.emit("move_item", {
        room_id: ROOM_ID,
        index: index,
        direction: direction
    });
}

function toggleAutoNext() {
    socket.emit("toggle_auto_next", {
        room_id: ROOM_ID,
        enabled: autoNextToggle.checked
    });
}

hostAudio.addEventListener("ended", function () {
    socket.emit("song_ended", {
        room_id: ROOM_ID
    });
});

const itemTypeRadios = document.querySelectorAll("input[name='item_type']");
const audioInput = document.getElementById("audioInput");
const coverInput = document.getElementById("coverInput");
const youtubeInput = document.getElementById("youtubeInput");
const lyricsInput = document.getElementById("lyricsInput");

function getSelectedItemType() {
    const selected = document.querySelector("input[name='item_type']:checked");
    return selected ? selected.value : "audio_only";
}

function updateUploadFields() {
    if (!audioInput || !youtubeInput || !lyricsInput) return;

    const type = getSelectedItemType();

    audioInput.style.display = "none";
    youtubeInput.style.display = "none";
    lyricsInput.style.display = "none";

    audioInput.required = false;
    youtubeInput.required = false;
    lyricsInput.required = false;

    if (coverInput) {
        coverInput.style.display = "block";
        coverInput.required = false;
    }

    if (type === "audio_only") {
        audioInput.style.display = "block";
        audioInput.required = true;
    }

    if (type === "audio_lyrics") {
        audioInput.style.display = "block";
        lyricsInput.style.display = "block";
        audioInput.required = true;
    }

    if (type === "lyrics_only") {
        lyricsInput.style.display = "block";
        lyricsInput.required = true;
    }

    if (type === "youtube") {
        youtubeInput.style.display = "block";
        youtubeInput.required = true;
        lyricsInput.style.display = "block";
    }
}

itemTypeRadios.forEach(radio => {
    radio.addEventListener("change", updateUploadFields);
});

updateUploadFields();
renderCoverArt();
renderPlaylist();

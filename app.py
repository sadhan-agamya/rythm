import os
import uuid
import time
import qrcode
from urllib.parse import urlparse, parse_qs
from flask import Flask, render_template, request, redirect, url_for, send_from_directory, session
from flask_socketio import SocketIO, emit, join_room
from werkzeug.utils import secure_filename
from database import (
    init_db,
    create_room_db,
    get_room_db,
    get_all_rooms_db,
    update_room_state_db,
    update_auto_next_db,
    add_playlist_item_db,
    get_playlist_db,
    delete_playlist_item_db,
    move_playlist_item_db
)

app = Flask(__name__)
app.config["SECRET_KEY"] = "rythm-secret"
app.config["UPLOAD_FOLDER"] = "uploads"
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024

ALLOWED_AUDIO_EXTENSIONS = {"mp3", "wav", "ogg", "m4a"}
ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

rooms = {}
room_users = {}

os.makedirs("uploads", exist_ok=True)
os.makedirs("static/qr", exist_ok=True)

init_db()


def create_room_id():
    return str(uuid.uuid4())[:6].upper()


def allowed_audio_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_AUDIO_EXTENSIONS


def allowed_image_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_IMAGE_EXTENSIONS


def extract_youtube_id(url):
    if not url:
        return None

    parsed = urlparse(url)

    if parsed.netloc in ["www.youtube.com", "youtube.com"]:
        query = parse_qs(parsed.query)
        return query.get("v", [None])[0]

    if parsed.netloc in ["youtu.be", "www.youtu.be"]:
        return parsed.path.strip("/")

    if "youtube.com" in parsed.netloc and "/shorts/" in parsed.path:
        return parsed.path.split("/shorts/")[-1].split("/")[0]

    return None


def load_room(room_id):
    room_db = get_room_db(room_id)

    if not room_db:
        return None

    return {
        "playlist": get_playlist_db(room_id),
        "room_name": room_db["room_name"],
        "room_description": room_db["room_description"],
        "current_index": room_db["current_index"],
        "is_playing": bool(room_db["is_playing"]),
        "position": room_db["position"] or 0,
        "last_started": room_db["last_started"],
        "auto_next": bool(room_db["auto_next"]),
        "is_private": bool(room_db["is_private"]),
        "pin": room_db["pin"],
        "host_pin": room_db["host_pin"]
    }


def save_room_state(room_id):
    room = rooms.get(room_id)

    if not room:
        return

    update_room_state_db(
        room_id=room_id,
        current_index=room["current_index"],
        is_playing=room["is_playing"],
        position=room["position"],
        last_started=room["last_started"]
    )


for saved_room in get_all_rooms_db():
    room_id = saved_room["room_id"]
    rooms[room_id] = load_room(room_id)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/create-room", methods=["POST"])
def create_room():
    room_id = create_room_id()
    room_type = request.form.get("room_type", "public")
    pin = request.form.get("pin")
    host_pin = request.form.get("host_pin")
    room_name = request.form.get("room_name", "Untitled Room").strip() or "Untitled Room"
    room_description = request.form.get("room_description", "").strip()
    is_private = room_type == "private"

    if not host_pin:
        return "Host PIN is required", 400

    if is_private and not pin:
        return "PIN is required for private room", 400

    create_room_db(
        room_id,
        room_name=room_name,
        room_description=room_description,
        is_private=is_private,
        pin=pin,
        host_pin=host_pin
    )

    rooms[room_id] = load_room(room_id)

    qr_url = request.host_url.rstrip("/") + url_for("listener", room_id=room_id)

    qr = qrcode.make(qr_url)
    qr_path = f"static/qr/{room_id}.png"
    qr.save(qr_path)

    session[f"host_auth_{room_id}"] = True

    return redirect(url_for("host", room_id=room_id))


@app.route("/host/<room_id>", methods=["GET", "POST"])
def host(room_id):
    if room_id not in rooms:
        loaded = load_room(room_id)

        if not loaded:
            return "Room not found", 404

        rooms[room_id] = loaded

    room = rooms[room_id]

    if session.get(f"host_auth_{room_id}") is True:
        return render_template("host.html", room_id=room_id, room=room)

    if request.method == "POST":
        entered_pin = request.form.get("host_pin")

        if entered_pin == room.get("host_pin"):
            session[f"host_auth_{room_id}"] = True
            return render_template("host.html", room_id=room_id, room=room)

        return render_template("host_pin.html", room_id=room_id, error="Incorrect Host PIN")

    return render_template("host_pin.html", room_id=room_id)


@app.route("/room/<room_id>", methods=["GET", "POST"])
def listener(room_id):
    if room_id not in rooms:
        loaded = load_room(room_id)

        if not loaded:
            return "Room not found", 404

        rooms[room_id] = loaded

    room = rooms[room_id]

    if room.get("is_private"):
        if request.method == "POST":
            entered_pin = request.form.get("pin")

            if entered_pin == room.get("pin"):
                return render_template("listener.html", room_id=room_id)

            return render_template(
                "pin.html",
                room_id=room_id,
                error="Incorrect PIN"
            )

        return render_template("pin.html", room_id=room_id)

    return render_template("listener.html", room_id=room_id)


@app.route("/upload/<room_id>", methods=["POST"])
def upload_song(room_id):
    if room_id not in rooms:
        loaded = load_room(room_id)

        if not loaded:
            return "Room not found", 404

        rooms[room_id] = loaded

    title = request.form.get("title", "Untitled").strip()
    artist = request.form.get("artist", "").strip()
    item_type = request.form.get("item_type")
    lyrics = request.form.get("lyrics", "").strip()
    youtube_url = request.form.get("youtube_url", "").strip()
    youtube_id = None

    file = request.files.get("audio")
    cover = request.files.get("cover")
    audio_url = None
    cover_url = None

    if item_type == "youtube":
        youtube_id = extract_youtube_id(youtube_url)

        if not youtube_id:
            return "Valid YouTube URL is required", 400

    if item_type in ["audio_only", "audio_lyrics"]:
        if not file or not file.filename:
            return "Audio file is required for this item type", 400

    if item_type == "lyrics_only":
        if not lyrics:
            return "Lyrics are required for lyrics-only item", 400

    if file and file.filename:
        if not allowed_audio_file(file.filename):
            return "Invalid file type. Only MP3, WAV, OGG, and M4A are allowed.", 400

        filename = secure_filename(file.filename)
        unique_filename = f"{uuid.uuid4()}_{filename}"

        file.save(os.path.join(app.config["UPLOAD_FOLDER"], unique_filename))

        audio_url = url_for("uploaded_file", filename=unique_filename)

    if cover and cover.filename:
        if not allowed_image_file(cover.filename):
            return "Invalid cover image. Only JPG, PNG, JPEG, and WEBP are allowed.", 400

        cover_filename = secure_filename(cover.filename)
        unique_cover = f"{uuid.uuid4()}_{cover_filename}"
        cover.save(os.path.join(app.config["UPLOAD_FOLDER"], unique_cover))
        cover_url = url_for("uploaded_file", filename=unique_cover)

    add_playlist_item_db(
        room_id=room_id,
        title=title,
        artist=artist,
        item_type=item_type,
        lyrics=lyrics,
        audio_url=audio_url,
        cover_url=cover_url,
        youtube_url=youtube_url,
        youtube_id=youtube_id
    )

    rooms[room_id]["playlist"] = get_playlist_db(room_id)

    socketio.emit("playlist_updated", rooms[room_id]["playlist"], room=room_id)

    return redirect(url_for("host", room_id=room_id))


@app.route("/uploads/<filename>")
def uploaded_file(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


@socketio.on("join")
def handle_join(data):
    room_id = data["room_id"]
    join_room(room_id)

    if room_id not in room_users:
        room_users[room_id] = set()

    room_users[room_id].add(request.sid)

    room = rooms.get(room_id)
    if not room:
        return

    emit("playlist_updated", room["playlist"])

    emit("sync_state", {
        "current_index": room["current_index"],
        "is_playing": room["is_playing"],
        "position": get_current_position(room),
        "auto_next": room.get("auto_next", False)
    })

    socketio.emit("listener_count", {
        "count": len(room_users[room_id])
    }, room=room_id)


@socketio.on("disconnect")
def handle_disconnect():
    for room_id, users in room_users.items():
        if request.sid in users:
            users.remove(request.sid)

            socketio.emit("listener_count", {
                "count": len(users)
            }, room=room_id)

            break


def get_current_position(room):
    if room["is_playing"] and room["last_started"] is not None:
        return room["position"] + (time.time() - float(room["last_started"]))
    return room["position"]


@socketio.on("host_play")
def host_play(data):
    room_id = data["room_id"]
    index = data["index"]
    position = float(data.get("position", 0))

    room = rooms[room_id]
    room["current_index"] = index
    room["is_playing"] = True
    room["position"] = position
    room["last_started"] = time.time()

    save_room_state(room_id)

    emit("play_item", {
        "index": index,
        "position": position,
        "item": room["playlist"][index]
    }, room=room_id)


@socketio.on("host_pause")
def host_pause(data):
    room_id = data["room_id"]

    room = rooms[room_id]
    room["position"] = get_current_position(room)
    room["is_playing"] = False
    room["last_started"] = None

    save_room_state(room_id)

    emit("pause_item", {
        "position": room["position"]
    }, room=room_id)


@socketio.on("host_stop")
def host_stop(data):
    room_id = data["room_id"]

    room = rooms[room_id]
    room["is_playing"] = False
    room["position"] = 0
    room["last_started"] = None

    save_room_state(room_id)

    emit("stop_item", room=room_id)


@socketio.on("host_skip")
def host_skip(data):
    room_id = data["room_id"]

    room = rooms[room_id]
    if not room["playlist"]:
        return

    if room["current_index"] is None:
        next_index = 0
    else:
        next_index = (room["current_index"] + 1) % len(room["playlist"])

    room["current_index"] = next_index
    room["is_playing"] = True
    room["position"] = 0
    room["last_started"] = time.time()

    save_room_state(room_id)

    emit("play_item", {
        "index": next_index,
        "position": 0,
        "item": room["playlist"][next_index]
    }, room=room_id)


@socketio.on("delete_item")
def delete_item(data):
    room_id = data["room_id"]
    index = int(data["index"])

    room = rooms.get(room_id)
    if not room:
        return

    deleted = delete_playlist_item_db(room_id, index)

    if not deleted:
        return

    room["playlist"] = get_playlist_db(room_id)

    if room["current_index"] == index:
        room["current_index"] = None
        room["is_playing"] = False
        room["position"] = 0
        room["last_started"] = None
        save_room_state(room_id)
        emit("stop_item", room=room_id)
    elif room["current_index"] is not None and room["current_index"] > index:
        room["current_index"] -= 1
        save_room_state(room_id)

    emit("playlist_updated", room["playlist"], room=room_id)


@socketio.on("move_item")
def move_item(data):
    room_id = data["room_id"]
    index = int(data["index"])
    direction = int(data["direction"])

    room = rooms.get(room_id)
    if not room:
        return

    moved = move_playlist_item_db(room_id, index, direction)

    if not moved:
        return

    old_current = room["current_index"]

    if old_current is not None:
        new_index = index + direction

        if old_current == index:
            room["current_index"] = new_index
        elif old_current == new_index:
            room["current_index"] = index

        save_room_state(room_id)

    room["playlist"] = get_playlist_db(room_id)

    emit("playlist_updated", room["playlist"], room=room_id)

    emit("sync_state", {
        "current_index": room["current_index"],
        "is_playing": room["is_playing"],
        "position": get_current_position(room),
        "auto_next": room.get("auto_next", False)
    }, room=room_id)


@socketio.on("toggle_auto_next")
def toggle_auto_next(data):
    room_id = data["room_id"]
    enabled = bool(data["enabled"])

    room = rooms.get(room_id)
    if not room:
        return

    room["auto_next"] = enabled
    update_auto_next_db(room_id, enabled)

    emit("auto_next_updated", {
        "enabled": enabled
    }, room=room_id)


@socketio.on("song_ended")
def song_ended(data):
    room_id = data["room_id"]

    room = rooms.get(room_id)
    if not room or not room["playlist"]:
        return

    if not room.get("auto_next"):
        room["is_playing"] = False
        room["position"] = 0
        room["last_started"] = None
        save_room_state(room_id)
        emit("stop_item", room=room_id)
        return

    if room["current_index"] is None:
        next_index = 0
    else:
        next_index = (room["current_index"] + 1) % len(room["playlist"])

    room["current_index"] = next_index
    room["is_playing"] = True
    room["position"] = 0
    room["last_started"] = time.time()

    save_room_state(room_id)

    emit("play_item", {
        "index": next_index,
        "position": 0,
        "item": room["playlist"][next_index]
    }, room=room_id)


@socketio.on("force_sync")
def force_sync(data):
    room_id = data["room_id"]

    room = rooms.get(room_id)
    if not room:
        return

    emit("sync_state", {
        "current_index": room["current_index"],
        "is_playing": room["is_playing"],
        "position": get_current_position(room),
        "auto_next": room.get("auto_next", False)
    }, room=room_id)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8855))
    socketio.run(app, host="0.0.0.0", port=port, debug=False)
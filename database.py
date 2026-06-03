import sqlite3
import uuid
from datetime import datetime

DB_NAME = "rythm.db"


def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS rooms (
            room_id TEXT PRIMARY KEY,
            room_name TEXT,
            room_description TEXT,
            is_private INTEGER DEFAULT 0,
            pin TEXT,
            host_pin TEXT,
            auto_next INTEGER DEFAULT 0,
            current_index INTEGER,
            is_playing INTEGER DEFAULT 0,
            position REAL DEFAULT 0,
            last_started REAL,
            created_at TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS playlist_items (
            id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL,
            title TEXT NOT NULL,
            artist TEXT,
            item_type TEXT NOT NULL,
            lyrics TEXT,
            audio_url TEXT,
            cover_url TEXT,
            youtube_url TEXT,
            youtube_id TEXT,
            position INTEGER NOT NULL,
            created_at TEXT,
            FOREIGN KEY(room_id) REFERENCES rooms(room_id)
        )
    """)

    conn.commit()
    conn.close()


def create_room_db(room_id, room_name=None, room_description=None, is_private=False, pin=None, host_pin=None):
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        INSERT INTO rooms (
            room_id, room_name, room_description,
            is_private, pin, host_pin, auto_next,
            current_index, is_playing, position,
            last_started, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        room_id,
        room_name,
        room_description,
        1 if is_private else 0,
        pin if is_private else None,
        host_pin,
        0,
        None,
        0,
        0,
        None,
        datetime.now().isoformat()
    ))

    conn.commit()
    conn.close()


def get_room_db(room_id):
    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT * FROM rooms WHERE room_id = ?", (room_id,))
    room = cur.fetchone()

    conn.close()
    return dict(room) if room else None


def get_all_rooms_db():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT * FROM rooms")
    rooms = cur.fetchall()

    conn.close()
    return [dict(room) for room in rooms]


def update_room_state_db(room_id, current_index=None, is_playing=False, position=0, last_started=None):
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        UPDATE rooms
        SET current_index = ?, is_playing = ?, position = ?, last_started = ?
        WHERE room_id = ?
    """, (
        current_index,
        1 if is_playing else 0,
        position,
        last_started,
        room_id
    ))

    conn.commit()
    conn.close()


def update_auto_next_db(room_id, enabled):
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        UPDATE rooms
        SET auto_next = ?
        WHERE room_id = ?
    """, (
        1 if enabled else 0,
        room_id
    ))

    conn.commit()
    conn.close()


def add_playlist_item_db(
    room_id,
    title,
    artist,
    item_type,
    lyrics,
    audio_url,
    cover_url=None,
    youtube_url=None,
    youtube_id=None
):
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        SELECT COUNT(*) AS count
        FROM playlist_items
        WHERE room_id = ?
    """, (room_id,))

    count = cur.fetchone()["count"]

    item_id = str(uuid.uuid4())

    cur.execute("""
        INSERT INTO playlist_items (
            id, room_id, title, artist, item_type,
            lyrics, audio_url, cover_url, youtube_url, youtube_id,
            position, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        item_id,
        room_id,
        title,
        artist,
        item_type,
        lyrics,
        audio_url,
        cover_url,
        youtube_url,
        youtube_id,
        count,
        datetime.now().isoformat()
    ))

    conn.commit()
    conn.close()

    return item_id


def get_playlist_db(room_id):
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        SELECT *
        FROM playlist_items
        WHERE room_id = ?
        ORDER BY position ASC, created_at ASC
    """, (room_id,))

    rows = cur.fetchall()
    conn.close()

    playlist = []

    for row in rows:
        playlist.append({
            "id": row["id"],
            "title": row["title"],
            "artist": row["artist"],
            "type": row["item_type"],
            "lyrics": row["lyrics"],
            "audio_url": row["audio_url"],
            "cover_url": row["cover_url"],
            "youtube_url": row["youtube_url"],
            "youtube_id": row["youtube_id"],
        })

    return playlist


def delete_playlist_item_db(room_id, index):
    playlist = get_playlist_db(room_id)

    if index < 0 or index >= len(playlist):
        return False

    item_id = playlist[index]["id"]

    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        DELETE FROM playlist_items
        WHERE id = ? AND room_id = ?
    """, (item_id, room_id))

    conn.commit()
    conn.close()

    reorder_playlist_db(room_id)
    return True


def reorder_playlist_db(room_id):
    playlist = get_playlist_db(room_id)

    conn = get_db()
    cur = conn.cursor()

    for index, item in enumerate(playlist):
        cur.execute("""
            UPDATE playlist_items
            SET position = ?
            WHERE id = ? AND room_id = ?
        """, (index, item["id"], room_id))

    conn.commit()
    conn.close()


def move_playlist_item_db(room_id, index, direction):
    playlist = get_playlist_db(room_id)

    if index < 0 or index >= len(playlist):
        return False

    new_index = index + direction

    if new_index < 0 or new_index >= len(playlist):
        return False

    playlist[index], playlist[new_index] = playlist[new_index], playlist[index]

    conn = get_db()
    cur = conn.cursor()

    for pos, item in enumerate(playlist):
        cur.execute("""
            UPDATE playlist_items
            SET position = ?
            WHERE id = ? AND room_id = ?
        """, (pos, item["id"], room_id))

    conn.commit()
    conn.close()

    return True

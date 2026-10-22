use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::{Html, IntoResponse},
    routing::get,
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, Mutex};
use tracing::{info, warn};
use uuid::Uuid;

const TICK_HZ: u64 = 20;
const TICK_DURATION: Duration = Duration::from_millis(1000 / TICK_HZ);
const MOVE_SPEED: f32 = 120.0;
const WORLD_LIMIT: f32 = 1000.0;
const MAX_PLAYERS_PER_ROOM: usize = 16;
const MAX_MESSAGES_PER_SECOND: u32 = 100;
const PROTOCOL_VERSION: u32 = 1;

#[derive(Default)]
struct AppState {
    rooms: Mutex<HashMap<String, Room>>,
}

#[derive(Default)]
struct Room {
    players: HashMap<String, Player>,
}

struct Player {
    x: f32,
    y: f32,
    input_x: f32,
    input_y: f32,
    tx: mpsc::Sender<String>,
}

#[derive(Serialize)]
struct PlayerView {
    id: String,
    x: f32,
    y: f32,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    JoinRoom { room: String },
    Input { x: f32, y: f32 },
    Ping { nonce: u64 },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerMessage {
    Welcome {
        id: String,
        protocol_version: u32,
        tick_hz: u64,
    },
    Joined { room: String },
    Snapshot {
        room: String,
        tick: u64,
        players: Vec<PlayerView>,
    },
    Pong { nonce: u64 },
    Error { message: String },
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "clutcher_mp=info".into()),
        )
        .init();

    let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let state = Arc::new(AppState::default());

    tokio::spawn(tick_loop(Arc::clone(&state)));

    let app = Router::new()
        .route("/", get(index))
        .route("/health", get(health))
        .route("/ws", get(websocket_upgrade))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("{host}:{port}"))
        .await
        .expect("failed to bind server address");

    info!("Clutcher MP listening at http://{}", listener.local_addr().unwrap());

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            if let Err(err) = tokio::signal::ctrl_c().await {
                warn!("could not listen for shutdown signal: {err}");
            }
        })
        .await
        .expect("server failed");
}

async fn index() -> Html<&'static str> {
    Html(include_str!("../client/test.html"))
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok", "protocol_version": PROTOCOL_VERSION }))
}

async fn websocket_upgrade(
    State(state): State<Arc<AppState>>,
    upgrade: WebSocketUpgrade,
) -> impl IntoResponse {
    upgrade
        .max_message_size(2048)
        .on_upgrade(move |socket| client_session(socket, state))
}

async fn client_session(socket: WebSocket, state: Arc<AppState>) {
    let id = Uuid::new_v4().to_string();
    let (mut writer, mut reader) = socket.split();
    let (tx, mut outgoing) = mpsc::channel::<String>(32);
    let mut current_room: Option<String> = None;
    let mut rate_window = Instant::now();
    let mut message_count = 0_u32;

    let mut writer_task = tokio::spawn(async move {
        while let Some(json) = outgoing.recv().await {
            if writer.send(Message::Text(json.into())).await.is_err() {
                break;
            }
        }
    });

    send_message(
        &tx,
        &ServerMessage::Welcome {
            id: id.clone(),
            protocol_version: PROTOCOL_VERSION,
            tick_hz: TICK_HZ,
        },
    );

    loop {
        let frame = tokio::select! {
            frame = reader.next() => frame,
            _ = &mut writer_task => break,
        };
        let msg = match frame {
            Some(Ok(msg)) => msg,
            Some(Err(err)) => {
                warn!("websocket read failed: {err}");
                break;
            }
            None => break,
        };

        let Message::Text(text) = msg else {
            if matches!(msg, Message::Close(_)) {
                break;
            }
            continue;
        };

        if rate_window.elapsed() >= Duration::from_secs(1) {
            rate_window = Instant::now();
            message_count = 0;
        }
        message_count += 1;
        if message_count > MAX_MESSAGES_PER_SECOND {
            send_error(&tx, "too many messages");
            break;
        }

        let message = match serde_json::from_str::<ClientMessage>(text.as_str()) {
            Ok(message) => message,
            Err(_) => {
                send_error(&tx, "invalid message or unsupported message type");
                continue;
            }
        };

        match message {
            ClientMessage::JoinRoom { room } => {
                match join_room(&state, &id, &room, &mut current_room, &tx).await {
                    Ok(()) => send_message(&tx, &ServerMessage::Joined { room }),
                    Err(reason) => send_error(&tx, reason),
                }
            }
            ClientMessage::Input { x, y } => {
                if !x.is_finite() || !y.is_finite() || x.abs() > 1.0 || y.abs() > 1.0 {
                    send_error(&tx, "input values must be finite and within -1..1");
                    continue;
                }
                let Some(room_name) = current_room.as_deref() else {
                    send_error(&tx, "join a room before sending input");
                    continue;
                };
                let mut rooms = state.rooms.lock().await;
                if let Some(player) = rooms
                    .get_mut(room_name)
                    .and_then(|room| room.players.get_mut(&id))
                {
                    player.input_x = x;
                    player.input_y = y;
                }
            }
            ClientMessage::Ping { nonce } => {
                send_message(&tx, &ServerMessage::Pong { nonce });
            }
        }
    }

    writer_task.abort();
    if let Some(room_name) = current_room {
        remove_player(&state, &room_name, &id).await;
    }
    info!(player_id = %id, "player disconnected");
}

fn valid_room_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 32
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

async fn join_room(
    state: &AppState,
    id: &str,
    new_room: &str,
    current_room: &mut Option<String>,
    tx: &mpsc::Sender<String>,
) -> Result<(), &'static str> {
    if !valid_room_name(new_room) {
        return Err("room ID must be 1-32 letters, numbers, underscores or hyphens");
    }
    if current_room.as_deref() == Some(new_room) {
        return Ok(());
    }

    let mut rooms = state.rooms.lock().await;
    if rooms.get(new_room).is_some_and(|room| room.players.len() >= MAX_PLAYERS_PER_ROOM) {
        return Err("room is full");
    }

    if let Some(old_room) = current_room.take() {
        if let Some(room) = rooms.get_mut(&old_room) {
            room.players.remove(id);
        }
        if rooms.get(&old_room).is_some_and(|room| room.players.is_empty()) {
            rooms.remove(&old_room);
        }
    }

    let room = rooms.entry(new_room.to_string()).or_default();
    let spawn_index = room.players.len() as f32;
    room.players.insert(
        id.to_string(),
        Player {
            x: spawn_index * 30.0,
            y: 0.0,
            input_x: 0.0,
            input_y: 0.0,
            tx: tx.clone(),
        },
    );
    *current_room = Some(new_room.to_string());
    info!(player_id = %id, room = %new_room, "player joined room");
    Ok(())
}

async fn remove_player(state: &AppState, room_name: &str, id: &str) {
    let mut rooms = state.rooms.lock().await;
    if let Some(room) = rooms.get_mut(room_name) {
        room.players.remove(id);
    }
    if rooms
        .get(room_name)
        .is_some_and(|room| room.players.is_empty())
    {
        rooms.remove(room_name);
    }
}

fn normalized_direction(x: f32, y: f32) -> (f32, f32) {
    let magnitude = x.hypot(y);
    if magnitude > 1.0 {
        (x / magnitude, y / magnitude)
    } else {
        (x, y)
    }
}

async fn tick_loop(state: Arc<AppState>) {
    let mut interval = tokio::time::interval(TICK_DURATION);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut tick = 0_u64;

    loop {
        interval.tick().await;
        tick = tick.wrapping_add(1);
        let mut pending = Vec::new();

        {
            let mut rooms = state.rooms.lock().await;
            for (name, room) in rooms.iter_mut() {
                for player in room.players.values_mut() {
                    let (dx, dy) = normalized_direction(player.input_x, player.input_y);
                    player.x = (player.x + dx * MOVE_SPEED / TICK_HZ as f32)
                        .clamp(-WORLD_LIMIT, WORLD_LIMIT);
                    player.y = (player.y + dy * MOVE_SPEED / TICK_HZ as f32)
                        .clamp(-WORLD_LIMIT, WORLD_LIMIT);
                }

                let players = room
                    .players
                    .iter()
                    .map(|(id, player)| PlayerView {
                        id: id.clone(),
                        x: player.x,
                        y: player.y,
                    })
                    .collect();

                let snapshot = ServerMessage::Snapshot {
                    room: name.clone(),
                    tick,
                    players,
                };
                let json = serde_json::to_string(&snapshot).expect("snapshot serialization");
                for player in room.players.values() {
                    pending.push((player.tx.clone(), json.clone()));
                }
            }
        }

        for (tx, json) in pending {
            // Drop outdated snapshots for slow clients rather than growing an unbounded queue.
            let _ = tx.try_send(json);
        }
    }
}

fn send_message(tx: &mpsc::Sender<String>, message: &ServerMessage) {
    if let Ok(json) = serde_json::to_string(message) {
        let _ = tx.try_send(json);
    }
}

fn send_error(tx: &mpsc::Sender<String>, message: &str) {
    send_message(
        tx,
        &ServerMessage::Error {
            message: message.to_owned(),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn room_ids_are_validated() {
        assert!(valid_room_name("lobby-01"));
        assert!(valid_room_name("private_room"));
        assert!(!valid_room_name(""));
        assert!(!valid_room_name("has spaces"));
        assert!(!valid_room_name("../admin"));
        assert!(!valid_room_name(&"a".repeat(33)));
    }

    #[test]
    fn diagonal_movement_is_not_faster() {
        let (x, y) = normalized_direction(1.0, 1.0);
        assert!((x.hypot(y) - 1.0).abs() < 0.0001);
        assert_eq!(normalized_direction(0.0, 0.0), (0.0, 0.0));
        assert_eq!(normalized_direction(1.0, 0.0), (1.0, 0.0));
    }

    #[tokio::test]
    async fn joining_another_room_removes_previous_membership() {
        let state = AppState::default();
        let (tx, _rx) = mpsc::channel(2);
        let mut current = None;
        join_room(&state, "player1", "alpha", &mut current, &tx)
            .await
            .unwrap();
        join_room(&state, "player1", "beta", &mut current, &tx)
            .await
            .unwrap();
        let rooms = state.rooms.lock().await;
        assert!(!rooms.contains_key("alpha"));
        assert!(rooms["beta"].players.contains_key("player1"));
    }
}

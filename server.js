const express = require('express');
const app = express();
const server = require('http').createServer(app);

const allowedOrigin = process.env.FRONTEND_URL || "*";

const io = require('socket.io')(server, {
    cors: {
        origin: allowedOrigin,
        methods: ["GET", "POST"]
    }
});

// ============================================================
// SERVER
// ============================================================

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// ============================================================
// RUM
// Varje rum har sin egen state.
// ============================================================

const rooms = new Map();

// ============================================================
// SKAPA NYTT RUM
// ============================================================

function createRoom() {
    let code;

    do {
        code = generateRoomCode();
    } while (rooms.has(code));

    rooms.set(code, {
        roomCode: code,

        players: [],
        scores: {},
        currentRound: 0,
        activePlayerIndex: 0,
        gameStarted: false,
        statistics: {},
        previousWinner: null,

        hostId: null,

        // Klienter som uttryckligen lämnat/resetat rummet.
        // Sparas även om de senare reconnectar med samma clientId.
        exitedClients: new Set(),

        // Socket -> clientId
        clients: new Map()
    });

    return rooms.get(code);
}

// ============================================================
// RUMSHÄMTNING
// ============================================================

function getRoom(code) {
    if (!code) return null;

    const normalized = String(code).trim().toUpperCase();

    return rooms.get(normalized) || null;
}

// ============================================================
// SKICKA STATE TILL ETT RUM
// ============================================================

function emitGameState(room) {
    if (!room) return;

    io.to(room.roomCode).emit('game_state', {
        players: room.players,
        scores: room.scores,
        currentRound: room.currentRound,
        activePlayerIndex: room.activePlayerIndex,
        started: room.gameStarted,
        hostId: room.hostId,
        statistics: room.statistics,
        previousWinner: room.previousWinner,
        roomCode: room.roomCode
    });
}

// ============================================================
// GENERERA RUMSKOD
// ============================================================

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';

    for (let i = 0; i < 6; i++) {
        code += chars.charAt(
            Math.floor(Math.random() * chars.length)
        );
    }

    return code;
}

// ============================================================
// SOCKET.IO
// ============================================================

io.on('connection', (socket) => {

    console.log('🔵 Ny spelare ansluten:', socket.id);

    // --------------------------------------------------------
    // CLIENT ID
    // --------------------------------------------------------
    // Detta är ett ID som skapas i webbläsaren och överlever
    // vanlig reconnect. Det används för reset-session.
    // --------------------------------------------------------

    socket.on('identify_client', (clientId) => {

        if (!clientId) return;

        socket.clientId = String(clientId);

        console.log(
            `🆔 Klient identifierad: ${socket.id} -> ${socket.clientId}`
        );
    });

    // --------------------------------------------------------
    // SKAPA RUM
    // --------------------------------------------------------

    socket.on('create_room', () => {

        const room = createRoom();

        room.hostId = socket.id;

        socket.currentRoom = room.roomCode;

        if (socket.clientId) {
            room.clients.set(socket.id, socket.clientId);
        }

        socket.join(room.roomCode);

        socket.emit('room_created', {
            roomCode: room.roomCode,
            hostId: room.hostId
        });

        console.log(
            `🏠 Rum skapat: ${room.roomCode} av ${socket.id}`
        );
    });

    // --------------------------------------------------------
    // GÅ MED I RUM
    // --------------------------------------------------------

    socket.on('join_room', (code) => {

        if (!code) {
            socket.emit(
                'room_error',
                'Ingen rumskod angavs.'
            );
            return;
        }

        const normalized = String(code)
            .trim()
            .toUpperCase();

        const room = getRoom(normalized);

        if (!room) {
            socket.emit(
                'room_error',
                'Rummet finns inte längre.'
            );
            return;
        }

        // ----------------------------------------------------
        // Kontrollera om denna klient tidigare resetat
        // från just detta rum.
        // ----------------------------------------------------

        if (
            socket.clientId &&
            room.exitedClients.has(socket.clientId)
        ) {
            socket.emit(
                'room_error',
                'Du har lämnat detta rum och kan inte ansluta till samma rum igen från denna session.'
            );
            return;
        }

        // ----------------------------------------------------
        // Om socket redan sitter i annat rum, lämna det först.
        // ----------------------------------------------------

        if (socket.currentRoom) {

            const oldRoom = getRoom(socket.currentRoom);

            if (oldRoom) {
                socket.leave(oldRoom.roomCode);
                oldRoom.clients.delete(socket.id);
            }
        }

        socket.currentRoom = room.roomCode;

        if (socket.clientId) {
            room.clients.set(socket.id, socket.clientId);
        }

        socket.join(room.roomCode);

        socket.emit('room_joined', {
            roomCode: room.roomCode,
            hostId: room.hostId
        });

        emitGameState(room);

        console.log(
            `🏠 ${socket.id} gick med i rum ${room.roomCode}`
        );
    });

    // --------------------------------------------------------
    // UPPDATERA SPELSTATE
    // --------------------------------------------------------

    socket.on('update_state', (data) => {

        if (!data) return;

        const room = getRoom(socket.currentRoom);

        if (!room) return;

        // Endast host får skriva state.
        if (socket.id !== room.hostId) {
            socket.emit(
                'state_error',
                'Endast protokollföraren kan ändra spelet.'
            );
            return;
        }

        room.players = Array.isArray(data.players)
            ? data.players
            : [];

        room.scores = data.scores || {};

        room.currentRound =
            Number(data.currentRound || 0);

        room.activePlayerIndex =
            Number(data.activePlayerIndex || 0);

        room.gameStarted =
            !!data.started;

        room.statistics =
            data.statistics || {};

        room.previousWinner =
            data.previousWinner || null;

        emitGameState(room);
    });

    // --------------------------------------------------------
    // HÄMTA STATE
    // --------------------------------------------------------

    socket.on('get_state', () => {

        const room = getRoom(socket.currentRoom);

        if (!room) {
            socket.emit('no_room');
            return;
        }

        socket.emit('game_state', {
            players: room.players,
            scores: room.scores,
            currentRound: room.currentRound,
            activePlayerIndex: room.activePlayerIndex,
            started: room.gameStarted,
            hostId: room.hostId,
            statistics: room.statistics,
            previousWinner: room.previousWinner,
            roomCode: room.roomCode
        });
    });

    // --------------------------------------------------------
    // RESET / LÄMNA SESSION
    // --------------------------------------------------------

    socket.on('reset_session', () => {

        const room = getRoom(socket.currentRoom);

        if (!room) {
            socket.emit('session_reset', {
                success: true
            });
            return;
        }

        // Markera klienten som lämnad från just detta rum.
        if (socket.clientId) {
            room.exitedClients.add(socket.clientId);
        }

        const oldRoomCode = room.roomCode;

        socket.leave(room.roomCode);

        room.clients.delete(socket.id);

        socket.currentRoom = null;

        socket.emit('session_reset', {
            success: true,
            roomCode: oldRoomCode
        });

        console.log(
            `↩️ ${socket.id} resetade sin session från rum ${oldRoomCode}`
        );

        // ----------------------------------------------------
        // OBS:
        // Vi ändrar INTE:
        // players
        // scores
        // statistics
        // currentRound
        // gameStarted
        // previousWinner
        //
        // Spelet fortsätter alltså precis som innan.
        // ----------------------------------------------------

        // Om host lämnar skickar vi information till resten.
        if (socket.id === room.hostId) {

            console.log(
                `👑 Host lämnade rum ${oldRoomCode}`
            );

            io.to(oldRoomCode).emit(
                'host_disconnected'
            );
        }
    });

    // --------------------------------------------------------
    // DISCONNECT
    // --------------------------------------------------------

    socket.on('disconnect', () => {

        console.log(
            '🔴 Spelare kopplade från:',
            socket.id
        );

        const room = getRoom(socket.currentRoom);

        if (!room) return;

        room.clients.delete(socket.id);

        if (socket.id === room.hostId) {

            console.log(
                `👑 Host disconnectade från rum ${room.roomCode}`
            );

            io.to(room.roomCode).emit(
                'host_disconnected'
            );
        }
    });
});

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {

    console.log(
        `🎲 Chicago-server körs på port ${PORT}`
    );

    console.log(
        `📡 Väntar på anslutningar...`
    );
});
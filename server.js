const express = require('express');
const app = express();
const server = require('http').createServer(app);

// ============================================================
// SERVER / SOCKET.IO
// ============================================================

const allowedOrigin = process.env.FRONTEND_URL || "*";

const io = require('socket.io')(server, {
    cors: {
        origin: allowedOrigin,
        methods: ["GET", "POST"]
    }
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// ============================================================
// RUM
// Varje rum har sin egen state.
// Ett rum kan därför spela helt oberoende av andra rum.
// ============================================================

const rooms = new Map();

const DISCONNECT_GRACE_MS = 60 * 1000;

// ============================================================
// HJÄLPFUNKTIONER
// ============================================================

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    let code;

    do {
        code = '';

        for (let i = 0; i < 6; i++) {
            code += chars.charAt(
                Math.floor(Math.random() * chars.length)
            );
        }
    } while (rooms.has(code));

    return code;
}

function createRoom(code) {
    return {
        roomCode: code,

        players: [],
        playerSockets: {},

        scores: {},
        currentRound: 0,
        activePlayerIndex: 0,

        gameStarted: false,
        statistics: {},
        previousWinner: null,

        hostId: null,

        createdAt: Date.now(),

        hostDisconnectedAt: null,
        hostDisconnectTimer: null
    };
}

function getRoom(code) {
    if (!code) return null;

    return rooms.get(String(code).toUpperCase()) || null;
}

function emitState(room) {
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

function emitStateToSocket(socket, room) {
    if (!socket || !room) return;

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
}

function removeSocketFromRoom(socket) {
    if (!socket.currentRoom) return;

    const room = getRoom(socket.currentRoom);

    if (!room) {
        socket.currentRoom = null;
        return;
    }

    delete room.playerSockets[socket.id];

    socket.leave(room.roomCode);
    socket.currentRoom = null;
}

function findAvailablePlayerForHost(room, leavingSocketId) {
    if (!room) return null;

    const socketIds = Object.keys(room.playerSockets);

    for (const socketId of socketIds) {
        if (socketId === leavingSocketId) continue;

        const player = room.playerSockets[socketId];

        if (!player) continue;

        return {
            socketId,
            playerName: player.playerName
        };
    }

    return null;
}

function transferHost(room, leavingSocketId, reason = 'left') {
    if (!room) return;

    if (room.hostId !== leavingSocketId) return;

    const newHost = findAvailablePlayerForHost(
        room,
        leavingSocketId
    );

    room.hostDisconnectedAt = null;

    if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
        room.hostDisconnectTimer = null;
    }

    if (!newHost) {
        room.hostId = null;

        emitState(room);

        return;
    }

    room.hostId = newHost.socketId;

    io.to(room.roomCode).emit('host_changed', {
        newHostId: newHost.socketId,
        newHostName: newHost.playerName,
        previousHostLeft: reason === 'left'
    });

    emitState(room);

    console.log(
        `👑 Ny protokollförare i ${room.roomCode}: ${newHost.playerName}`
    );
}

function scheduleHostTransfer(room) {
    if (!room) return;

    if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
    }

    room.hostDisconnectedAt = Date.now();

    room.hostDisconnectTimer = setTimeout(() => {
        room.hostDisconnectTimer = null;

        const currentHostSocket = io.sockets.sockets.get(room.hostId);

        if (currentHostSocket) {
            return;
        }

        transferHost(
            room,
            room.hostId,
            'disconnect'
        );
    }, DISCONNECT_GRACE_MS);
}

function cleanupEmptyRoom(room) {
    if (!room) return;

    const connectedPlayers = Object.keys(
        room.playerSockets
    );

    if (connectedPlayers.length > 0) return;

    if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
        room.hostDisconnectTimer = null;
    }

    rooms.delete(room.roomCode);

    console.log(`🗑️ Tomt rum raderat: ${room.roomCode}`);
}

// ============================================================
// SOCKET.IO
// ============================================================

io.on('connection', (socket) => {

    console.log(`🔵 Ny spelare ansluten: ${socket.id}`);

    // ========================================================
    // SKAPA RUM
    // ========================================================

    socket.on('create_room', () => {

        // Om klienten redan befinner sig i ett rum
        // lämnar vi det först.
        removeSocketFromRoom(socket);

        const code = generateRoomCode();
        const room = createRoom(code);

        room.hostId = socket.id;

        rooms.set(code, room);

        socket.join(code);
        socket.currentRoom = code;

        room.playerSockets[socket.id] = {
            playerName: null
        };

        socket.emit('room_created', {
            roomCode: code,
            hostId: socket.id
        });

        console.log(
            `🏠 Rum skapat: ${code} av ${socket.id}`
        );
    });

    // ========================================================
    // GÅ MED I RUM
    // ========================================================

    socket.on('join_room', (rawCode) => {

        if (!rawCode) return;

        const code = String(rawCode)
            .trim()
            .toUpperCase();

        if (code.length !== 6) {
            socket.emit(
                'room_error',
                'Rumskoden ska vara 6 tecken.'
            );

            return;
        }

        const room = getRoom(code);

        if (!room) {
            socket.emit(
                'room_error',
                'Rummet finns inte längre.'
            );

            return;
        }

        // Lämna eventuellt gammalt rum först.
        removeSocketFromRoom(socket);

        socket.join(code);
        socket.currentRoom = code;

        room.playerSockets[socket.id] = {
            playerName: null
        };

        // Om hosten tidigare tappade kontakten men kommer tillbaka
        // återtar hosten sin roll om det är samma socket.
        if (
            room.hostId &&
            room.hostId === socket.id
        ) {
            room.hostDisconnectedAt = null;

            if (room.hostDisconnectTimer) {
                clearTimeout(room.hostDisconnectTimer);
                room.hostDisconnectTimer = null;
            }
        }

        socket.emit('room_joined', {
            roomCode: code,
            hostId: room.hostId
        });

        emitStateToSocket(socket, room);

        console.log(
            `🏠 Spelare gick med i rum: ${code}`
        );
    });

    // ========================================================
    // REGISTRERA NAMN
    //
    // Detta används för att servern ska veta vilken fysisk
    // socket som motsvarar vilken spelare.
    // ========================================================

    socket.on('register_player', (playerName) => {

        if (!socket.currentRoom) return;

        const room = getRoom(socket.currentRoom);

        if (!room) return;

        const name = String(playerName || '').trim();

        if (!name) return;

        if (!room.playerSockets[socket.id]) {
            room.playerSockets[socket.id] = {};
        }

        room.playerSockets[socket.id].playerName = name;

        console.log(
            `👤 ${name} registrerad i ${room.roomCode}`
        );
    });

    // ========================================================
    // UPDATE STATE
    // Endast protokollföraren får ändra spelet.
    // ========================================================

    socket.on('update_state', (data) => {

        if (!data) return;

        const room = getRoom(socket.currentRoom);

        if (!room) return;

        if (socket.id !== room.hostId) {
            socket.emit(
                'action_error',
                'Endast protokollföraren kan göra detta.'
            );

            return;
        }

        room.players = Array.isArray(data.players)
            ? data.players
            : [];

        room.scores =
            data.scores && typeof data.scores === 'object'
                ? data.scores
                : {};

        room.currentRound =
            Number(data.currentRound || 0);

        room.activePlayerIndex =
            Number(data.activePlayerIndex || 0);

        room.gameStarted = !!data.started;

        room.statistics =
            data.statistics &&
            typeof data.statistics === 'object'
                ? data.statistics
                : {};

        room.previousWinner =
            data.previousWinner || null;

        // Försök koppla socket -> spelare.
        // Vi gör INTE om hela spelarlistan när någon annan ansluter.
        // Detta är viktigt för att namn och speldata inte ska nollställas.
        const hostPlayerNames = room.players.map(
            player => String(player).trim()
        );

        const hostRecord = room.playerSockets[socket.id];

        if (
            hostRecord &&
            hostRecord.playerName &&
            hostPlayerNames.includes(hostRecord.playerName)
        ) {
            // Hostens namn är redan känt.
        }

        emitState(room);
    });

    // ========================================================
    // GET STATE
    // ========================================================

    socket.on('get_state', () => {

        const room = getRoom(socket.currentRoom);

        if (!room) {
            socket.emit('no_room');
            return;
        }

        emitStateToSocket(socket, room);
    });

    // ========================================================
    // LÄMNA SESSION
    //
    // Detta avslutar bara den här klientens session.
    // Spelet i rummet ligger kvar.
    // ========================================================

    socket.on('leave_session', () => {

        const room = getRoom(socket.currentRoom);

        if (!room) {
            socket.emit('session_left');
            return;
        }

        const wasHost =
            socket.id === room.hostId;

        const playerRecord =
            room.playerSockets[socket.id];

        const playerName =
            playerRecord?.playerName || null;

        console.log(
            `🚪 ${socket.id} lämnar sessionen i ${room.roomCode}`
        );

        delete room.playerSockets[socket.id];

        socket.leave(room.roomCode);
        socket.currentRoom = null;

        if (wasHost) {

            transferHost(
                room,
                socket.id,
                'left'
            );

            if (room.hostId) {
                const newHostSocket =
                    io.sockets.sockets.get(room.hostId);

                if (newHostSocket) {
                    newHostSocket.emit(
                        'session_notice',
                        {
                            type: 'new_host',
                            title: 'NY PROTOKOLLFÖRARE',
                            message:
                                `${playerName || 'Den tidigare protokollföraren'} har lämnat sessionen. Du är nu protokollförare.`
                        }
                    );
                }
            }
        }

        emitState(room);

        socket.emit('session_left');

        cleanupEmptyRoom(room);
    });

    // ========================================================
    // DISCONNECT
    //
    // Viktigt:
    // Ett vanligt disconnect avslutar INTE sessionen direkt.
    // Hosten får en respittid.
    // ========================================================

    socket.on('disconnect', () => {

        console.log(
            `🔴 Socket disconnectade: ${socket.id}`
        );

        const room = getRoom(socket.currentRoom);

        if (!room) return;

        const wasHost =
            socket.id === room.hostId;

        delete room.playerSockets[socket.id];

        if (wasHost) {

            console.log(
                `⚠️ Protokollföraren tappade anslutningen i ${room.roomCode}`
            );

            scheduleHostTransfer(room);

        }

        cleanupEmptyRoom(room);
    });
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/health', (req, res) => {
    res.json({
        ok: true,
        rooms: rooms.size
    });
});

// ============================================================
// START
// ============================================================

server.listen(PORT, () => {

    console.log(
        `🎲 Chicago-server körs på port ${PORT}`
    );

    console.log(
        `📡 Väntar på anslutningar...`
    );
});

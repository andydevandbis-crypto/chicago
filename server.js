const express = require('express');
const app = express();
const server = require('http').createServer(app);

// Sätt FRONTEND_URL som env-variabel i Render när du vet er live-frontend-URL,
// t.ex. https://mitt-spel.vercel.app. Tills dess tillåts alla origins ("*").
const allowedOrigin = process.env.FRONTEND_URL || "*";

const io = require('socket.io')(server, {
    cors: {
        origin: allowedOrigin,
        methods: ["GET", "POST"]
    }
});

// Servera Chicago-spelet
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// ============================================================
// SPELSTATE
// ============================================================
let players = [];
let scores = {};
let currentRound = 0;
let activePlayerIndex = 0;
let gameStarted = false;
let statistics = {};
let previousWinner = null;
let hostId = null;
let roomCode = null;

// ============================================================
// SOCKET.IO EVENTS
// ============================================================
io.on('connection', (socket) => {
    console.log('🔵 Ny spelare ansluten!');

    socket.on('create_room', () => {
        roomCode = generateRoomCode();
        hostId = socket.id;
        socket.join(roomCode);
        socket.emit('room_created', { roomCode, hostId });
        console.log(`🏠 Rum skapat: ${roomCode} av ${socket.id}`);
    });

    socket.on('join_room', (code) => {
        if (!code) return;
        socket.join(code);
        roomCode = code;
        socket.emit('room_joined', { roomCode, hostId });
        console.log(`🏠 Spelare gick med i rum: ${code}`);
    });

    socket.on('update_state', (data) => {
        if (!data || !roomCode) return;

        players = data.players || [];
        scores = data.scores || {};
        currentRound = data.currentRound || 0;
        activePlayerIndex = data.activePlayerIndex || 0;
        gameStarted = data.started || false;
        statistics = data.statistics || {};
        previousWinner = data.previousWinner || null;

        io.to(roomCode).emit('game_state', {
            players,
            scores,
            currentRound,
            activePlayerIndex,
            started: gameStarted,
            hostId,
            statistics,
            previousWinner,
            roomCode
        });
    });

    socket.on('get_state', () => {
        if (!roomCode) {
            socket.emit('no_room');
            return;
        }

        socket.emit('game_state', {
            players,
            scores,
            currentRound,
            activePlayerIndex,
            started: gameStarted,
            hostId,
            statistics,
            previousWinner,
            roomCode
        });
    });

    socket.on('disconnect', () => {
        console.log('🔴 Spelare kopplade från');

        if (socket.id === hostId) {
            console.log('👑 Host disconnectade');
            io.to(roomCode).emit('host_disconnected');
        }
    });
});

// ============================================================
// HJÄLPFUNKTIONER
// ============================================================
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';

    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return code;
}

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
    console.log(`🎲 Chicago-server körs på port ${PORT}`);
    console.log(`📡 Väntar på anslutningar...`);
});
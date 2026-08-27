const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

const PORT = process.env.PORT || 3001;

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.use(express.static(__dirname));

// ============================================================
// RUM
// ============================================================

const rooms = new Map();

function createRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code;

    do {
        code = "";

        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }

    } while (rooms.has(code));

    return code;
}

function createGameState() {
    return {
        players: [],
        scores: {},
        currentRound: 0,
        activePlayerIndex: 0,
        started: false,
        hostId: null,
        statistics: {},
        previousWinner: null
    };
}

function emitRoomState(roomCode) {
    const room = rooms.get(roomCode);

    if (!room) return;

    io.to(roomCode).emit("game_state", room.state);
}

// ============================================================
// ANSLUTNING
// ============================================================

io.on("connection", (socket) => {

    console.log("Ny enhet ansluten:", socket.id);

    // --------------------------------------------------------
    // SKAPA RUM
    // --------------------------------------------------------

    socket.on("create_room", () => {

        const roomCode = createRoomCode();

        const state = createGameState();

        state.hostId = socket.id;

        rooms.set(roomCode, {
            state,
            sockets: new Set([socket.id])
        });

        socket.join(roomCode);

        socket.data.roomCode = roomCode;

        console.log("Nytt rum:", roomCode);
        console.log("Protokollförare:", socket.id);

        socket.emit("room_created", {
            roomCode,
            state
        });
    });

    // --------------------------------------------------------
    // GÅ MED I RUM
    // --------------------------------------------------------

    socket.on("join_room", (rawCode) => {

        const roomCode = String(rawCode || "")
            .trim()
            .toUpperCase();

        const room = rooms.get(roomCode);

        if (!room) {
            socket.emit("room_error", "Rummet finns inte.");
            return;
        }

        // Lämna eventuellt tidigare rum
        if (socket.data.roomCode) {
            socket.leave(socket.data.roomCode);
        }

        room.sockets.add(socket.id);

        socket.join(roomCode);

        socket.data.roomCode = roomCode;

        console.log(
            "Enhet gick med i rum:",
            roomCode,
            socket.id
        );

        socket.emit("room_joined", {
            roomCode,
            state: room.state
        });

        emitRoomState(roomCode);
    });

    // --------------------------------------------------------
    // HÄMTA STATE
    // --------------------------------------------------------

    socket.on("get_state", () => {

        const roomCode = socket.data.roomCode;

        if (!roomCode) return;

        const room = rooms.get(roomCode);

        if (!room) return;

        socket.emit("game_state", room.state);
    });

    // --------------------------------------------------------
    // UPPDATERA SPEL
    // --------------------------------------------------------

    socket.on("update_state", (state) => {

        const roomCode = socket.data.roomCode;

        if (!roomCode) {
            console.log("Enhet utan rum försökte uppdatera.");
            return;
        }

        const room = rooms.get(roomCode);

        if (!room) return;

        // Endast protokollföraren i DETTA rum får ändra spelet
        if (socket.id !== room.state.hostId) {

            console.log(
                "Ej protokollförare försökte uppdatera rum:",
                roomCode
            );

            return;
        }

        room.state = {
            ...room.state,
            ...state,
            hostId: room.state.hostId
        };

        emitRoomState(roomCode);

        console.log(
            "Game state uppdaterad i rum:",
            roomCode
        );
    });

    // --------------------------------------------------------
    // FRÅGA EFTER RUM
    // --------------------------------------------------------

    socket.on("get_room_state", () => {

        const roomCode = socket.data.roomCode;

        if (!roomCode) return;

        const room = rooms.get(roomCode);

        if (!room) return;

        socket.emit("game_state", room.state);
    });

    // --------------------------------------------------------
    // KOPPLA FRÅN
    // --------------------------------------------------------

    socket.on("disconnect", () => {

        const roomCode = socket.data.roomCode;

        console.log(
            "Enhet frånkopplad:",
            socket.id,
            roomCode || "(inget rum)"
        );

        if (!roomCode) return;

        const room = rooms.get(roomCode);

        if (!room) return;

        room.sockets.delete(socket.id);

        // Om protokollföraren lämnar:
        // utse en annan ansluten enhet i samma rum.
        if (socket.id === room.state.hostId) {

            room.state.hostId = null;

            for (const id of room.sockets) {

                room.state.hostId = id;

                console.log(
                    "Ny protokollförare i rum:",
                    roomCode,
                    id
                );

                break;
            }
        }

        // Om ingen längre finns kvar i rummet
        if (room.sockets.size === 0) {

            rooms.delete(roomCode);

            console.log(
                "Tomt rum borttaget:",
                roomCode
            );

            return;
        }

        emitRoomState(roomCode);
    });
});

// ============================================================
// START
// ============================================================

if (require.main === module) {

    server.listen(PORT, () => {

        console.log("");
        console.log("======================================");
        console.log("       CHICAGO RUMSSERVER V2");
        console.log("======================================");
        console.log("");
        console.log(`Server: http://localhost:${PORT}`);
        console.log("");
        console.log("Separata rum är aktiverade.");
        console.log("Varje rum har egen spelstatus.");
        console.log("");
    });
}

module.exports = app;



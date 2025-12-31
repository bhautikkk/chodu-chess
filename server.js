const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, '/')));

// Room State Management
const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Create Room
    socket.on('create_room', ({ color }) => {
        // Generate a 6-digit room code
        let roomCode;
        do {
            roomCode = Math.floor(100000 + Math.random() * 900000).toString();
        } while (rooms[roomCode]);

        rooms[roomCode] = {
            players: [
                { id: socket.id, color: color } // Creator gets their chosen color
            ],
            turn: 'white' // Standard chess start
        };

        socket.join(roomCode);
        socket.emit('room_created', { roomCode });
        console.log(`Room ${roomCode} created by ${socket.id} as ${color}`);
    });

    // Join Room
    socket.on('join_room', ({ roomCode }) => {
        const room = rooms[roomCode];

        if (!room) {
            socket.emit('error_message', 'Invalid Room Code');
            return;
        }

        if (room.players.length >= 2) {
            socket.emit('error_message', 'Room is full');
            return;
        }

        // Determine joining player's color (opposite of creator)
        const creatorColor = room.players[0].color;
        const joinerColor = creatorColor === 'white' ? 'black' : 'white';

        room.players.push({ id: socket.id, color: joinerColor });
        socket.join(roomCode);

        // Notify both players to start
        io.to(roomCode).emit('start_game', {
            roomCode: roomCode,
            players: [
                { id: room.players[0].id, color: room.players[0].color },
                { id: socket.id, color: joinerColor }
            ]
        });

        console.log(`User ${socket.id} joined room ${roomCode} as ${joinerColor}`);
    });

    // Handle Moves
    socket.on('move', ({ roomCode, move }) => {
        // Broadcast move to the OTHER player in the room
        socket.to(roomCode).emit('move', move);
    });

    // Optional: Handle Disconnect
    socket.on('disconnect', () => {
        // Find which room user was in and notify/close
        for (const [code, room] of Object.entries(rooms)) {
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                // Remove player or close room
                io.to(code).emit('opponent_disconnected');
                delete rooms[code];
                break;
            }
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

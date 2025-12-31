// Initialize the chess game engine (using chess.js)
const game = new Chess();
let boardElement = document.getElementById('board');
let statusElement = document.getElementById('status');
let selectedSquare = null;
let orientation = 'white'; // 'white' or 'black'
let stockfish = null;
let gameMode = 'friend'; // 'friend', 'computer', 'online'
let playerColor = 'white'; // For computer/online mode
let isComputerThinking = false;
let roomCode = null;
let socket = null;

const moveSound = new Audio('move.mp3');
const takeSound = new Audio('take.mp3');

// Initialize the application
function initApp() {
    setupEventListeners();
    initStockfish();

    // Initialize Socket
    if (typeof io !== 'undefined') {
        socket = io();
        setupSocketListeners();
    } else {
        console.warn('Socket.io not found. Online play disabled.');
        document.getElementById('createRoomBtn').disabled = true;
        document.getElementById('joinRoomBtn').disabled = true;
    }
}

function setupSocketListeners() {
    socket.on('room_created', (data) => {
        roomCode = data.roomCode;
        document.getElementById('displayRoomCode').innerText = roomCode;
        // Show Waiting Modal
        document.getElementById('colorModal').style.display = 'none';
        document.getElementById('waitingModal').style.display = 'flex';
    });

    socket.on('start_game', (data) => {
        // Find my color from the players list
        const myData = data.players.find(p => p.id === socket.id);
        if (myData) {
            playerColor = myData.color;
            setGameMode('online');
            roomCode = data.roomCode;

            // Hide all modals
            document.querySelectorAll('.menu-overlay').forEach(el => el.style.display = 'none');

            // Start Game
            startGame();
            console.log(`Game started. Room: ${roomCode}, Playing as: ${playerColor}`);
        }
    });

    socket.on('move', (move) => {
        if (gameMode === 'online') {
            const result = game.move(move);
            if (result) {
                onMoveMade(result, true); // true = remote move (don't re-emit)
            }
        }
    });

    socket.on('opponent_disconnected', () => {
        alert('Opponent disconnected.');
        resetToMenu();
    });

    socket.on('error_message', (msg) => {
        alert(msg);
    });
}

function setupEventListeners() {
    // Menu Buttons
    document.getElementById('createRoomBtn').addEventListener('click', () => {
        // Open Color Selection, but for Creating Room
        document.getElementById('mainMenu').style.display = 'none';
        document.getElementById('colorModal').style.display = 'flex';
        // We'll attach specific listeners dynamically or just check a flag?
        // Let's use a flag or distinct buttons? 
        // We reused the Color Modal. Use a temporary state or just check which button triggered it?
        // Simplest: Set a 'pendingMode' variable
        window.pendingAction = 'create_room';
    });

    document.getElementById('joinRoomBtn').addEventListener('click', () => {
        document.getElementById('mainMenu').style.display = 'none';
        document.getElementById('joinModal').style.display = 'flex';
    });

    document.getElementById('playComputerBtn').addEventListener('click', () => {
        document.getElementById('mainMenu').style.display = 'none';
        document.getElementById('colorModal').style.display = 'flex';
        window.pendingAction = 'vs_computer';
    });

    // Color Selection Buttons
    document.getElementById('playWhiteBtn').addEventListener('click', () => handleColorSelection('white'));
    document.getElementById('playBlackBtn').addEventListener('click', () => handleColorSelection('black'));

    // Join Modal Buttons
    document.getElementById('confirmJoinBtn').addEventListener('click', () => {
        const code = document.getElementById('roomCodeInput').value;
        if (code.length === 6) {
            socket.emit('join_room', { roomCode: code });
        } else {
            alert('Please enter a valid 6-digit code.');
        }
    });

    document.getElementById('joinBackBtn').addEventListener('click', () => {
        document.getElementById('joinModal').style.display = 'none';
        document.getElementById('mainMenu').style.display = 'flex';
    });

    document.getElementById('backBtn').addEventListener('click', () => {
        document.getElementById('colorModal').style.display = 'none';
        document.getElementById('mainMenu').style.display = 'flex';
    });

    // Waiting Modal Cancel
    document.getElementById('cancelRoomBtn').addEventListener('click', () => {
        // Should probably emit a 'leave_room' event, but for now just reload or reset UI
        location.reload();
    });

    // Game Controls
    document.getElementById('resetBtn').addEventListener('click', () => {
        // In online mode, reset might be tricky. For now, disable or request rematch?
        // Let's just allow local reset for now, but it might desync. 
        // For 'friend' and 'computer' it's fine.
        if (gameMode === 'online') {
            alert('Cannot reset online game yet.');
            return;
        }

        game.reset();
        selectedSquare = null;
        isComputerThinking = false;

        if (gameMode === 'computer') {
            orientation = playerColor;
            if (playerColor === 'black') {
                makeComputerMove();
            }
        } else {
            orientation = 'white';
        }

        renderBoard();
        updateStatus();
    });

    document.getElementById('flipBtn').addEventListener('click', () => {
        orientation = orientation === 'white' ? 'black' : 'white';
        renderBoard();
    });

    document.getElementById('menuBtn').addEventListener('click', () => {
        // If online, maybe warn?
        if (gameMode === 'online') {
            if (!confirm("Leave game?")) return;
            location.reload(); // Hard reset for online to clean up
            return;
        }
        resetToMenu();
    });
}

function handleColorSelection(color) {
    if (window.pendingAction === 'create_room') {
        socket.emit('create_room', { color: color });
        // Don't start game yet, wait for room_created
    } else if (window.pendingAction === 'vs_computer') {
        setGameMode('computer');
        playerColor = color;
        startGame();
    }
}

function setGameMode(mode) {
    gameMode = mode;
}

function resetToMenu() {
    document.querySelector('.game-container').style.display = 'none';
    document.getElementById('mainMenu').style.display = 'flex';
    game.reset();
}

function startGame() {
    // Hide menus
    document.querySelectorAll('.menu-overlay').forEach(el => el.style.display = 'none');

    // Show game
    document.querySelector('.game-container').style.display = 'flex';

    // Reset/Setup Game (Only reset logic if not online or if starting fresh)
    if (gameMode !== 'online') {
        game.reset();
    }
    // If online, game state matches start (empty)

    selectedSquare = null;
    isComputerThinking = false;

    if (gameMode === 'computer') {
        orientation = playerColor;
        // If player chose black, computer (white) moves first
        if (playerColor === 'black') {
            setTimeout(makeComputerMove, 500);
        }
    } else if (gameMode === 'online') {
        orientation = playerColor; // My color
        // White moves first, handled by game logic (wait for opponent if I am black)
    } else {
        orientation = 'white';
    }

    renderBoard();
    updateStatus();
}

// Initialize Stockfish
function initStockfish() {
    fetch('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.0/stockfish.js')
        .then(response => response.text())
        .then(code => {
            const blob = new Blob([code], { type: 'application/javascript' });
            stockfish = new Worker(URL.createObjectURL(blob));

            stockfish.onmessage = function (event) {
                const message = event.data;
                if (message.startsWith('bestmove')) {
                    const move = message.split(' ')[1];
                    if (move) {
                        const moveResult = game.move({
                            from: move.substring(0, 2),
                            to: move.substring(2, 4),
                            promotion: move.length > 4 ? move[4] : 'q'
                        });
                        isComputerThinking = false;
                        onMoveMade(moveResult);
                    }
                }
            };
            stockfish.postMessage('uci');
            stockfish.postMessage('ucinewgame');
        });
}

function makeComputerMove() {
    if (!stockfish || game.game_over()) return;
    isComputerThinking = true;
    updateStatus();
    stockfish.postMessage('position fen ' + game.fen());
    stockfish.postMessage('go depth 10');
}


// Render the 8x8 board
function renderBoard() {
    boardElement.innerHTML = '';
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];

    // If orientation is black, reverse ranks and files for rendering
    let displayRanks = orientation === 'white' ? ranks : [...ranks].reverse();
    let displayFiles = orientation === 'white' ? files : [...files].reverse();

    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const squareId = displayFiles[f] + displayRanks[r];
            const square = document.createElement('div');
            square.className = `square ${(r + f) % 2 === 0 ? 'light' : 'dark'}`;
            square.dataset.square = squareId;

            // Highlight selected square
            if (selectedSquare === squareId) {
                square.classList.add('selected');
            }

            // Highlight last move
            const history = game.history({ verbose: true });
            if (history.length > 0) {
                const lastMove = history[history.length - 1];
                if (lastMove.from === squareId || lastMove.to === squareId) {
                    square.classList.add('last-move');
                }
            }

            // Check if there's a piece
            const piece = game.get(squareId);
            if (piece) {
                const pieceElement = document.createElement('div');
                pieceElement.className = `piece ${piece.color}${piece.type.toUpperCase()}`;
                square.appendChild(pieceElement);
            }

            // Add coordinates (Lichess Style)
            if (f === 0) addCoordinate(square, displayRanks[r], 'rank');
            if (r === 7) addCoordinate(square, displayFiles[f], 'file');

            // Visualization of valid moves for selected piece
            if (selectedSquare) {
                const moves = game.moves({ square: selectedSquare, verbose: true });
                const move = moves.find(m => m.to === squareId);
                if (move) {
                    const hint = document.createElement('div');
                    hint.className = 'hint';
                    if (move.flags.includes('c') || move.flags.includes('e')) {
                        hint.classList.add('capture-hint');
                    }
                    square.appendChild(hint);
                }
            }

            // Click listener
            square.addEventListener('click', (e) => onSquareClick(squareId));

            boardElement.appendChild(square);
        }
    }
}

function addCoordinate(parent, text, type) {
    const el = document.createElement('span');
    el.className = `coordinate ${type}`;
    el.innerText = text;
    parent.appendChild(el);
}

function onMoveMade(move, isRemote = false) {
    renderBoard();
    updateStatus();

    // Sound Logic
    if (game.in_check() || game.in_checkmate() || (move && (move.flags.includes('c') || move.flags.includes('e')))) {
        takeSound.currentTime = 0;
        takeSound.play().catch(e => console.warn("Sound blocked", e));
    } else {
        moveSound.currentTime = 0;
        moveSound.play().catch(e => console.warn("Sound blocked", e));
    }

    // If I made the move in online mode, emit it
    if (gameMode === 'online' && !isRemote) {
        // Send the move to server
        // We send the move string or object. game.move() accepted object, let's send object or SAN?
        // Server relays 'move' event.
        // We should send standard LAN or object.
        socket.emit('move', { roomCode: roomCode, move: { from: move.from, to: move.to, promotion: move.promotion } });
    }

    // Trigger Computer Response
    if (gameMode === 'computer' && !game.game_over()) {
        const playerColorShort = playerColor === 'white' ? 'w' : 'b';
        if (game.turn() !== playerColorShort) {
            setTimeout(makeComputerMove, 250);
        }
    }
}

function onSquareClick(squareId) {
    // General restrictions
    if (gameMode === 'computer' && isComputerThinking) return;
    if (gameMode === 'computer' && game.turn() !== playerColor[0]) return;

    // Online restrictions
    if (gameMode === 'online') {
        // Can only move if it's my turn
        if (game.turn() !== playerColor[0]) return;
    }

    // If we click the same square, unselect
    if (selectedSquare === squareId) {
        selectedSquare = null;
        renderBoard();
        return;
    }

    const piece = game.get(squareId);

    // If we have a selected square, try to move
    if (selectedSquare) {
        const move = game.move({
            from: selectedSquare,
            to: squareId,
            promotion: 'q'
        });

        if (move) {
            selectedSquare = null;
            onMoveMade(move); // Default isRemote = false
            return;
        }
    }

    // If no move occurred (or invalid), and checking a piece of current turn
    const turnColor = game.turn();
    if (piece && piece.color === turnColor) {
        // Enforce player can only select their own pieces vs computer/online
        const myColorShort = playerColor === 'white' ? 'w' : 'b';
        // Vs Computer: verified above.
        // Vs Online: verified above by turn check, AND must be my piece
        if (gameMode === 'online' && piece.color !== myColorShort) return;
        if (gameMode === 'computer' && piece.color !== myColorShort) return;

        selectedSquare = squareId;
        renderBoard();
    } else {
        selectedSquare = null;
        renderBoard();
    }
}

function updateStatus() {
    let status = '';

    let moveColor = game.turn() === 'b' ? 'Black' : 'White';

    if (game.in_checkmate()) {
        status = `Game over, ${moveColor} is in checkmate.`;
    } else if (game.in_draw()) {
        status = 'Game over, drawn position';
    } else {
        if (gameMode === 'computer') {
            if (isComputerThinking) {
                status = "Computer is thinking...";
            } else {
                status = "Your Turn";
            }
        } else if (gameMode === 'online') {
            if (game.turn() === playerColor[0]) {
                status = "Your Turn";
            } else {
                status = "Opponent's Turn";
            }
        } else {
            status = `${moveColor}'s turn`;
        }

        if (game.in_check()) {
            status += ', ' + moveColor + ' is in check';
        }
    }

    statusElement.innerText = status;
}

// Start
initApp();

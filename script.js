
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
let historyStep = -1; // -1 = Live, 0-N = History state (N is number of moves played)

const moveSound = new Audio('move.mp3');
const takeSound = new Audio('take.mp3');

// Initialize the application
function initApp() {
    setupEventListeners();
    initStockfish();

    // Initialize Socket
    if (typeof io !== 'undefined') {
        // Force Websocket to prevent polling disconnection issues on Render
        socket = io({
            transports: ['websocket']
        });
        setupSocketListeners();
    } else {
        console.warn('Socket.io not found. Online play disabled.');
        document.getElementById('createRoomBtn').disabled = true;
        document.getElementById('joinRoomBtn').disabled = true;
    }
}

function navigateHistory(offset) {
    const totalMoves = game.history().length;
    if (historyStep === -1) historyStep = totalMoves; // If live, start from the end

    historyStep += offset;

    if (historyStep < 0) historyStep = 0; // Clamp at start
    if (historyStep > totalMoves) historyStep = totalMoves; // Clamp at end

    // If we navigate to the end, go back to live mode
    if (historyStep === totalMoves) {
        historyStep = -1;
    }

    renderCurrentView();
}

function renderCurrentView() {
    if (historyStep === -1) {
        renderBoard(game); // Render the live game
        updateStatus();
    } else {
        const tempGame = new Chess();
        const history = game.history();
        for (let i = 0; i < historyStep; i++) {
            tempGame.move(history[i]);
        }
        renderBoard(tempGame); // Render the game at a specific history step
        statusElement.innerText = `Reviewing Move ${historyStep} / ${history.length}`;
    }

    // Update Eval Bar if in Review Mode
    if (reviewMode) {
        // historyStep = -1 means end of game (last move index is history.length)
        const idx = historyStep === -1 ? game.history().length : historyStep;
        updateEvalBar(idx);
        updateCoach(idx);
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
        document.getElementById('disconnectModal').style.display = 'flex';
    });

    socket.on('error_message', (msg) => {
        alert(msg);
    });
}

function setupEventListeners() {
    // History Navigation
    document.getElementById('prevBtn').addEventListener('click', () => navigateHistory(-1));
    document.getElementById('nextBtn').addEventListener('click', () => navigateHistory(1));

    // Menu Buttons
    document.getElementById('createRoomBtn').addEventListener('click', () => {
        // Open Color Selection, but for Creating Room
        document.getElementById('mainMenu').style.display = 'none';
        document.getElementById('colorModal').style.display = 'flex';
        document.getElementById('engineLevelContainer').style.display = 'none';
        window.pendingAction = 'create_room';
    });

    document.getElementById('joinRoomBtn').addEventListener('click', () => {
        document.getElementById('mainMenu').style.display = 'none';
        document.getElementById('joinModal').style.display = 'flex';
    });

    document.getElementById('playComputerBtn').addEventListener('click', () => {
        document.getElementById('mainMenu').style.display = 'none';
        document.getElementById('colorModal').style.display = 'flex';
        const elContainer = document.getElementById('engineLevelContainer');
        elContainer.style.display = 'block';

        // Init Slider Background
        const eloInput = document.getElementById('eloInput');
        updateSliderBackground(eloInput.value);

        window.pendingAction = 'vs_computer';
    });

    // Engine Slider Logic
    const eloInput = document.getElementById('eloInput');
    const eloDisplay = document.getElementById('eloDisplay');

    function updateSliderBackground(val) {
        const min = 400;
        const max = 3200;
        const percentage = ((val - min) / (max - min)) * 100;
        // Use Blue (#3692e7) which matches the buttons
        eloInput.style.background = `linear-gradient(to right, #3692e7 0%, #3692e7 ${percentage}%, #3a3a3a ${percentage}%, #3a3a3a 100%)`;
    }

    eloInput.addEventListener('input', (e) => {
        const val = e.target.value;
        eloDisplay.innerText = val;
        updateSliderBackground(val);
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

    document.getElementById('disconnectMenuBtn').addEventListener('click', () => {
        document.getElementById('disconnectModal').style.display = 'none';
        resetToMenu();
    });

    // Game Review Listeners
    document.getElementById('gameReviewBtn').addEventListener('click', () => startReview());
    document.getElementById('modalReviewBtn').addEventListener('click', () => {
        document.getElementById('gameOverModal').style.display = 'none';
        startReview();
    });
    document.getElementById('closeReviewBtn').addEventListener('click', () => closeReview());

    // PGN Import Listeners
    document.getElementById('importPgnBtn').addEventListener('click', () => {
        document.getElementById('mainMenu').style.display = 'none';
        document.getElementById('pgnModal').style.display = 'flex';
    });

    document.getElementById('cancelPgnBtn').addEventListener('click', () => {
        document.getElementById('pgnModal').style.display = 'none';
        document.getElementById('mainMenu').style.display = 'flex';
    });

    document.getElementById('loadPgnBtn').addEventListener('click', () => {
        const pgnText = document.getElementById('pgnInput').value;
        if (!pgnText.trim()) return;

        loadPgnAndReview(pgnText);
    });

    // Tabs
    document.getElementById('tabSummary').addEventListener('click', () => switchTab('summary'));
    document.getElementById('tabMoves').addEventListener('click', () => switchTab('moves'));
}

function loadPgnAndReview(pgn) {
    // Reset Game
    game.reset();

    // Attempt Load
    const result = game.load_pgn(pgn);
    if (!result) {
        alert("Invalid PGN. Please check formatting.");
        return;
    }

    // If valid
    gameMode = 'review';
    isComputerThinking = false;
    orientation = 'white'; // or parse from PGN headers? Default white.

    // Hide Modals
    document.getElementById('pgnModal').style.display = 'none';
    document.getElementById('mainMenu').style.display = 'none'; // Ensure hidden

    // Show Board
    document.getElementById('gameArea').style.display = 'flex';

    renderBoard();
    updateStatus();

    // Start Analysis
    startReview();
}


function switchTab(tab) {
    if (tab === 'summary') {
        document.getElementById('viewSummary').style.display = 'flex';
        document.getElementById('viewMoves').style.display = 'none';
        document.getElementById('tabSummary').classList.add('active');
        document.getElementById('tabMoves').classList.remove('active');
    } else {
        document.getElementById('viewSummary').style.display = 'none';
        document.getElementById('viewMoves').style.display = 'flex';
        document.getElementById('tabSummary').classList.remove('active');
        document.getElementById('tabMoves').classList.add('active');
    }
}

/* Game Review / Analysis Logic */
let reviewMode = false;
let reviewGame = null; // Separate Chess instance for review
let reviewMoves = [];
let analysisResults = [];
let analysisQueue = [];
let isAnalyzing = false;
let moveStats = {
    w: {}, b: {}
}; // Stores counts

function startReview() {
    reviewMode = true;
    switchTab('moves'); // Start with moves or summary? Let's show Summary as loading? No, moves is better for progress.

    // Show UI
    document.getElementById('reviewPanel').style.display = 'flex';
    document.getElementById('evalBarContainer').style.display = 'flex';
    document.getElementById('gameReviewBtn').style.display = 'none'; // Hide button while reviewing
    document.getElementById('mobileReviewControls').style.display = 'flex'; // Show mobile controls
    document.getElementById('moveList').innerHTML = '<div style="padding:10px; color:#888;">Starting Analysis...</div>';

    // Initialize Review State
    reviewGame = new Chess();
    // Replay current game history into reviewGame
    const history = game.history(); // Full game history

    // Copy moves to reviewGame
    history.forEach(move => reviewGame.move(move));

    reviewMoves = game.history({ verbose: true });
    analysisResults = new Array(reviewMoves.length + 1).fill(null); // +1 for start position

    // Set to start position
    historyStep = 0;
    renderCurrentView(); // Force render at start


    // Reset Stats
    moveStats = {
        w: { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, book: 0, brilliant: 0, great: 0 },
        b: { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, book: 0, brilliant: 0, great: 0 }
    };

    // Start Analysis Loop
    analyzeGame();
}

function closeReview() {
    reviewMode = false;
    document.getElementById('reviewPanel').style.display = 'none';
    document.getElementById('evalBarContainer').style.display = 'none';
    document.getElementById('mobileReviewControls').style.display = 'none';

    // If game is over, maybe show review button again?
    if (game.game_over() || game.history().length > 0) {
        document.getElementById('gameReviewBtn').style.display = 'inline-block';
    }
}

async function analyzeGame() {
    // 1. Get PGN/Moves
    // We will iterate through positions and use Stockfish
    // This needs to be async to not freeze UI

    // Reset Analysis Queue
    analysisQueue = [];

    // Add Start Position (FEN)
    const tempGame = new Chess();
    analysisQueue.push({ fen: tempGame.fen(), moveIndex: -1 });

    // Add all move positions
    for (let i = 0; i < reviewMoves.length; i++) {
        tempGame.move(reviewMoves[i]);

        // Check for terminal state
        let manualEval = null;
        if (tempGame.in_checkmate()) {
            // Who is checkmated? Side to move lost.
            // If turn is 'w', White lost -> Score is -M0 (Black wins)
            // If turn is 'b', Black lost -> Score is +M0 (White wins)
            const turn = tempGame.turn();
            // Store as Mate 0. 
            // Value convention: + means White winning. 
            // Mate 0 for white (white lost) -> -10000 (approx) or just handled as Mate type.
            // My updateEvalBar handles mate values: + means White wins.
            // If val is 0, it falls to else (Black wins).
            // If White wins (Black is mated, turn is b), value should be > 0.
            // So logic: turn === 'w' (White mated) -> val = -1 (White lost)
            // turn === 'b' (Black mated) -> val = 1 (White won)
            // But usually Mate is denoted as moves. Mate 0 is immediate.
            manualEval = { type: 'mate', value: turn === 'w' ? -1 : 1 }; // Use 1/-1 to signify mate side
        } else if (tempGame.in_draw()) {
            manualEval = { type: 'cp', value: 0 };
        }

        analysisQueue.push({
            fen: tempGame.fen(),
            moveIndex: i,
            move: reviewMoves[i],
            manualEval: manualEval
        });
    }

    processAnalysisQueue();
}

function processAnalysisQueue() {
    if (analysisQueue.length === 0) {
        // Analysis Complete
        renderMoveList();
        return;
    }

    const item = analysisQueue.shift();

    // Update Progress UI immediately when we start an item
    const total = reviewMoves.length + 1;
    const current = item.moveIndex + 2;
    document.getElementById('moveList').innerHTML = `<div style="padding:10px; color:#888;">Analyzing... ${Math.round((current / total) * 100)}%</div>`;

    if (item.manualEval) {
        // Skip Engine
        analysisResults[item.moveIndex + 1] = item.manualEval;
        // Proceed to next immediately (use setTimeout to prevent stack overflow on large games)
        setTimeout(processAnalysisQueue, 10);
        return;
    }

    isAnalyzing = true;

    // Send to stockfish
    if (stockfish) {
        window.currentAnalysisItem = item;
        stockfish.postMessage('position fen ' + item.fen);
        stockfish.postMessage('go depth 12');
    } else {
        // Fallback if no stockfish?
        // Just skip
        setTimeout(processAnalysisQueue, 10);
    }
}

// NOTE: We need to update stockfish.onmessage to handle analysis
// We will do that in the next step by modifying initStockfish


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

    historyStep = -1;
    selectedSquare = null;
    isComputerThinking = false;

    if (gameMode === 'computer') {
        const elo = parseInt(document.getElementById('eloInput').value);
        configureEngine(elo);
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

                if (reviewMode) {
                    handleAnalysisMessage(message);
                } else {
                    // Normal Game Logic
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
                }
            };
            stockfish.postMessage('uci');
            stockfish.postMessage('ucinewgame');
        });
}

function handleAnalysisMessage(message) {
    // Parse "info" lines for score
    if (message.startsWith('info') && message.includes('score')) {
        // Example: info depth 12 ... score cp 50 ...
        const parts = message.split(' ');
        let scoreIndex = parts.indexOf('score');
        if (scoreIndex !== -1) {
            let type = parts[scoreIndex + 1]; // "cp" or "mate"
            let val = parseInt(parts[scoreIndex + 2]);

            // Store this info temporarily for the current item
            if (window.currentAnalysisItem) {
                // Adjust score for side to move? 
                // Stockfish gives score from side to move's perspective usually?
                // Actually stockfish.js usually gives it for white? No, it's side to move.
                // We need to normalize to White's perspective for consistent Eval Bar.

                // Wait, UCI standard says score is from engine's point of view (side to move).
                // So if it's Black's turn and score is +100, Black is winning (from Black's POV).
                // So +1.00 means Black has advantage.
                // But for the Eval Bar, usually + is White advantage, - is Black advantage.
                // So if Turn is Black, we negate the score.

                let turn = new Chess(window.currentAnalysisItem.fen).turn(); // 'w' or 'b'
                let normalizedScore = val;

                if (type === 'cp') {
                    if (turn === 'b') normalizedScore = -normalizedScore;
                } else if (type === 'mate') {
                    // Mate matches side to move. Mate +1 means I win in 1.
                    if (turn === 'b') normalizedScore = -normalizedScore;
                }

                window.currentAnalysisItem.tempEval = { type, value: normalizedScore };
            }
        }
    }

    // Check for completion of current depth
    if (message.startsWith('bestmove')) {
        // Analysis for this move is done
        const parts = message.split(' ');
        const bestMove = parts[1];

        const item = window.currentAnalysisItem;
        if (item) {
            // Save result
            // we store { type, value, bestMove }
            const result = item.tempEval || { type: 'cp', value: 0 };
            result.bestMove = bestMove;

            analysisResults[item.moveIndex + 1] = result;

            // Update UI for progress
            const total = reviewMoves.length + 1;
            const current = item.moveIndex + 2; // +1 for index, +1 for correct counting
            document.getElementById('moveList').innerHTML = `<div style="padding:10px; color:#888;">Analyzing... ${Math.round((current / total) * 100)}%</div>`;

            // Analyze next
            processAnalysisQueue();
        }
    }
}

function makeComputerMove() {
    if (!stockfish || game.game_over()) return;
    isComputerThinking = true;
    updateStatus();
    stockfish.postMessage('position fen ' + game.fen());
    stockfish.postMessage('go depth 10');
}


// Render the 8x8 board
function renderBoard(displayGame = game) {
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
            // Assign light/dark class here
            square.className = `square ${(r + f) % 2 === 0 ? 'light' : 'dark'}`;
            square.dataset.square = squareId;

            // Highlight selected square
            if (selectedSquare === squareId) {
                square.classList.add('selected');
            }

            // Highlight last move
            const history = displayGame.history({ verbose: true });
            if (history.length > 0) {
                const lastMove = history[history.length - 1];
                if (lastMove.from === squareId || lastMove.to === squareId) {
                    square.classList.add('last-move');
                }
            }

            // Check if there's a piece
            const piece = displayGame.get(squareId);
            if (piece) {
                const pieceElement = document.createElement('div');
                pieceElement.className = `piece ${piece.color}${piece.type.toUpperCase()}`;
                square.appendChild(pieceElement);
            }

            // Add coordinates (Lichess Style)
            if (f === 0) addCoordinate(square, displayRanks[r], 'rank');
            if (r === 7) addCoordinate(square, displayFiles[f], 'file');

            // Visualization of valid moves for selected piece
            // ONLY show hints if we are viewing the LIVE game
            if (selectedSquare && displayGame === game) {
                const moves = displayGame.moves({ square: selectedSquare, verbose: true });
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
            // Only allow interaction if we are viewing the LIVE game
            if (displayGame === game) {
                square.addEventListener('click', (e) => onSquareClick(squareId));
            } else {
                square.style.cursor = 'default'; // Indicate no interaction
            }

            boardElement.appendChild(square);
        }
    }

    // visual check indication
    if (displayGame.in_check()) {
        const turn = displayGame.turn(); // 'w' or 'b'
        // Find King of current turn
        // board() returns 8x8 array.
        const board = displayGame.board();
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                const piece = board[r][f];
                if (piece && piece.type === 'k' && piece.color === turn) {
                    // Found the king in check
                    const rank = 8 - r;
                    const file = String.fromCharCode(97 + f); // 0->a
                    const squareId = file + rank;
                    const kingSquare = document.querySelector(`.square[data-square="${squareId}"]`);
                    if (kingSquare) kingSquare.classList.add('in-check');
                }
            }
        }
    }

    // Update Captured Pieces
    updateCapturedPieces(displayGame);
}

function addCoordinate(parent, text, type) {
    const el = document.createElement('span');
    el.className = `coordinate ${type}`;
    el.innerText = text;
    parent.appendChild(el);
}

function onMoveMade(move, isRemote = false) {
    historyStep = -1; // Always jump to live view on new move
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
        let winner = game.turn() === 'b' ? 'White' : 'Black';
        showGameOverModal(`${winner} won by checkmate.`);
        // Status text can remain empty or say Game Over
        status = 'Game Over';
        document.getElementById('gameReviewBtn').style.display = 'inline-block';
    } else if (game.in_draw()) {
        showGameOverModal('Game drawn.');
        status = 'Game Over';
        document.getElementById('gameReviewBtn').style.display = 'inline-block';
    } else {
        if (gameMode === 'computer') {
            if (isComputerThinking) {
                status = "Opponent's Turn";
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

        // Removed Check text logic
    }

    statusElement.innerText = status;
}

function showGameOverModal(msg) {
    document.getElementById('gameOverTitle').innerText = 'Game Over';
    document.getElementById('gameOverMessage').innerText = msg;
    const modal = document.getElementById('gameOverModal');
    modal.style.display = 'flex';

    // Auto-hide after 2 seconds
    setTimeout(() => {
        modal.style.display = 'none';
    }, 2000);
}

// Start
initApp();

function updateCapturedPieces(displayGame) {
    const fullSet = {
        w: { p: 8, n: 2, b: 2, r: 2, q: 1 },
        b: { p: 8, n: 2, b: 2, r: 2, q: 1 }
    };
    const board = displayGame.board();
    const currentCounts = {
        w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
        b: { p: 0, n: 0, b: 0, r: 0, q: 0 }
    };

    // Count pieces
    board.flat().forEach(p => {
        if (p && p.type !== 'k') {
            currentCounts[p.color][p.type]++;
        }
    });

    // Calculate captured (Full - Current)
    // wCaptured = White pieces lost (captured by Black) -> Should be shown in Black's Info
    // bCaptured = Black pieces lost (captured by White) -> Should be shown in White's Info
    const wCaptured = [];
    const bCaptured = [];

    const order = ['p', 'n', 'b', 'r', 'q'];

    order.forEach(type => {
        const wLost = Math.max(0, fullSet.w[type] - currentCounts.w[type]);
        for (let i = 0; i < wLost; i++) wCaptured.push(type);

        const bLost = Math.max(0, fullSet.b[type] - currentCounts.b[type]);
        for (let i = 0; i < bLost; i++) bCaptured.push(type);
    });

    // Calculate Material Score Difference
    const values = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    let wMaterial = 0;
    let bMaterial = 0;

    board.flat().forEach(p => {
        if (p && p.type !== 'k') {
            if (p.color === 'w') wMaterial += values[p.type];
            else bMaterial += values[p.type];
        }
    });

    const diff = wMaterial - bMaterial; // +ve means White is winning

    // Orientation Logic
    // If orientation == 'white' (Me=White, Top=Black)
    // Top (Opponent/Black): Should show pieces Black captured (White's Lost Pieces = wCaptured)
    // Bottom (Me/White): Should show pieces White captured (Black's Lost Pieces = bCaptured)

    let topCapturedPieces, bottomCapturedPieces;

    if (orientation === 'white') {
        topCapturedPieces = wCaptured; // Opponent (Black) has captured these White pieces
        bottomCapturedPieces = bCaptured; // I (White) have captured these Black pieces
    } else {
        topCapturedPieces = bCaptured; // Opponent (White) has captured these Black pieces
        bottomCapturedPieces = wCaptured; // I (Black) have captured these White pieces
    }

    // Render
    const topCapturedEl = document.getElementById('topCaptured');
    const bottomCapturedEl = document.getElementById('bottomCaptured');
    const topScoreEl = document.getElementById('topScore');
    const bottomScoreEl = document.getElementById('bottomScore');

    const renderGrouped = (pieces, color) => {
        if (!pieces.length) return '';

        // Group by type: [['p','p'], ['n'], ...]
        const groups = [];
        let currentGroup = [];

        pieces.forEach((p, i) => {
            if (i === 0 || p === pieces[i - 1]) {
                currentGroup.push(p);
            } else {
                groups.push(currentGroup);
                currentGroup = [p];
            }
        });
        if (currentGroup.length) groups.push(currentGroup);

        return groups.map(group => {
            const type = group[0]; // All same in group
            const piecesHtml = group.map(() =>
                `<div class="mini-piece ${color}${type.toUpperCase()}"></div>`
            ).join('');
            return `<div class="captured-group">${piecesHtml}</div>`;
        }).join('');
    };

    if (topCapturedEl) {
        const topColor = topCapturedPieces === wCaptured ? 'w' : 'b';
        topCapturedEl.innerHTML = renderGrouped(topCapturedPieces, topColor);
    }

    if (bottomCapturedEl) {
        const bottomColor = bottomCapturedPieces === wCaptured ? 'w' : 'b';
        bottomCapturedEl.innerHTML = renderGrouped(bottomCapturedPieces, bottomColor);
    }

    // Score
    if (topScoreEl) topScoreEl.innerText = '';
    if (bottomScoreEl) bottomScoreEl.innerText = '';

    if (diff !== 0) {
        if (diff > 0) {
            // White leads
            if (orientation === 'white') bottomScoreEl.innerText = `+${diff}`; // Me (White)
            else topScoreEl.innerText = `+${diff}`; // Opponent (White)
        } else {
            // Black leads
            if (orientation === 'white') topScoreEl.innerText = `+${Math.abs(diff)}`; // Opponent (Black)
            else bottomScoreEl.innerText = `+${Math.abs(diff)}`; // Me (Black)
        }
    }
}

/* Analysis Rendering & Classification */
function renderMoveList() {
    const list = document.getElementById('moveList');
    list.innerHTML = '';

    // Reset Stats for re-calc
    moveStats = {
        w: { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, book: 0, brilliant: 0, great: 0 },
        b: { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, book: 0, brilliant: 0, great: 0 }
    };

    let whiteAccTotal = 0;
    let blackAccTotal = 0;
    let whiteMoves = 0;
    let blackMoves = 0;

    // We start from move 0 (index 0 implies Result 1 vs Result 0)

    reviewMoves.forEach((move, i) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'move-item';

        // Move Number
        const moveNum = Math.floor(i / 2) + 1;
        const isWhite = (i % 2 === 0);

        if (isWhite) {
            const numSpan = document.createElement('span');
            numSpan.className = 'move-number';
            numSpan.innerText = moveNum + '.';
            itemDiv.appendChild(numSpan);
        } else {
            const spacer = document.createElement('span');
            spacer.className = 'move-number';
            itemDiv.appendChild(spacer);
        }

        // SAN
        const sanSpan = document.createElement('span');
        sanSpan.className = 'move-san';
        sanSpan.innerText = move.san;
        itemDiv.appendChild(sanSpan);

        // Evaluation & Classification
        const prevEval = analysisResults[i];
        const currEval = analysisResults[i + 1];

        let classification = '';
        let classClass = '';
        let evalText = '';
        let iconChar = '';

        if (prevEval && currEval) {
            // ... (Centipawn Logic same as before)
            let pVal = prevEval.value;
            let cVal = currEval.value;

            // Handle Mate Scores
            if (prevEval.type === 'mate') pVal = pVal > 0 ? 10000 - pVal : -10000 - pVal;
            if (currEval.type === 'mate') cVal = cVal > 0 ? 10000 - cVal : -10000 - cVal;

            let loss = 0;
            if (isWhite) {
                loss = pVal - cVal;
            } else {
                loss = cVal - pVal;
            }

            // Refined Classification
            // < 0 loss means we improved position? Or engine depth fluctuation. Treat as Best.
            if (loss <= 0) loss = 0;

            let typeKey = '';

            // Opening Book logic? if move < 10 and loss is 0? 
            // Simple thresholds
            if (loss <= 10) {
                classification = 'Best'; classClass = 'class-best'; typeKey = 'best'; iconChar = '★';
            } else if (loss <= 30) {
                classification = 'Excellent'; classClass = 'class-good'; typeKey = 'excellent'; iconChar = '👍';
            } else if (loss <= 70) {
                classification = 'Good'; classClass = 'class-good'; typeKey = 'good'; iconChar = '✓';
            } else if (loss <= 130) {
                classification = 'Inaccuracy'; classClass = 'class-inaccuracy'; typeKey = 'inaccuracy'; iconChar = '?!';
            } else if (loss <= 300) {
                classification = 'Mistake'; classClass = 'class-mistake'; typeKey = 'mistake'; iconChar = '?';
            } else {
                classification = 'Blunder'; classClass = 'class-blunder'; typeKey = 'blunder'; iconChar = '??';
            }

            // Check for Mate Miss? Not implementing sophisticated Miss yet.

            // Update Stats
            if (isWhite) moveStats.w[typeKey]++;
            else moveStats.b[typeKey]++;

            // Accuracy
            // Formula: Win% Loss.
            // Simple: 100 - (Loss/3)
            let moveAcc = Math.max(0, 100 - (loss > 0 ? loss / 2 : 0)); // Slightly stricter
            if (isWhite) { whiteAccTotal += moveAcc; whiteMoves++; }
            else { blackAccTotal += moveAcc; blackMoves++; }

            // UI Text
            if (currEval.type === 'mate') {
                evalText = `M${Math.abs(currEval.value)}`;
            } else {
                evalText = (currEval.value / 100).toFixed(1);
            }
        }

        const evalSpan = document.createElement('span');
        evalSpan.className = 'move-eval';
        evalSpan.innerText = evalText;
        itemDiv.appendChild(evalSpan);

        const classSpan = document.createElement('span');
        classSpan.className = `move-classification ${classClass}`;
        classSpan.innerText = classification; // Text only
        // Add icon? 
        // Let's add icon to stats only, or small icon here?
        // User asked for table stats separately.

        itemDiv.appendChild(classSpan);

        itemDiv.addEventListener('click', () => {
            historyStep = i + 1;
            renderCurrentView();
            updateEvalBar(i + 1);
            document.querySelectorAll('.move-item').forEach(el => el.classList.remove('active'));
            itemDiv.classList.add('active');
        });

        list.appendChild(itemDiv);
    });

    // Update Accuracy Global
    const wAcc = whiteMoves ? Math.round(whiteAccTotal / whiteMoves) : 0;
    const bAcc = blackMoves ? Math.round(blackAccTotal / blackMoves) : 0;

    document.getElementById('sumWhiteAcc').innerText = wAcc.toFixed(1);
    document.getElementById('sumBlackAcc').innerText = bAcc.toFixed(1);

    // Render Stats Table
    renderReviewSummary();

    // Show first move eval
    if (analysisResults.length > 0) {
        let idx = historyStep === -1 ? reviewMoves.length : historyStep;
        updateEvalBar(idx);
        updateCoach(idx);
    }
}

function renderReviewSummary() {
    const table = document.getElementById('statsTable');
    table.innerHTML = '';

    // Categories to show
    const categories = [
        { key: 'brilliant', label: 'Brilliant', icon: '!!', color: 'icon-brilliant' },
        { key: 'great', label: 'Great', icon: '!', color: 'icon-great' },
        { key: 'best', label: 'Best', icon: '★', color: 'icon-best' },
        { key: 'excellent', label: 'Excellent', icon: '👍', color: 'icon-excellent' },
        { key: 'good', label: 'Good', icon: '✓', color: 'icon-good' },
        { key: 'book', label: 'Book', icon: '📖', color: 'icon-book' },
        { key: 'inaccuracy', label: 'Inaccuracy', icon: '?!', color: 'icon-inaccuracy' },
        { key: 'mistake', label: 'Mistake', icon: '?', color: 'icon-mistake' },
        { key: 'blunder', label: 'Blunder', icon: '??', color: 'icon-blunder' }
    ];

    // Header
    const header = document.createElement('div');
    header.className = 'stat-row';
    header.innerHTML = `
        <div style="width:24px;margin-right:10px;"></div>
        <div class="stat-label"></div>
        <div class="stat-count" style="color:#aaa;">W</div>
        <div class="stat-count" style="color:#aaa;">B</div>
    `;
    table.appendChild(header);

    categories.forEach(cat => {
        const wCount = moveStats.w[cat.key] || 0;
        const bCount = moveStats.b[cat.key] || 0;

        const row = document.createElement('div');
        row.className = 'stat-row';
        row.innerHTML = `
             <div class="stat-icon ${cat.color}">${cat.icon}</div>
             <div class="stat-label">${cat.label}</div>
             <div class="stat-count ${wCount > 0 ? 'has-val' : ''}">${wCount}</div>
             <div class="stat-count ${bCount > 0 ? 'has-val' : ''}">${bCount}</div>
        `;
        table.appendChild(row);
    });
}


function updateCoach(moveIndex) {
    const container = document.getElementById('coachContainer');
    if (!reviewMode) {
        container.style.display = 'none';
        return;
    }

    // Show Coach
    container.style.display = 'flex';

    // Bounds check
    if (moveIndex < 0) moveIndex = 0;
    if (moveIndex > reviewMoves.length) moveIndex = reviewMoves.length;

    // If start position
    if (moveIndex === 0) {
        document.getElementById('coachTitle').innerText = 'Coach';
        document.getElementById('coachEval').innerText = '0.0';
        document.getElementById('coachMessage').innerText = "Ready to analyze? Let's go!";
        clearArrows();
        return;
    }

    // Get Move and Analysis
    const move = reviewMoves[moveIndex - 1]; // 0-indexed array vs 1-based moveIndex
    const analysis = analysisResults[moveIndex]; // Result AFTER move

    // Identify Move Classification (We need to re-calc or store it? Re-calc for now simplicity)
    // We can look at moveStats if we stored per move? Just re-calc basic class
    const prevEval = analysisResults[moveIndex - 1];
    let classification = 'Normal';
    if (prevEval && analysis) {
        let pVal = prevEval.value;
        let cVal = analysis.value;
        if (prevEval.type === 'mate') pVal = pVal > 0 ? 10000 - pVal : -10000 - pVal;
        if (analysis.type === 'mate') cVal = cVal > 0 ? 10000 - cVal : -10000 - cVal;

        let loss = 0;
        const isWhite = (moveIndex - 1) % 2 === 0;
        if (isWhite) loss = pVal - cVal;
        else loss = cVal - pVal;
        if (loss < 0) loss = 0;

        if (loss <= 10) classification = 'Best';
        else if (loss <= 30) classification = 'Excellent';
        else if (loss <= 70) classification = 'Good';
        else if (loss <= 130) classification = 'Inaccuracy';
        else if (loss <= 300) classification = 'Mistake';
        else classification = 'Blunder';
    }

    // Update Badge
    const evalVal = analysis && analysis.type === 'mate' ? `M${Math.abs(analysis.value)}` : (analysis ? (analysis.value / 100).toFixed(2) : '-');
    const badge = document.getElementById('coachEval');
    badge.innerText = (analysis && analysis.value > 0 ? '+' : '') + evalVal;

    // Update Message
    const msgEl = document.getElementById('coachMessage');

    // We need the 'bestMove' for the POSITION BEFORE the played move.
    // analysisResults[moveIndex] is the eval AFTER the move.
    // analysisResults[moveIndex-1] is the eval BEFORE the move.
    // So determining if the move was good relies on the drop in eval.
    // BUT the 'bestMove' we just stored is what Stockfish thought was best for the board state corresponding to that analysis item.
    // analysisQueue item was: { fen: tempGame.fen(), moveIndex: i, move: reviewMoves[i] }
    // The FEN in the queue item is the position AFTER the move `reviewMoves[i]` was made?
    // Let's check analyzeGame loop:
    // tempGame.move(reviewMoves[i]);
    // analysisQueue.push({ fen: tempGame.fen(), ... })
    // So the FEN analyzed is AFTER the move.
    // So Stockfish gives us the best move response to the user's move. 
    // This is NOT the suggested move for the user! This is the opponent's best response!

    // To get the "Best Move" the user SHOULD have played, we needed to analyze the position BEFORE they moved.
    // We do analyze the start position (moveIndex -1).
    // And we analyze after Move 1.
    // analysisResults[0] = Start Position Analysis. bestMove here is White's best first move.
    // analysisResults[1] = Position After Move 1. bestMove here is Black's best response.

    // So:
    // User plays Move 1 (White).
    // We want to know if Move 1 was good.
    // We check analysisResults[0] (Start Pos). It has a 'bestMove'.
    // If User's Move 1 !== analysisResults[0].bestMove, maybe it's not the absolute best, but could still be good.
    // But if we classified it as a Mistake, we can say "You should have played " + analysisResults[0].bestMove.

    // Correct Logic:
    // For Move `i` (which is stored at reviewMoves[i-1]?), we look at analysisResults[i-1] (the position before the move).
    // The `bestMove` stored in analysisResults[i-1] is what the engine suggested for that turn.

    // Bounds check: moveIndex is 1 to N.
    // analysisResults[moveIndex - 1] exists.

    const preMoveAnalysis = analysisResults[moveIndex - 1];
    let suggestedMoveSan = '';

    if (preMoveAnalysis && preMoveAnalysis.bestMove) {
        // preMoveAnalysis.bestMove is 'e2e4'. We need to convert to SAN for display if possible, or just use coordinate notation.
        // 'e2e4' is uci. 
        suggestedMoveSan = preMoveAnalysis.bestMove;
        // Note: converting UCI to SAN without the game instance at that state is hard.
        // But we can approximate or just show UCI.
    }

    let explanation = generateExplanation(move, classification, moveIndex);

    // Append Suggestion if bad move
    if ((classification === 'Mistake' || classification === 'Blunder' || classification === 'Inaccuracy') && suggestedMoveSan) {
        explanation += `<br><br><b>Suggestion:</b> You missed <u>${suggestedMoveSan}</u>.`;
    }

    msgEl.innerHTML = `<b>${classification}</b><br>${explanation}`;

    // Update Board Visuals (Icons & Arrows)
    updateBoardVisuals(moveIndex, classification, analysisResults[moveIndex - 1]);
}

function updateBoardVisuals(moveIndex, classification, preMoveAnalysis) {
    clearVisuals();
    if (moveIndex === 0) return;

    const move = reviewMoves[moveIndex - 1]; // The move played

    // 1. Add Icon to the destination square
    let iconType = 'best'; // default
    let iconChar = '★';

    switch (classification) {
        case 'Brilliant': iconType = 'brilliant'; iconChar = '!!'; break;
        case 'Great': iconType = 'great'; iconChar = '!'; break;
        case 'Best': iconType = 'best'; iconChar = '★'; break;
        case 'Excellent': iconType = 'excellent'; iconChar = '👍'; break;
        case 'Good': iconType = 'good'; iconChar = '✓'; break;
        case 'Inaccuracy': iconType = 'inaccuracy'; iconChar = '?!'; break;
        case 'Mistake': iconType = 'mistake'; iconChar = '?'; break;
        case 'Blunder': iconType = 'blunder'; iconChar = '??'; break;
        case 'Book': iconType = 'book'; iconChar = '📖'; break;
    }

    addIconOnSquare(move.to, iconType, iconChar);

    // 2. Draw Arrow for Best Move if User made a Mistake
    if ((classification === 'Mistake' || classification === 'Blunder' || classification === 'Inaccuracy') && preMoveAnalysis && preMoveAnalysis.bestMove) {
        const bestMoveUCI = preMoveAnalysis.bestMove;
        const from = bestMoveUCI.substring(0, 2);
        const to = bestMoveUCI.substring(2, 4);
        drawArrow(from, to, '#96bc4b');
    }
}

function addIconOnSquare(squareId, type, char) {
    const squareEl = document.querySelector(`.square[data-square="${squareId}"]`);
    if (squareEl) {
        const icon = document.createElement('div');
        icon.className = `move-classification-icon bg-${type.toLowerCase()}`;
        icon.innerText = char;
        squareEl.appendChild(icon);
        squareEl.classList.add('has-icon');
    }
}

function drawArrow(from, to, color = '#96bc4b') {
    const svg = document.getElementById('arrowLayer');
    if (!svg) return;

    const fromSq = document.querySelector(`.square[data-square="${from}"]`);
    const toSq = document.querySelector(`.square[data-square="${to}"]`);
    if (!fromSq || !toSq) return;

    const boardRect = document.getElementById('board').getBoundingClientRect();
    const fromRect = fromSq.getBoundingClientRect();
    const toRect = toSq.getBoundingClientRect();

    const x1 = fromRect.left - boardRect.left + fromRect.width / 2;
    const y1 = fromRect.top - boardRect.top + fromRect.height / 2;
    const x2 = toRect.left - boardRect.left + toRect.width / 2;
    const y2 = toRect.top - boardRect.top + toRect.height / 2;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '10');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity', '0.7');
    line.classList.add('arrow-line');

    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = 20;
    const xh1 = x2 - headLen * Math.cos(angle - Math.PI / 6);
    const yh1 = y2 - headLen * Math.sin(angle - Math.PI / 6);
    const xh2 = x2 - headLen * Math.cos(angle + Math.PI / 6);
    const yh2 = y2 - headLen * Math.sin(angle + Math.PI / 6);

    const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    head.setAttribute('points', `${x2},${y2} ${xh1},${yh1} ${xh2},${yh2}`);
    head.setAttribute('fill', color);
    head.setAttribute('opacity', '0.8');

    svg.appendChild(line);
    svg.appendChild(head);
}

function clearVisuals() {
    const svg = document.getElementById('arrowLayer');
    if (svg) svg.innerHTML = '';
    document.querySelectorAll('.move-classification-icon').forEach(el => el.remove());
    document.querySelectorAll('.square.has-icon').forEach(el => el.classList.remove('has-icon'));
}

function clearArrows() {
    const svg = document.getElementById('arrowLayer');
    if (svg) svg.innerHTML = '';
}

function reviewNav(action) {
    if (!reviewMode) return;
    if (action === 'next') {
        if (historyStep < reviewMoves.length) {
            historyStep++;
            renderCurrentView();
        }
    } else if (action === 'prev') {
        if (historyStep > -1) {
            historyStep--;
            renderCurrentView();
        }
    } else if (action === 'retry') {
        historyStep--; // Simple retry
        renderCurrentView();
    }
}



function updateEvalBar(moveIndex) {
    // moveIndex: 0 = start, 1 = after move 1...
    // Careful with bounds
    if (moveIndex < 0) moveIndex = 0;
    if (moveIndex >= analysisResults.length) moveIndex = analysisResults.length - 1;

    const res = analysisResults[moveIndex];
    if (!res) return;

    const barWhite = document.getElementById('evalBarWhite');
    const barBlack = document.getElementById('evalBarBlack');
    const scoreEl = document.getElementById('evalScore');

    let val = res.value; // +White, -Black
    if (res.type === 'mate') {
        // Full bar
        if (val > 0) { // White wins
            barWhite.style.height = '100%';
            barBlack.style.height = '0%';
            scoreEl.innerText = `M${val}`;
        } else {
            barWhite.style.height = '0%';
            barBlack.style.height = '100%';
            scoreEl.innerText = `M${Math.abs(val)}`;
        }
        return;
    }

    // Convert CP to percentage
    // Sigmoid: 1 / (1 + 10^(-val/400))
    // This gives win probability.

    const winChance = 1 / (1 + Math.pow(10, -val / 400));
    const whiteHeight = winChance * 100;

    barWhite.style.height = `${whiteHeight}%`;
    barBlack.style.height = `${100 - whiteHeight}%`;

    scoreEl.innerText = (val > 0 ? '+' : '') + (val / 100).toFixed(1);

    // Inverse Colors for Text? 
    // If white bar is huge (White winning), text is on White bg -> Black Text?
    // If black bar huge, text on Black bg -> White Text?
    // Since text is absolute centered, we can just give it a background box (already did in CSS).
}


/* Engine Configuration */
function configureEngine(elo) {
    if (!stockfish) return;
    // Map Elo to Skill Level (0-20)
    // 400 Elo -> Level 0
    // 3200 Elo -> Level 20
    const level = Math.round(((elo - 400) / (3200 - 400)) * 20);
    const skillLevel = Math.max(0, Math.min(20, level));

    console.log(`Configuring Engine: Elo ${elo} -> Skill Level ${skillLevel}`);

    stockfish.postMessage('setoption name Skill Level value ' + skillLevel);

    // Attempt UCI_LimitStrength/UCI_Elo for engines that support it
    stockfish.postMessage('setoption name UCI_LimitStrength value true');
    stockfish.postMessage('setoption name UCI_Elo value ' + elo);
}

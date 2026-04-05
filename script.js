/**
 * Tic Tac Pro's - Main Application Logic
 */

// --- Global State ---
const state = {
    user: {
        username: '',
        color: 'theme-default',
        wins: 0,
        losses: 0,
        streak: 0,
        quests: [
            { id: 1, text: "Play 1 Online Match", target: 1, progress: 0, completed: false },
            { id: 2, text: "Win 3 Rounds vs AI", target: 3, progress: 0, completed: false },
        ]
    },
    gameMode: null, // 'ai' or 'multiplayer'
    aiDifficulty: 'medium',
    matchScore: { p1: 0, p2: 0 },
    board: Array(9).fill(null),
    isPlayerTurn: true,
    playerSymbol: 'x',
    opponentSymbol: 'o',
    opponent: {
        name: 'Opponent',
        rank: 'Unranked'
    },
    peer: null,
    conn: null,
    isHost: false
};

// --- DOM Elements ---
const screens = {
    intro: document.getElementById('screen-intro'),
    dashboard: document.getElementById('screen-dashboard'),
    aiSetup: document.getElementById('screen-ai-setup'),
    lobby: document.getElementById('screen-multiplayer-lobby'),
    verses: document.getElementById('screen-verses'),
    game: document.getElementById('screen-game')
};

// --- Sound Engine (Web Audio API) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq, type, duration, vol=0.1) {
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

const sounds = {
    mark: () => playTone(600, 'sine', 0.1, 0.2),
    winRound: () => { playTone(500, 'square', 0.1); setTimeout(()=>playTone(800, 'square', 0.2), 100); },
    loseRound: () => { playTone(300, 'triangle', 0.2); setTimeout(()=>playTone(200, 'triangle', 0.3), 150); },
    winMatch: () => { 
        [440, 554, 659, 880].forEach((f, i) => setTimeout(() => playTone(f, 'square', 0.3, 0.2), i*150));
    },
    loseMatch: () => {
        [400, 350, 300, 250].forEach((f, i) => setTimeout(() => playTone(f, 'sawtooth', 0.4, 0.2), i*200));
    }
};

// --- Utility Functions ---
function switchScreen(screenId) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    setTimeout(() => {
        Object.values(screens).forEach(s => s.classList.add('hidden'));
        screens[screenId].classList.remove('hidden');
        // Force reflow
        void screens[screenId].offsetWidth;
        screens[screenId].classList.add('active');
    }, 400); // Wait for CSS transition
}

function getRank(wins) {
    if(wins < 5) return 'Bronze';
    if(wins < 15) return 'Silver';
    if(wins < 30) return 'Gold';
    if(wins < 50) return 'Platinum';
    return 'Diamond 💎';
}

function saveData() {
    localStorage.setItem('ticTacProUser', JSON.stringify(state.user));
}

function loadData() {
    const data = localStorage.getItem('ticTacProUser');
    if (data) {
        state.user = { ...state.user, ...JSON.parse(data) };
        
        // Force update quests to match new requirements
        if (state.user.quests && state.user.quests[0]) {
            state.user.quests[0].text = "Play 1 Online Match";
            state.user.quests[0].target = 1;
            if (state.user.quests[0].progress >= 1) {
                state.user.quests[0].progress = 1;
                state.user.quests[0].completed = true;
            }
        }
        if (state.user.quests && state.user.quests[1]) {
            state.user.quests[1].text = "Win 3 Rounds vs AI";
            state.user.quests[1].target = 3;
        }
        
        document.body.className = state.user.color;
        return true;
    }
    return false;
}

function updateDashboard() {
    document.getElementById('displayUsername').innerText = state.user.username;
    document.getElementById('displayRank').innerText = getRank(state.user.wins);
    document.getElementById('displayStreak').innerText = state.user.streak;
    
    // Quests
    const qList = document.getElementById('questsList');
    qList.innerHTML = '';
    state.user.quests.forEach(q => {
        const li = document.createElement('li');
        if(q.completed) li.classList.add('quest-complete');
        li.innerHTML = `<span>${q.text} (${q.progress}/${q.target})</span> <span class="quest-reward">+10xp</span>`;
        qList.appendChild(li);
    });

    // Mock Leaderboard (Mix of real user and AI players)
    const lbList = document.getElementById('leaderboardList');
    lbList.innerHTML = '';
    const players = [
        { name: state.user.username, wins: state.user.wins, rank: getRank(state.user.wins) },
        { name: 'Destroyer99', wins: 45, rank: 'Platinum' },
        { name: 'NinjaX', wins: 28, rank: 'Gold' },
        { name: 'NoobMaster', wins: 2, rank: 'Bronze' }
    ].sort((a,b) => b.wins - a.wins);

    players.forEach((p, idx) => {
        const li = document.createElement('li');
        let medal = '';
        if(idx===0) medal = '🥇 ';
        if(idx===1) medal = '🥈 ';
        if(idx===2) medal = '🥉 ';
        li.innerHTML = `<span>${medal} ${p.name}</span> <span class="badge">${p.wins} Points - ${p.rank}</span>`;
        lbList.appendChild(li);
    });
}

function updateQuest(id, amount) {
    const q = state.user.quests.find(q => q.id === id);
    if(q && !q.completed) {
        q.progress += amount;
        if(q.progress >= q.target) {
            q.progress = q.target;
            q.completed = true;
            Swal.fire({
                toast: true, position: 'top-end', icon: 'success',
                title: 'Quest Completed!', text: q.text,
                showConfirmButton: false, timer: 3000
            });
        }
        saveData();
    }
}

// --- Intro Logic ---
document.querySelectorAll('.color-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
        document.querySelectorAll('.color-option').forEach(o => o.classList.remove('active'));
        e.target.classList.add('active');
        const theme = e.target.getAttribute('data-theme');
        document.body.className = theme;
        state.user.color = theme;
    });
});

document.getElementById('btnEnterApp').addEventListener('click', () => {
    const userInp = document.getElementById('usernameInput').value.trim();
    if(!userInp) {
        Swal.fire('Wait!', 'Please enter a username.', 'warning');
        return;
    }
    state.user.username = userInp;
    saveData();
    updateDashboard();
    switchScreen('dashboard');
});

// Initialization
if (loadData() && state.user.username) {
    updateDashboard();
    screens.intro.classList.replace('active', 'hidden');
    screens.dashboard.classList.replace('hidden', 'active');
    setTimeout(() => { screens.dashboard.style.display = 'block'; }, 50);
} else {
    screens.intro.classList.remove('hidden');
    screens.intro.classList.add('active');
}

// --- Menu Navigation ---
document.getElementById('btnTrainAi').addEventListener('click', () => switchScreen('aiSetup'));
document.getElementById('btnBackToDashFromAI').addEventListener('click', () => switchScreen('dashboard'));
document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        state.aiDifficulty = e.target.getAttribute('data-diff');
    });
});

document.getElementById('btnPlayOnline').addEventListener('click', () => {
    switchScreen('lobby');
    initPeer();
});
document.getElementById('btnBackToDashFromMP').addEventListener('click', () => {
    if(state.peer) state.peer.destroy();
    switchScreen('dashboard');
});

// --- Start Game Logic ---
document.getElementById('btnStartAIMatch').addEventListener('click', () => {
    state.gameMode = 'ai';
    state.opponent = { name: 'AI Bot (' + state.aiDifficulty + ')', rank: 'CPU' };
    state.isHost = true;
    startVersesSequence();
});

function startVersesSequence() {
    switchScreen('verses');
    document.getElementById('vsPlayer1Name').innerText = state.user.username;
    document.getElementById('vsPlayer1Rank').innerText = getRank(state.user.wins);
    document.getElementById('vsPlayer2Name').innerText = state.opponent.name;
    document.getElementById('vsPlayer2Rank').innerText = state.opponent.rank;

    setTimeout(() => {
        initMatch();
        switchScreen('game');
    }, 3000);
}

// --- Game Engine ---
function initMatch() {
    state.matchScore = { p1: 0, p2: 0 };
    updateScoreUI();
    state.playerSymbol = state.isHost ? 'x' : 'o';
    state.opponentSymbol = state.isHost ? 'o' : 'x';
    
    document.getElementById('p1NameLabel').innerText = state.user.username + ` (${state.playerSymbol.toUpperCase()})`;
    document.getElementById('p2NameLabel').innerText = state.opponent.name + ` (${state.opponentSymbol.toUpperCase()})`;
    
    startRound();
}

function startRound() {
    state.board = Array(9).fill(null);
    renderBoard();
    state.isRoundActive = true;
    // Host starts first
    state.isPlayerTurn = state.isHost;
    updateTurnIndicator();

    if(!state.isPlayerTurn && state.gameMode === 'ai') {
        setTimeout(makeAIMove, 800);
    }
}

function renderBoard() {
    const cells = document.querySelectorAll('.cell');
    cells.forEach((cell, idx) => {
        cell.className = 'cell';
        if (state.board[idx]) {
            cell.classList.add(state.board[idx]);
        }
    });
}

function updateTurnIndicator() {
    const ind = document.getElementById('turnIndicator');
    if (state.isPlayerTurn) {
        ind.innerText = "Your Turn";
        ind.style.background = "var(--accent-color)";
    } else {
        ind.innerText = "Waiting...";
        ind.style.background = "rgba(255,255,255,0.2)";
    }
}

function updateScoreUI() {
    document.getElementById('p1ScoreLabel').innerText = state.matchScore.p1;
    document.getElementById('p2ScoreLabel').innerText = state.matchScore.p2;
}

// Click on Cell
document.getElementById('gameBoard').addEventListener('click', (e) => {
    if (!state.isRoundActive || !state.isPlayerTurn) return;
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const idx = parseInt(cell.getAttribute('data-index'));
    
    if (state.board[idx] === null) {
        makeMove(idx, state.playerSymbol);
        
        if (state.gameMode === 'multiplayer' && state.conn) {
            state.conn.send({ type: 'MOVE', index: idx });
        } else if (state.gameMode === 'ai' && state.isRoundActive) {
            setTimeout(makeAIMove, 600 + Math.random() * 400); // Simulate thinking
        }
    }
});

function makeMove(idx, symbol) {
    state.board[idx] = symbol;
    sounds.mark();
    renderBoard();
    
    if(checkWinner()) return;
    if(checkDraw()) return;

    state.isPlayerTurn = symbol !== state.playerSymbol;
    updateTurnIndicator();
}

const winPatterns = [
    [0,1,2], [3,4,5], [6,7,8], // Rows
    [0,3,6], [1,4,7], [2,5,8], // Cols
    [0,4,8], [2,4,6]           // Diag
];

function checkWinner() {
    for (let pattern of winPatterns) {
        const [a,b,c] = pattern;
        if (state.board[a] && state.board[a] === state.board[b] && state.board[a] === state.board[c]) {
            // Highlight winner
            document.querySelector(`[data-index="${a}"]`).classList.add('winner');
            document.querySelector(`[data-index="${b}"]`).classList.add('winner');
            document.querySelector(`[data-index="${c}"]`).classList.add('winner');
            
            handleRoundEnd(state.board[a] === state.playerSymbol);
            return true;
        }
    }
    return false;
}

function checkDraw() {
    if (!state.board.includes(null)) {
        handleRoundEnd(null); // Draw
        return true;
    }
    return false;
}

function handleRoundEnd(playerWon) {
    state.isRoundActive = false;
    state.isPlayerTurn = false;

    if (playerWon === true) {
        state.matchScore.p1++;
        state.user.wins++; // Each round win is one point
        saveData();
        sounds.winRound();
        if(state.gameMode === 'ai') updateQuest(2, 1);
        Swal.fire({ toast: true, position: 'top', title: 'Round Won! +1 Point', timer: 2000, showConfirmButton: false, background: 'var(--panel-bg)', color: '#fff' });
    } else if (playerWon === false) {
        state.matchScore.p2++;
        saveData();
        sounds.loseRound();
        Swal.fire({ toast: true, position: 'top', title: 'Round Lost!', timer: 2000, showConfirmButton: false, background: 'var(--panel-bg)', color: '#fff' });
    } else {
        Swal.fire({ toast: true, position: 'top', title: 'Draw!', timer: 2000, showConfirmButton: false, background: 'var(--panel-bg)', color: '#fff' });
    }
    
    updateScoreUI();

    // Alternate starting player
    state.isHost = !state.isHost;
    
    // Swap symbols so whoever starts plays as X
    const temp = state.playerSymbol;
    state.playerSymbol = state.opponentSymbol;
    state.opponentSymbol = temp;
    
    document.getElementById('p1NameLabel').innerText = state.user.username + ` (${state.playerSymbol.toUpperCase()})`;
    document.getElementById('p2NameLabel').innerText = state.opponent.name + ` (${state.opponentSymbol.toUpperCase()})`;

    if (state.matchScore.p1 >= 5) {
        triggerMatchEnd(true);
    } else if (state.matchScore.p2 >= 5) {
        triggerMatchEnd(false);
    } else {
        // Next round
        setTimeout(startRound, 2500);
    }
}

function triggerMatchEnd(didWin) {
    if (didWin) {
        state.user.streak++;
        sounds.winMatch();
        Swal.fire({
            title: 'Match Victory!',
            text: `You defeated ${state.opponent.name}! First to 5 points achieved.`,
            icon: 'success',
            background: 'var(--panel-bg)', color: '#fff',
            confirmButtonColor: 'var(--accent-color)'
        }).then(() => resetMatch());
    } else {
        state.user.streak = 0;
        sounds.loseMatch();
        Swal.fire({
            title: 'Match Defeat!',
            text: `${state.opponent.name} reached 5 points.`,
            icon: 'error',
            background: 'var(--panel-bg)', color: '#fff',
            confirmButtonColor: 'var(--accent-color)'
        }).then(() => resetMatch());
    }
    saveData();
}

function resetMatch() {
    state.matchScore = { p1: 0, p2: 0 };
    updateScoreUI();
    setTimeout(startRound, 1000);
}

function finishAndReturn() {
    if (state.peer) state.peer.destroy();
    updateDashboard();
    switchScreen('dashboard');
}

document.getElementById('btnQuitMatch').addEventListener('click', () => {
    Swal.fire({
        title: 'Leave Session?',
        text: "Are you sure you want to return to the dashboard?",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: 'var(--x-color)',
        confirmButtonText: 'Yes, Leave',
        background: 'var(--panel-bg)', color: '#fff',
    }).then((result) => {
        if (result.isConfirmed) {
            if (state.conn) state.conn.send({ type: 'SURRENDER' });
            finishAndReturn();
        }
    });
});

// --- AI Logic ---
function makeAIMove() {
    if (!state.isRoundActive || state.isPlayerTurn) return;
    
    let moveIdx;
    
    if (state.aiDifficulty === 'easy') {
        const available = state.board.map((v, i) => v === null ? i : null).filter(v => v !== null);
        moveIdx = available[Math.floor(Math.random() * available.length)];
    } 
    else if (state.aiDifficulty === 'medium') {
        // 50% chance Minimax, 50% chance Random
        if (Math.random() > 0.5) {
            moveIdx = getBestMove(state.board, state.opponentSymbol).index;
        } else {
            const available = state.board.map((v, i) => v === null ? i : null).filter(v => v !== null);
            moveIdx = available[Math.floor(Math.random() * available.length)];
        }
    }
    else { // hard - Unbeatable
        moveIdx = getBestMove(state.board, state.opponentSymbol).index;
    }
    
    makeMove(moveIdx, state.opponentSymbol);
}

// Minimax algorithm
function getBestMove(newBoard, player) {
    const availSpots = newBoard.map((v, i) => v === null ? i : null).filter(v => v !== null);
    
    if (checkWinSim(newBoard, state.playerSymbol)) return { score: -10 };
    else if (checkWinSim(newBoard, state.opponentSymbol)) return { score: 10 };
    else if (availSpots.length === 0) return { score: 0 };
    
    const moves = [];
    for (let i = 0; i < availSpots.length; i++) {
        const move = {};
        move.index = availSpots[i];
        newBoard[availSpots[i]] = player;

        if (player == state.opponentSymbol) {
            const result = getBestMove(newBoard, state.playerSymbol);
            move.score = result.score;
        } else {
            const result = getBestMove(newBoard, state.opponentSymbol);
            move.score = result.score;
        }
        
        newBoard[availSpots[i]] = null;
        moves.push(move);
    }
    
    let bestMove;
    if (player === state.opponentSymbol) {
        let bestScore = -10000;
        for (let i = 0; i < moves.length; i++) {
            if (moves[i].score > bestScore) {
                bestScore = moves[i].score;
                bestMove = i;
            }
        }
    } else {
        let bestScore = 10000;
        for (let i = 0; i < moves.length; i++) {
            if (moves[i].score < bestScore) {
                bestScore = moves[i].score;
                bestMove = i;
            }
        }
    }
    return moves[bestMove];
}

function checkWinSim(board, player) {
    return winPatterns.some(pattern => {
        return pattern.every(index => board[index] === player);
    });
}

// --- Multiplayer PeerJS Logic ---
function initPeer() {
    state.peer = new Peer();
    
    state.peer.on('open', (id) => {
        document.getElementById('myPeerId').innerText = id;
    });

    // Handle Incoming Connection
    state.peer.on('connection', (c) => {
        if(state.conn) {
            c.send({ type: 'REJECT', reason: 'Busy' });
            return;
        }
        setupConnection(c, true);
    });

    state.peer.on('error', (err) => {
        Swal.fire('Connection Error', err.type, 'error');
    });
}

document.getElementById('btnCopyId').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('myPeerId').innerText);
    const m = document.getElementById('btnCopyId');
    m.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
    setTimeout(() => { m.innerHTML = '<i class="fa-regular fa-copy"></i> Copy'; }, 2000);
});

document.getElementById('btnJoinMatch').addEventListener('click', () => {
    const destId = document.getElementById('joinIdInput').value.trim();
    if (!destId) return;
    
    const m = document.getElementById('btnJoinMatch');
    m.innerText = 'Connecting...';
    m.disabled = true;

    const conn = state.peer.connect(destId, { reliable: true });
    setupConnection(conn, false);

    setTimeout(() => {
        m.innerText = 'Connect';
        m.disabled = false;
    }, 3000); // Reset UI after a bit
});

function setupConnection(c, IAmHost) {
    state.conn = c;
    
    c.on('open', () => {
        state.gameMode = 'multiplayer';
        state.isHost = IAmHost;
        updateQuest(1, 1);
        
        // Send our profile info
        c.send({
            type: 'HELLO',
            payload: { name: state.user.username, rank: getRank(state.user.wins) }
        });
    });

    c.on('data', (data) => {
        if (data.type === 'HELLO') {
            state.opponent = data.payload;
            startVersesSequence();
        }
        else if (data.type === 'MOVE') {
            makeMove(data.index, state.opponentSymbol);
        }
        else if (data.type === 'SURRENDER') {
            Swal.fire('Opponent Left', 'The opponent has left the session.', 'info')
                .then(() => {
                    finishAndReturn();
                });
        }
    });

    c.on('close', () => {
        if (screens.game.classList.contains('active')) {
            Swal.fire('Disconnected', 'The opponent disconnected.', 'warning').then(()=>finishAndReturn());
        }
        state.conn = null;
    });
}

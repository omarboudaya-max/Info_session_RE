import * as THREE from 'three';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
// --- CONFIGURATION ---
const PLANET_RADIUS = 50;
const MAX_PLAYER_SPEED = 0.22;
const ACCELERATION = 0.02;
const DECELERATION = 0.1;
const JUMP_FORCE = 0.3;
const GRAVITY = -0.015;
const CAMERA_LAG = 0.05; // Smoothing factor
const CAMERA_TILT_STRENGTH = 2.0;

let particles = [];

// --- FIREBASE SETUP ---
// REPLACE THE BELOW WITH YOUR ACTUAL FIREBASE CONFIG
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
let currentSessionId = null;

async function savePlayerData(name, trait) {
    currentSessionId = `${name}_${Date.now()}`;
    try {
        await setDoc(doc(db, "participants", currentSessionId), {
            name: name,
            trait: trait,
            won: false,
            timestamp: serverTimestamp()
        });
        console.log("Player data saved to Firebase");
    } catch (e) {
        console.error("Error saving player data: ", e);
    }
}

async function updatePlayerVictory() {
    if (!currentSessionId) return;
    try {
        await updateDoc(doc(db, "participants", currentSessionId), {
            won: true,
            winTimestamp: serverTimestamp()
        });
        console.log("Player victory updated in Firebase");
    } catch (e) {
        console.error("Error updating victory: ", e);
    }
}

// --- STATE ---
let gameState = {
    screen: 'start', // start, selection, playing, puzzle, victory
    playerName: '',
    playerTrait: '',
    objectivesFound: 0,
    totalObjectives: 5,
    puzzlesCompleted: [false, false, false, false, false],
    activePuzzleIndex: -1
};

const OS_DATA = [
    {
        title: "OS 1 — Développer un réseau solide",
        objectives: [
            "Signer au moins 3 partenariats avec des incubateurs/accélérateurs tunisiens",
            "Établir un partenariat avec au moins 1 grande entreprise Tech/Finance",
            "Maintenir une relation active avec 100% des partenaires"
        ],
        type: "Tower",
        color: 0xf59e0b,
        puzzleType: "connect"
    },
    {
        title: "OS 2 — Faciliter l'accès aux ressources",
        objectives: [
            "Négocier au moins 3 licences logicielles gratuites/réduites",
            "Obtenir l'accès à au moins 1 espace de coworking partenaire",
            "Organiser au moins 1 workshop/conférence expert",
            "Mobiliser au moins 3 Alumni comme mentors/jurys"
        ],
        type: "Chest",
        color: 0x10b981,
        puzzleType: "match"
    },
    {
        title: "OS 3 — Renforcer la crédibilité",
        objectives: [
            "Maintenir une relation pro avec l'administration IHEC",
            "Produire et diffuser 1 portfolio de réalisations",
            "Participer à au moins 1 événement externe majeur"
        ],
        type: "Monument",
        color: 0x3b82f6,
        puzzleType: "meter"
    },
    {
        title: "OS 4 — Générer des ressources",
        objectives: [
            "Signer au moins 2 contrats de sponsoring financier",
            "Obtenir au moins 4 partenariats en nature",
            "Base de données de +100 contacts qualifiés",
            "Atteindre le budget de sponsoring annuel"
        ],
        type: "Vault",
        color: 0xec4899,
        puzzleType: "sentence",
        pairs: [
            { first: "Signer au moins 2", second: "contrats de sponsoring" },
            { first: "Obtenir au moins 4", second: "partenariats en nature" },
            { first: "Base de données de", second: "+100 contacts qualifiés" }
        ]
    },
    {
        title: "OS 5 — Valoriser l'image du club",
        objectives: [
            "Représenter le club dans au moins 1 salon entrepreneurial",
            "Obtenir au moins 3 Reposts par les partenaires LinkedIn",
            "Assurer la satisfaction des partenaires post-événement",
            "Envoyer les rapports post-événement dans les délais"
        ],
        type: "Beacon",
        color: 0x8b5cf6,
        puzzleType: "logo"
    }
];

// --- THREE.JS VARIABLES ---
let scene, camera, renderer, planet, player, controls;
let OS_OBJECTS = [];
let clock = new THREE.Clock();
let keys = { 
    w: false, a: false, s: false, d: false, ' ': false,
    arrowup: false, arrowdown: false, arrowleft: false, arrowright: false 
};
let playerVelocity = new THREE.Vector3();
let isJumping = false;

// --- DOM ELEMENTS ---
const startScreen = document.getElementById('start-screen');
const charSelection = document.getElementById('char-selection');
const hud = document.getElementById('hud');
const puzzleModal = document.getElementById('puzzle-modal');
const victoryScreen = document.getElementById('victory-screen');
const btnPlay = document.getElementById('btn-play');
const btnStartGame = document.getElementById('btn-start-game');
const playerNameInput = document.getElementById('player-name');
const charCards = document.querySelectorAll('.char-card');

// --- INITIALIZATION ---

function init() {
    console.log("Initializing Game...");
    try {
        // UI Setup
        if (!btnPlay) throw new Error("Button 'btn-play' not found");
        
        btnPlay.addEventListener('click', () => {
            console.log("Play button clicked");
            switchScreen('selection');
        });

    charCards.forEach(card => {
        card.addEventListener('click', () => {
            charCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            gameState.playerTrait = card.dataset.trait;
            validateSelection();
        });
    });

    playerNameInput.addEventListener('input', validateSelection);

    btnStartGame.addEventListener('click', () => {
        gameState.playerName = playerNameInput.value;
        startGame();
    });

    // Handle Input
    window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
    window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

    // Scene Setup
    setupThreeJS();
    createPlanet();
    createOSStructures();
    
    // Resize Listener
    window.addEventListener('resize', onWindowResize);

    // Start Loop
    animate();
    console.log("Game initialized successfully");
    } catch (e) {
        console.error("Initialization error:", e);
        alert("Game Load Error: " + e.message + "\nCheck console for details.");
        // Fallback: at least show the selection screen if UI is ready
        if (btnPlay) {
            btnPlay.addEventListener('click', () => switchScreen('selection'));
        }
    }
}

function validateSelection() {
    btnStartGame.disabled = !(playerNameInput.value.length > 0 && gameState.playerTrait !== '');
}

function switchScreen(screen) {
    gameState.screen = screen;
    [startScreen, charSelection, hud, puzzleModal, victoryScreen].forEach(el => el.classList.remove('active'));
    
    if (screen === 'start') startScreen.classList.add('active');
    if (screen === 'selection') charSelection.classList.add('active');
    if (screen === 'playing') {
        hud.classList.remove('hidden');
        hud.classList.add('active');
        document.getElementById('hud-name').innerText = gameState.playerName + ' (' + gameState.playerTrait + ')';
    }
}

function setupThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a); // Deep blue space

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 10, 20);

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas'), antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1);
    sunLight.position.set(50, 100, 50);
    sunLight.castShadow = true;
    scene.add(sunLight);
}

function createPlanet() {
    const geometry = new THREE.SphereGeometry(PLANET_RADIUS, 64, 64);
    const material = new THREE.MeshStandardMaterial({ 
        color: 0x2dd4bf, // Teal/Cartoonish ground
        roughness: 0.8,
        metalness: 0.2
    });
    planet = new THREE.Mesh(geometry, material);
    planet.receiveShadow = true;
    scene.add(planet);

    // Add Glowing Core
    const coreGeom = new THREE.SphereGeometry(PLANET_RADIUS * 0.9, 32, 32);
    const coreMat = new THREE.MeshStandardMaterial({ 
        color: 0xffffff, 
        emissive: 0x2dd4bf, 
        emissiveIntensity: 2,
        transparent: true,
        opacity: 0.5
    });
    const core = new THREE.Mesh(coreGeom, coreMat);
    scene.add(core);

    // Add some simple "atmosphere" logic or stars
    const starGeometry = new THREE.BufferGeometry();
    const starMaterial = new THREE.PointsMaterial({ color: 0xffffff });
    const starVertices = [];
    for (let i = 0; i < 1000; i++) {
        const x = (Math.random() - 0.5) * 1000;
        const y = (Math.random() - 0.5) * 1000;
        const z = (Math.random() - 0.5) * 1000;
        starVertices.push(x, y, z);
    }
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    // Add Road (A ring around the equator)
    const roadGeom = new THREE.TorusGeometry(PLANET_RADIUS + 0.05, 1.5, 16, 100);
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x4b5563 }); // Gray road
    const road = new THREE.Mesh(roadGeom, roadMat);
    road.rotation.x = Math.PI / 2;
    scene.add(road);

    // Add Grass (Scattered green cones)
    const grassGeom = new THREE.ConeGeometry(0.2, 0.6, 4);
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x15803d });
    for (let i = 0; i < 300; i++) {
        const grass = new THREE.Mesh(grassGeom, grassMat);
        // Random spherical position
        const phi = Math.random() * Math.PI * 2;
        const theta = Math.acos(2 * Math.random() - 1);
        const pos = new THREE.Vector3().setFromSphericalCoords(PLANET_RADIUS, theta, phi);
        grass.position.copy(pos);
        // Align to surface
        const up = pos.clone().normalize();
        grass.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
        scene.add(grass);
    }
}

function createOSStructures() {
    OS_DATA.forEach((data, index) => {
        const group = new THREE.Group();
        
        // Random position on sphere
        const phi = Math.acos(-1 + (2 * index) / OS_DATA.length);
        const theta = Math.sqrt(OS_DATA.length * Math.PI) * phi;
        
        const pos = new THREE.Vector3().setFromSphericalCoords(PLANET_RADIUS, phi, theta);
        group.position.copy(pos);
        
        // Align to surface
        const up = pos.clone().normalize();
        group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
        
        // Create Shape based on type
        let mesh;
        if (data.type === "Tower") {
            mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1, 4, 8), new THREE.MeshStandardMaterial({ color: data.color }));
            mesh.position.y = 2;
        } else if (data.type === "Chest") {
            mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 2), new THREE.MeshStandardMaterial({ color: data.color }));
            mesh.position.y = 0.75;
        } else if (data.type === "Monument") {
            mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(0.8, 0.3, 64, 8), new THREE.MeshStandardMaterial({ color: data.color }));
            mesh.position.y = 1.5;
        } else if (data.type === "Vault") {
            mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: data.color }));
            mesh.position.y = 1;
        } else { // Beacon
            mesh = new THREE.Mesh(new THREE.ConeGeometry(1, 3, 8), new THREE.MeshStandardMaterial({ color: data.color }));
            mesh.position.y = 1.5;
        }
        
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        
        // Objective Indicator (Floating icon placeholder)
        const indicator = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })
        );
        indicator.position.y = 5;
        group.add(indicator);
        
        scene.add(group);
        OS_OBJECTS.push({ mesh: group, data: data, index: index, completed: false, indicator: indicator });
    });

    // Add some Trees
    const treeTrunkGeom = new THREE.CylinderGeometry(0.2, 0.2, 1, 8);
    const treeTopGeom = new THREE.ConeGeometry(0.8, 2, 8);
    const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f });
    const treeTopMat = new THREE.MeshStandardMaterial({ color: 0x065f46 });

    for (let i = 0; i < 40; i++) {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(treeTrunkGeom, treeTrunkMat);
        trunk.position.y = 0.5;
        tree.add(trunk);
        const top = new THREE.Mesh(treeTopGeom, treeTopMat);
        top.position.y = 1.8;
        tree.add(top);

        const phi = Math.random() * Math.PI * 2;
        const theta = Math.acos(2 * Math.random() - 1);
        const pos = new THREE.Vector3().setFromSphericalCoords(PLANET_RADIUS, theta, phi);
        tree.position.copy(pos);
        const up = pos.clone().normalize();
        tree.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
        scene.add(tree);
    }

    // Add Clouds
    const cloudGeom = new THREE.SphereGeometry(1, 8, 8);
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    for (let i = 0; i < 20; i++) {
        const cloud = new THREE.Group();
        for (let j = 0; j < 5; j++) {
            const part = new THREE.Mesh(cloudGeom, cloudMat);
            part.position.set(Math.random()*3, Math.random()*1, Math.random()*2);
            part.scale.set(1.5, 1, 1.2);
            cloud.add(part);
        }
        const phi = Math.random() * Math.PI * 2;
        const theta = Math.acos(2 * Math.random() - 1);
        const pos = new THREE.Vector3().setFromSphericalCoords(PLANET_RADIUS + 15, theta, phi);
        cloud.position.copy(pos);
        const up = pos.clone().normalize();
        cloud.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
        scene.add(cloud);
    }
}

function startGame() {
    console.log("Starting game...");
    createPlayer();
    savePlayerData(gameState.playerName, gameState.playerTrait);
    switchScreen('playing');
}

function createPlayer() {
    // Detailed cartoon character with limbs
    const playerGroup = new THREE.Group();
    const avatar = new THREE.Group();
    playerGroup.add(avatar);
    
    // Body
    const bodyGeom = new THREE.BoxGeometry(0.8, 1.2, 0.6);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6366f1 });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.9;
    body.castShadow = true;
    avatar.add(body);

    // Head
    const headGeom = new THREE.BoxGeometry(0.7, 0.7, 0.7);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffedd5 });
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.y = 1.85;
    head.castShadow = true;
    avatar.add(head);

    // Limbs
    const limbMat = new THREE.MeshStandardMaterial({ color: 0x6366f1 });
    const limbGeom = new THREE.BoxGeometry(0.2, 0.7, 0.2);

    // Legs
    avatar.leftLeg = new THREE.Mesh(limbGeom, limbMat);
    avatar.leftLeg.position.set(-0.25, 0.2, 0);
    avatar.add(avatar.leftLeg);

    avatar.rightLeg = new THREE.Mesh(limbGeom, limbMat);
    avatar.rightLeg.position.set(0.25, 0.2, 0);
    avatar.add(avatar.rightLeg);

    // Arms
    avatar.leftArm = new THREE.Mesh(limbGeom, limbMat);
    avatar.leftArm.position.set(-0.5, 1.1, 0);
    avatar.add(avatar.leftArm);

    avatar.rightArm = new THREE.Mesh(limbGeom, limbMat);
    avatar.rightArm.position.set(0.5, 1.1, 0);
    avatar.add(avatar.rightArm);

    player = playerGroup;
    player.avatar = avatar; // Reference for rotation
    player.walkCycle = 0;
    // Initial position on top of sphere
    player.position.set(0, PLANET_RADIUS + 0.1, 0);
    scene.add(player);
}

function createJumpEffect(pos) {
    const geom = new THREE.SphereGeometry(0.1, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    for (let i = 0; i < 5; i++) {
        const p = new THREE.Mesh(geom, mat.clone());
        p.position.copy(pos);
        // Ensure velocity is outward and slightly "up" relative to surface
        const up = pos.clone().normalize();
        p.velocity = up.multiplyScalar(0.05).add(new THREE.Vector3((Math.random()-0.5)*0.1, (Math.random()-0.5)*0.1, (Math.random()-0.5)*0.1));
        scene.add(p);
        particles.push(p);
    }
}

function updateParticles() {
    particles = particles.filter(p => {
        p.position.add(p.velocity);
        p.material.opacity -= 0.02;
        if (p.material.opacity <= 0) {
            scene.remove(p);
            return false;
        }
        return true;
    });
}

function animate() {
    requestAnimationFrame(animate);
    
    if (gameState.screen === 'playing' && player) {
        updateMovement();
        updateCamera();
        checkInteractions();
    }
    
    updateParticles();

    // Animation for indicators
    OS_OBJECTS.forEach(obj => {
        if (!obj.completed) {
            obj.indicator.position.y = 5 + Math.sin(Date.now() * 0.003) * 0.5;
            obj.mesh.rotation.y += 0.01;
        }
    });

    renderer.render(scene, camera);
}

function checkInteractions() {
    OS_OBJECTS.forEach(obj => {
        if (!obj.completed) {
            const dist = player.position.distanceTo(obj.mesh.position);
            if (dist < 3) {
                openPuzzle(obj.index);
            }
        }
    });
}

function openPuzzle(index) {
    gameState.activePuzzleIndex = index;
    gameState.screen = 'puzzle';
    puzzleModal.classList.add('active');
    
    const data = OS_DATA[index];
    const content = document.getElementById('puzzle-content');
    
    // Stage 1: Title Screen
    content.innerHTML = `
        <div class="puzzle-title-screen">
            <h1 style="color: #${data.color.toString(16)}">${data.title}</h1>
            <p>Ready to unlock this objective?</p>
            <button id="btn-start-puzzle" class="btn-primary">START CHALLENGE</button>
        </div>
    `;

    document.getElementById('btn-start-puzzle').addEventListener('click', () => {
        startActualPuzzle(index);
    });
}

function startActualPuzzle(index) {
    const data = OS_DATA[index];
    const content = document.getElementById('puzzle-content');
    
    content.innerHTML = `
        <h2 style="color: #${data.color.toString(16)}">${data.title}</h2>
        <div id="puzzle-interaction-area" class="puzzle-area"></div>
        <div id="puzzle-feedback" style="margin-top: 10px; font-weight: bold;"></div>
    `;

    const area = document.getElementById('puzzle-interaction-area');

    if (data.puzzleType === 'connect') {
        area.innerHTML = `
            <div class="puzzle-dots-complex">
                ${[1,2,3,4,5,6].map(i => `<div class="dot" style="top: ${Math.random()*80+10}%; left: ${Math.random()*80+10}%;" data-id="${i}">${i}</div>`).join('')}
            </div>
            <p>Connect 1 to 6 in order!</p>
        `;
        let count = 0;
        document.querySelectorAll('.dot').forEach(dot => {
            dot.addEventListener('click', () => {
                if (!dot.classList.contains('active') && parseInt(dot.dataset.id) === count + 1) {
                    dot.classList.add('active');
                    count++;
                    if (count === 6) completePuzzle(index);
                } else if (!dot.classList.contains('active')) {
                    // Reset on wrong click
                    document.querySelectorAll('.dot').forEach(d => d.classList.remove('active'));
                    count = 0;
                }
            });
        });
    } else if (data.puzzleType === 'match') {
        const icons = ['🤝', '🚀', '📊', '💡', '🏆', '💎', '📈', '🤝', '🚀', '📊', '💡', '🏆', '💎', '📈', '🔥', '🔥'];
        icons.sort(() => Math.random() - 0.5);
        area.innerHTML = `
            <div class="match-grid complex">
                ${icons.map((icon, i) => `<div class="match-item" data-val="${icon}">${icon}</div>`).join('')}
            </div>
        `;
        let selected = null;
        let matches = 0;
        document.querySelectorAll('.match-item').forEach(item => {
            item.addEventListener('click', () => {
                if (item.classList.contains('active') || item.classList.contains('selected')) return;
                item.classList.add('selected');
                if (!selected) {
                    selected = item;
                } else {
                    if (selected.dataset.val === item.dataset.val) {
                        selected.classList.add('active');
                        item.classList.add('active');
                        matches++;
                        if (matches === 8) setTimeout(() => completePuzzle(index), 500);
                    } else {
                        const s = selected;
                        setTimeout(() => { s.classList.remove('selected'); item.classList.remove('selected'); }, 500);
                    }
                    selected = null;
                }
            });
        });
    } else if (data.puzzleType === 'meter') {
        let successes = 0;
        const startMeter = () => {
            area.innerHTML = `
                <div class="meter-info">Successes: ${successes}/3</div>
                <p>Click STOP when the pointer is in the GREEN zone!</p>
                <div class="meter-container">
                    <div class="meter-bar"></div>
                    <div id="pointer" class="meter-pointer"></div>
                </div>
                <button id="btn-stop" class="btn-primary" style="margin-top:20px">STOP NOW!</button>
            `;
            let pointer = document.getElementById('pointer');
            let pos = 0;
            // Start slower (was 3 + successes*2), now gentler progression
            let dir = 2 + successes * 0.8;
            let anim = setInterval(() => {
                pos += dir;
                if (pos >= 98 || pos <= 0) dir *= -1;
                pointer.style.left = pos + '%';
            }, 20);

            document.getElementById('btn-stop').addEventListener('click', () => {
                clearInterval(anim);
                // Green zone is 40% to 60%
                if (pos >= 40 && pos <= 60) {
                    successes++;
                    document.getElementById('puzzle-feedback').innerText = "GREAT TIMING!";
                    document.getElementById('puzzle-feedback').style.color = "#10b981";
                    if (successes === 3) setTimeout(() => completePuzzle(index), 600);
                    else setTimeout(startMeter, 800);
                } else {
                    // Keep successes — don't reset to 0
                    document.getElementById('puzzle-feedback').innerText = "MISSED! Try again...";
                    document.getElementById('puzzle-feedback').style.color = "#ef4444";
                    setTimeout(startMeter, 1200);
                }
            });
        };
        startMeter();
    } else if (data.puzzleType === 'sentence') {
        // New Sentence Match Puzzle
        const pairs = data.pairs;
        let selectedFirst = null;
        let selectedSecond = null;
        let matches = 0;

        const leftSide = pairs.map(p => p.first).sort(() => Math.random() - 0.5);
        const rightSide = pairs.map(p => p.second).sort(() => Math.random() - 0.5);

        area.innerHTML = `
            <div class="sentence-match-container">
                <div class="sentence-column" id="left-col">
                    ${leftSide.map(t => `<div class="sent-part" data-text="${t}">${t}...</div>`).join('')}
                </div>
                <div class="sentence-column" id="right-col">
                    ${rightSide.map(t => `<div class="sent-part" data-text="${t}">...${t}</div>`).join('')}
                </div>
            </div>
            <p>Match the start of the sentence with its ending!</p>
        `;

        const checkMatch = () => {
            const pair = pairs.find(p => p.first === selectedFirst.dataset.text);
            if (pair && pair.second === selectedSecond.dataset.text) {
                selectedFirst.classList.add('active');
                selectedSecond.classList.add('active');
                matches++;
                if (matches === pairs.length) completePuzzle(index);
            } else {
                selectedFirst.classList.add('wrong');
                selectedSecond.classList.add('wrong');
                const f = selectedFirst; const s = selectedSecond;
                setTimeout(() => { f.classList.remove('selected', 'wrong'); s.classList.remove('selected', 'wrong'); }, 600);
            }
            selectedFirst = null;
            selectedSecond = null;
        };

        document.querySelectorAll('#left-col .sent-part').forEach(el => {
            el.addEventListener('click', () => {
                if (el.classList.contains('active')) return;
                document.querySelectorAll('#left-col .sent-part').forEach(p => p.classList.remove('selected'));
                el.classList.add('selected');
                selectedFirst = el;
                if (selectedSecond) checkMatch();
            });
        });

        document.querySelectorAll('#right-col .sent-part').forEach(el => {
            el.addEventListener('click', () => {
                if (el.classList.contains('active')) return;
                document.querySelectorAll('#right-col .sent-part').forEach(p => p.classList.remove('selected'));
                el.classList.add('selected');
                selectedSecond = el;
                if (selectedFirst) checkMatch();
            });
        });
    } else if (data.puzzleType === 'logo') {
        // Logo Fragment Puzzle (3x3 grid swap)
        area.innerHTML = `
            <div class="logo-puzzle-grid" id="logo-grid">
                ${Array.from({length: 9}).map((_, i) => `<div class="logo-fragment" data-correct="${i}" data-current="${i}" style="background-image: url('logo.png'); background-position: ${(i%3)*50}% ${Math.floor(i/3)*50}%;"></div>`).join('')}
            </div>
            <p>Click two fragments to swap them. Reconstruct the logo!</p>
        `;

        let fragments = Array.from(document.querySelectorAll('.logo-fragment'));
        let firstSelected = null;

        // Shuffle logic
        const shuffle = () => {
            for (let i = 0; i < 20; i++) {
                const a = Math.floor(Math.random() * 9);
                const b = Math.floor(Math.random() * 9);
                swapFragments(fragments[a], fragments[b]);
            }
        };

        const swapFragments = (f1, f2) => {
            const tempX = f1.style.backgroundPositionX;
            const tempY = f1.style.backgroundPositionY;
            const tempCorrect = f1.dataset.correct;

            f1.style.backgroundPositionX = f2.style.backgroundPositionX;
            f1.style.backgroundPositionY = f2.style.backgroundPositionY;
            f1.dataset.correct = f2.dataset.correct;

            f2.style.backgroundPositionX = tempX;
            f2.style.backgroundPositionY = tempY;
            f2.dataset.correct = tempCorrect;
        };

        const checkWin = () => {
            const isWin = fragments.every(f => f.dataset.correct === f.dataset.current);
            if (isWin) setTimeout(() => completePuzzle(index), 500);
        };

        fragments.forEach(f => {
            f.addEventListener('click', () => {
                if (!firstSelected) {
                    firstSelected = f;
                    f.classList.add('selected');
                } else {
                    swapFragments(firstSelected, f);
                    firstSelected.classList.remove('selected');
                    firstSelected = null;
                    checkWin();
                }
            });
        });

        shuffle();
    } else {
        // Fallback or Sequence Order for others
        const items = data.objectives.slice(0, 4);
        const shuffled = [...items].sort(() => Math.random() - 0.5);
        area.innerHTML = `
            <p>Select objectives in the correct strategic order:</p>
            <div class="sequence-list">
                ${shuffled.map(text => `<div class="seq-item" data-text="${text}">${text}</div>`).join('')}
            </div>
        `;
        let currentIdx = 0;
        document.querySelectorAll('.seq-item').forEach(item => {
            item.addEventListener('click', () => {
                if (item.dataset.text === items[currentIdx]) {
                    item.classList.add('active');
                    currentIdx++;
                    if (currentIdx === items.length) completePuzzle(index);
                } else {
                    document.querySelectorAll('.seq-item').forEach(i => i.classList.remove('active'));
                    currentIdx = 0;
                }
            });
        });
    }
}

function completePuzzle(index) {
    gameState.puzzlesCompleted[index] = true;
    OS_OBJECTS[index].completed = true;
    OS_OBJECTS[index].indicator.visible = false;
    OS_OBJECTS[index].mesh.scale.set(1.2, 1.2, 1.2); // Visual feedback
    
    gameState.objectivesFound++;
    document.getElementById('hud-objectives').innerText = `Objectives: ${gameState.objectivesFound}/5`;
    
    const data = OS_DATA[index];
    const content = document.getElementById('puzzle-content');
    
    content.innerHTML = `
        <h2 style="color: #${data.color.toString(16)}">Objectifs Annuels SMART Débloqués !</h2>
        <ul class="obj-list">
            ${data.objectives.map(obj => `<li>${obj}</li>`).join('')}
        </ul>
        <button id="btn-close-puzzle" class="btn-primary">CONTINUE EXPLORING</button>
    `;
    
    document.getElementById('btn-close-puzzle').addEventListener('click', () => {
        puzzleModal.classList.remove('active');
        gameState.screen = 'playing';
        checkVictory();
    });
}

function checkVictory() {
    if (gameState.objectivesFound === gameState.totalObjectives) {
        gameState.screen = 'victory';
        victoryScreen.classList.add('active');
        updatePlayerVictory();
        const summary = document.getElementById('victory-summary');
        summary.innerHTML = `
            <p>Congratulations ${gameState.playerName}! You have successfully discovered all 5 strategic objectives of the External Relations department.</p>
            <p>Your vision as a ${gameState.playerTrait} entrepreneur will lead the club to new heights!</p>
        `;
        // Trigger celebration effects (simplified here)
        scene.background = new THREE.Color(0x1e1b4b); // Change sky color
    }
}

function updateMovement() {
    // 1. Core Physics: Align character to sphere center
    const planetCenter = new THREE.Vector3(0, 0, 0);
    const upDirection = player.position.clone().normalize();
    player.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), upDirection);

    // 2. Gravitational pull
    const dist = player.position.distanceTo(planetCenter);
    if (dist > PLANET_RADIUS) {
        playerVelocity.y += GRAVITY;
    } else {
        playerVelocity.y = 0;
        isJumping = false;
        // Snap to surface
        player.position.copy(upDirection.multiplyScalar(PLANET_RADIUS));
    }

    // 3. Jump
    if (keys[' '] && !isJumping) {
        playerVelocity.y = JUMP_FORCE;
        isJumping = true;
        createJumpEffect(player.position);
    }

    // 4. Horizontal Movement (relative to current orientation)
    const moveDir = new THREE.Vector3();
    if (keys.w || keys.arrowup) moveDir.z -= 1;
    if (keys.s || keys.arrowdown) moveDir.z += 1;
    if (keys.a || keys.arrowleft) moveDir.x -= 1;
    if (keys.d || keys.arrowright) moveDir.x += 1;

    if (moveDir.length() > 0) {
        moveDir.normalize();
        
        // Smooth Acceleration
        player.currentSpeed = (player.currentSpeed || 0) + ACCELERATION;
        if (player.currentSpeed > MAX_PLAYER_SPEED) player.currentSpeed = MAX_PLAYER_SPEED;

        // Project movement onto the tangent plane of the sphere
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(player.quaternion);
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(player.quaternion);
        
        const worldMove = new THREE.Vector3()
            .addScaledVector(right, moveDir.x)
            .addScaledVector(forward, moveDir.z);
        
        player.position.addScaledVector(worldMove, player.currentSpeed);

        // Character Rotation (Facing Movement Direction)
        const targetAngle = Math.atan2(moveDir.x, moveDir.z);
        const currentAngle = player.avatar.rotation.y;
        
        // Smoothly rotate the avatar to face movement direction
        const angleDiff = targetAngle - currentAngle;
        const shortAngleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
        player.avatar.rotation.y += shortAngleDiff * 0.2;

        // Animation
        if (player.avatar.leftLeg) {
            player.walkCycle = (player.walkCycle || 0) + (player.currentSpeed * 1.5);
            player.avatar.leftLeg.rotation.x = Math.sin(player.walkCycle) * 0.5;
            player.avatar.rightLeg.rotation.x = Math.sin(player.walkCycle + Math.PI) * 0.5;
            player.avatar.leftArm.rotation.x = Math.sin(player.walkCycle + Math.PI) * 0.5;
            player.avatar.rightArm.rotation.x = Math.sin(player.walkCycle) * 0.5;
            
            player.avatar.leftArm.rotation.x = Math.sin(player.walkCycle + Math.PI) * 0.5;
            player.avatar.rightArm.rotation.x = Math.sin(player.walkCycle) * 0.5;
        }
    } else {
        // Smooth Deceleration
        player.currentSpeed = (player.currentSpeed || 0) * (1 - DECELERATION);
        if (player.currentSpeed < 0.01) player.currentSpeed = 0;

        // Reset limbs and Idle "Breathing"
        if (player && player.avatar && player.avatar.leftLeg) {
            player.avatar.leftLeg.rotation.x *= 0.8;
            player.avatar.rightLeg.rotation.x *= 0.8;
            player.avatar.leftArm.rotation.x *= 0.8;
            player.avatar.rightArm.rotation.x *= 0.8;
            
            // Idle bobbing
            const idleRef = Date.now() * 0.003;
            player.avatar.position.y = Math.sin(idleRef) * 0.05;
            player.avatar.scale.y = 1 + Math.sin(idleRef) * 0.02;
        }
    }

    // Apply vertical velocity
    player.position.addScaledVector(upDirection, playerVelocity.y);
}

function updateCamera() {
    // Smooth orbit camera with dynamic tilt
    const orbitDistance = 15;
    const orbitHeight = 8;
    
    const up = player.position.clone().normalize();
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(player.quaternion);
    
    // Add a slight movement-based tilt
    const moveDir = new THREE.Vector3();
    if (keys.w || keys.arrowup) moveDir.z -= 1;
    if (keys.s || keys.arrowdown) moveDir.z += 1;
    if (keys.a || keys.arrowleft) moveDir.x -= 1;
    if (keys.d || keys.arrowright) moveDir.x += 1;

    let tiltOffset = new THREE.Vector3();
    if (moveDir.length() > 0) {
        moveDir.normalize();
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(player.quaternion);
        tiltOffset.addScaledVector(right, -moveDir.x * CAMERA_TILT_STRENGTH);
        tiltOffset.addScaledVector(back, -moveDir.z * CAMERA_TILT_STRENGTH);
    }
    
    const targetCamPos = player.position.clone()
        .addScaledVector(up, orbitHeight)
        .addScaledVector(back, orbitDistance)
        .add(tiltOffset);
    
    camera.position.lerp(targetCamPos, CAMERA_LAG);
    camera.lookAt(player.position.clone().addScaledVector(up, 2)); // Look slightly above the player
    camera.up.copy(up);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// =====================
// MOBILE CONTROLS
// =====================
function setupMobileControls() {
    // Strict mobile check: must have touch AND a small screen (avoids desktop touchscreens)
    const hasTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    const isSmallScreen = window.innerWidth <= 900;
    const isMobile = hasTouch && isSmallScreen;
    if (!isMobile) return;

    document.getElementById('mobile-controls').classList.remove('hidden');

    const joystickBase = document.getElementById('joystick-base');
    const joystickKnob = document.getElementById('joystick-knob');
    const JOYSTICK_MAX = 45; // max drag distance in px

    let touchId = null;
    let baseX = 0, baseY = 0;

    joystickBase.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.changedTouches[0];
        touchId = touch.identifier;
        const rect = joystickBase.getBoundingClientRect();
        baseX = rect.left + rect.width / 2;
        baseY = rect.top + rect.height / 2;
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        if (touchId === null) return;
        for (let touch of e.changedTouches) {
            if (touch.identifier !== touchId) continue;
            const dx = touch.clientX - baseX;
            const dy = touch.clientY - baseY;
            const dist = Math.min(Math.sqrt(dx * dx + dy * dy), JOYSTICK_MAX);
            const angle = Math.atan2(dy, dx);

            // Move knob visually
            joystickKnob.style.transform = `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px)`;

            // Map to keys using threshold
            const threshold = JOYSTICK_MAX * 0.3;
            keys['w'] = dy < -threshold;
            keys['s'] = dy > threshold;
            keys['a'] = dx < -threshold;
            keys['d'] = dx > threshold;
        }
    }, { passive: false });

    const clearJoystick = (e) => {
        for (let touch of e.changedTouches) {
            if (touch.identifier === touchId) {
                touchId = null;
                joystickKnob.style.transform = 'translate(0, 0)';
                keys['w'] = false; keys['s'] = false;
                keys['a'] = false; keys['d'] = false;
            }
        }
    };
    document.addEventListener('touchend', clearJoystick);
    document.addEventListener('touchcancel', clearJoystick);

    // Jump button
    document.getElementById('btn-jump').addEventListener('touchstart', (e) => {
        e.preventDefault();
        keys[' '] = true;
    });
    document.getElementById('btn-jump').addEventListener('touchend', () => {
        keys[' '] = false;
    });

    // Interact button (simulates pressing 'e')
    document.getElementById('btn-interact').addEventListener('touchstart', (e) => {
        e.preventDefault();
        // Trigger interact the same way the keyboard 'e' does
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    });
}

// Start everything
init();
setupMobileControls();

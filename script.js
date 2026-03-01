// ============================================================
//  PAIRPLANE 3D  –  Complete rewrite
// ============================================================

const CONFIG = {
    baseSpeed: 18,
    maxSpeed: 90,
    speedIncrease: 0.04,        // per second
    playWidth: 36,              // half-width of playable corridor (±)
    minAltitude: 2,
    maxAltitude: 28,
    nearMissDistance: 7,
    xpPerMeter: 1,
    xpNearMissBonus: 75,

    // Obstacle settings
    obstaclePoolSize: 80,
    obstacleLaneCount: 9,       // distribute across lanes
    spawnDepth: -280,           // how far ahead obstacles spawn
    recycleDepth: 25,           // how far behind player before recycling

    // Difficulty stages  [distanceThreshold, label, color]
    stages: [
        [0,    'EASY',     '#4ade80'],
        [300,  'MEDIUM',   '#facc15'],
        [700,  'HARD',     '#f97316'],
        [1200, 'INTENSE',  '#ef4444'],
        [2000, 'INSANE',   '#a855f7'],
    ]
};

// ============================================================
//  STORAGE & SAVE DATA
// ============================================================
const Storage = {
    key: 'pairplane3d_v2',
    load() {
        try {
            const d = localStorage.getItem(this.key);
            if (!d) return { xp: 0, unlocked: ['classic'], bestDist: 0 };
            return JSON.parse(d);
        } catch(e) { return { xp: 0, unlocked: ['classic'], bestDist: 0 }; }
    },
    save(data) {
        try { localStorage.setItem(this.key, JSON.stringify(data)); } catch(e) {}
    }
};

let SAVE = Storage.load();

// ============================================================
//  PLANE DEFINITIONS
// ============================================================
const PLANES = {
    classic: { name:'Classic', desc:'Balanced & reliable',     speed:1.0, handling:1.0, stability:1.0, color:0xf0e6cc, stripe:0xc8a878 },
    swift:   { name:'Swift',   desc:'Fast but twitchy',        speed:1.3, handling:1.4, stability:0.7, color:0xff7070, stripe:0xcc3333 },
    heavy:   { name:'Heavy',   desc:'Slow & very stable',      speed:0.85,handling:0.7, stability:1.6, color:0x80dd80, stripe:0x33aa33 },
    razor:   { name:'Razor',   desc:'Extreme speed & agility', speed:1.5, handling:1.5, stability:0.55,color:0x8888ff, stripe:0x3333cc },
    ghost:   { name:'Ghost',   desc:'Ghostly smooth glider',   speed:1.1, handling:1.2, stability:1.3, color:0xddeeff, stripe:0x88aacc },
};
const UNLOCK_COST = { swift:800, heavy:1800, razor:4000, ghost:7000 };

// ============================================================
//  OBSTACLE TYPES
// ============================================================
const OBS_TYPES = ['tree','rock','archway','balloon','bird'];

// ============================================================
//  GAME
// ============================================================
class Game {
    constructor() {
        this.canvas  = document.getElementById('game');
        this.uiRoot  = document.getElementById('ui');

        this.scene   = new THREE.Scene();
        this.camera  = new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.1, 800);
        this.camera.position.set(0, 18, 22);

        this.renderer = new THREE.WebGLRenderer({ canvas:this.canvas, antialias:true });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;

        window.addEventListener('resize', () => this.onResize());

        this.clock = new THREE.Clock();
        this.distance = 0;
        this.speed = CONFIG.baseSpeed;
        this.running = false;
        this.selectedPlane = 'classic';
        this.nearMissCooldown = new Set();
        this.stageIdx = 0;

        this.setupScene();
        this.setupTouchControls();
        this.initMenu();
    }

    setupScene() {
        // Sky gradient via fog + bg color
        this.scene.background = new THREE.Color(0x87ceeb);
        this.scene.fog = new THREE.Fog(0xb0d8f0, 80, 380);

        // Lighting
        const ambient = new THREE.AmbientLight(0x405070, 0.9);
        this.scene.add(ambient);

        const sun = new THREE.DirectionalLight(0xfff0d0, 1.6);
        sun.position.set(60, 120, 40);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.left   = -300;
        sun.shadow.camera.right  =  300;
        sun.shadow.camera.top    =  300;
        sun.shadow.camera.bottom = -300;
        sun.shadow.camera.far    = 600;
        sun.shadow.bias = -0.0003;
        this.scene.add(sun);

        const fill = new THREE.HemisphereLight(0x88aaff, 0x224422, 0.4);
        this.scene.add(fill);

        // Ground
        const groundGeo = new THREE.PlaneGeometry(1200, 1200, 40, 40);
        const groundMat = new THREE.MeshStandardMaterial({
            color: 0x2a6b35,
            roughness: 0.95,
            metalness: 0.0,
        });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // Subtle ground grid
        const grid = new THREE.GridHelper(1200, 60, 0x1a4a20, 0x1a4a20);
        grid.position.y = 0.05;
        grid.material.transparent = true;
        grid.material.opacity = 0.3;
        this.scene.add(grid);

        // Distant mountain silhouettes
        this.addMountains();

        // Cloud layer
        this.clouds = [];
        this.addClouds();
    }

    addMountains() {
        const mat = new THREE.MeshStandardMaterial({ color: 0x3a5a40, roughness:1 });
        for (let i = 0; i < 18; i++) {
            const h = 40 + Math.random() * 80;
            const geo = new THREE.ConeGeometry(h * 0.6, h, 5 + Math.floor(Math.random()*4));
            const m = new THREE.Mesh(geo, mat);
            const side = Math.random() > 0.5 ? 1 : -1;
            m.position.set(
                side * (220 + Math.random() * 200),
                h * 0.5 - 5,
                -(Math.random() * 400 + 50)
            );
            m.rotation.y = Math.random() * Math.PI;
            this.scene.add(m);
        }
    }

    addClouds() {
        const cloudMat = new THREE.MeshStandardMaterial({ color:0xffffff, transparent:true, opacity:0.85, roughness:1 });
        for (let i = 0; i < 30; i++) {
            const group = new THREE.Group();
            const blobCount = 3 + Math.floor(Math.random() * 4);
            for (let b = 0; b < blobCount; b++) {
                const r = 5 + Math.random() * 8;
                const geo = new THREE.SphereGeometry(r, 7, 5);
                const mesh = new THREE.Mesh(geo, cloudMat);
                mesh.position.set((Math.random()-0.5)*r*2, (Math.random()-0.5)*r*0.5, (Math.random()-0.5)*r*2);
                group.add(mesh);
            }
            group.position.set(
                (Math.random()-0.5) * 400,
                28 + Math.random() * 20,
                -(Math.random() * 600)
            );
            group.scale.setScalar(0.8 + Math.random() * 0.6);
            this.scene.add(group);
            this.clouds.push(group);
        }
    }

    setupTouchControls() {
        const map = {
            'touch-left':  'left',
            'touch-right': 'right',
            'touch-up':    'up',
            'touch-down':  'down'
        };
        Object.entries(map).forEach(([id, dir]) => {
            const el = document.getElementById(id);
            el.addEventListener('touchstart', e => { e.preventDefault(); if(this.player) this.player.input[dir]=true; }, {passive:false});
            el.addEventListener('touchend',   e => { e.preventDefault(); if(this.player) this.player.input[dir]=false; }, {passive:false});
        });
    }

    start() {
        // Remove old scene objects (keep lights & ground)
        this.scene.children.slice().forEach(c => {
            if (c !== undefined) this.scene.remove(c);
        });
        this.clouds = [];
        this.setupScene();

        this.world  = new World(this.scene);
        this.player = new Player(this.scene, PLANES[this.selectedPlane]);
        this.effects= new Effects(this.scene, this.uiRoot);

        this.distance = 0;
        this.speed    = CONFIG.baseSpeed * PLANES[this.selectedPlane].speed;
        this.running  = true;
        this.stageIdx = 0;
        this.nearMissCooldown.clear();

        this.camVel = new THREE.Vector3();

        this.uiRoot.innerHTML = `
            <div class="hud" id="hud"></div>
            <div class="diff-badge" id="diffBadge">EASY</div>
        `;

        this.loop();
    }

    gameOver() {
        this.running = false;
        this.player.crash(this.effects);

        const xpEarned = Math.floor(this.distance * CONFIG.xpPerMeter);
        const isBest   = this.distance > (SAVE.bestDist || 0);
        if (isBest) SAVE.bestDist = Math.floor(this.distance);
        SAVE.xp += xpEarned;

        Object.keys(UNLOCK_COST).forEach(p => {
            if (!SAVE.unlocked.includes(p) && SAVE.xp >= UNLOCK_COST[p])
                SAVE.unlocked.push(p);
        });
        Storage.save(SAVE);

        const dist = Math.floor(this.distance);

        setTimeout(() => {
            this.uiRoot.innerHTML = `
                <div class="overlay">
                    <div class="glass-card" style="text-align:left; min-width:340px;">
                        <h1 style="font-size:2rem;text-align:center;margin-bottom:4px;">CRASHED</h1>
                        <p class="subtitle" style="text-align:center;">BETTER LUCK NEXT TIME</p>
                        <div class="stat-row"><span>Distance</span><span class="val">${dist} m</span></div>
                        <div class="stat-row"><span>XP Earned</span><span class="val">+${xpEarned}</span></div>
                        <div class="stat-row"><span>Total XP</span><span class="val">${SAVE.xp}</span></div>
                        <div class="stat-row"><span>Best Run</span><span class="val">${SAVE.bestDist} m ${isBest ? '🏆 NEW BEST!' : ''}</span></div>
                        <div style="height:16px;"></div>
                        <button class="primary-btn" onclick="game.start()">FLY AGAIN</button>
                        <button onclick="game.initMenu()">MAIN MENU</button>
                    </div>
                </div>
            `;
        }, 600);
    }

    loop() {
        if (!this.running) return;
        requestAnimationFrame(() => this.loop());

        const delta = Math.min(this.clock.getDelta(), 0.05);

        // Speed ramp
        const plane = PLANES[this.selectedPlane];
        this.speed = Math.min(
            CONFIG.maxSpeed,
            this.speed + CONFIG.speedIncrease * plane.speed * delta * 60
        );

        // Stage check
        const stages = CONFIG.stages;
        for (let i = stages.length - 1; i >= 0; i--) {
            if (this.distance >= stages[i][0]) {
                if (this.stageIdx !== i) {
                    this.stageIdx = i;
                    const badge = document.getElementById('diffBadge');
                    if (badge) {
                        badge.textContent = stages[i][1];
                        badge.style.color = stages[i][2];
                        badge.style.borderColor = stages[i][2] + '55';
                    }
                }
                break;
            }
        }

        // Difficulty multiplier (obstacle density)
        const diffMult = 1 + this.stageIdx * 0.4;

        this.player.update(delta, this.speed, CONFIG);
        this.world.update(this.player, this.speed, delta, diffMult);
        this.checkNearMisses();

        // Clouds drift
        this.clouds.forEach(c => { c.position.z += this.speed * delta * 0.15; if (c.position.z > 100) c.position.z = -600; });

        // Camera — smooth chase with slight lag for feel
        const px = this.player.mesh.position.x;
        const py = this.player.mesh.position.y;
        const pz = this.player.mesh.position.z;

        const desiredCam = new THREE.Vector3(
            px * 0.25,
            py + 4 + Math.abs(this.player.velocity.x) * 0.1,
            pz + 18
        );
        this.camera.position.lerp(desiredCam, 0.06);
        const lookTarget = new THREE.Vector3(px * 0.4, py + 1, pz - 20);
        this.camera.lookAt(lookTarget);

        this.distance += this.speed * delta;

        // Collision
        if (this.world.checkCollision(this.player)) {
            this.gameOver();
            return;
        }

        // Ground / ceiling kill
        if (this.player.mesh.position.y < 1.5 || this.player.mesh.position.y > CONFIG.maxAltitude + 1) {
            this.gameOver();
            return;
        }

        this.updateHUD();
        this.renderer.render(this.scene, this.camera);
    }

    checkNearMisses() {
        if (!this.player || !this.world) return;
        for (const obs of this.world.obstacles) {
            if (!obs.active || this.nearMissCooldown.has(obs)) continue;
            const d = obs.mesh.position.distanceTo(this.player.mesh.position);
            if (d < CONFIG.nearMissDistance && d > 3.5) {
                SAVE.xp += CONFIG.xpNearMissBonus;
                this.nearMissCooldown.add(obs);
                this.effects.nearMissFlash();
                this.effects.showNearMissText();
                setTimeout(() => this.nearMissCooldown.delete(obs), 3000);
            }
        }
    }

    updateHUD() {
        const hud = document.getElementById('hud');
        if (!hud) return;
        const alt = this.player.mesh.position.y.toFixed(0);
        const spd = Math.floor(this.speed * 3.6);
        const dist = Math.floor(this.distance);
        hud.innerHTML = `
            <span style="color:rgba(150,200,255,0.6);font-size:0.78rem;">DISTANCE</span><br>
            <span class="hud-val" style="font-size:1.4rem;font-family:'Orbitron',sans-serif;">${dist}m</span><br><br>
            <span style="color:rgba(150,200,255,0.6);font-size:0.78rem;">SPEED</span>&nbsp;
            <span class="hud-val">${spd}</span> <span style="color:rgba(150,200,255,0.5);font-size:0.8rem;">km/h</span><br>
            <span style="color:rgba(150,200,255,0.6);font-size:0.78rem;">ALTITUDE</span>&nbsp;
            <span class="hud-val">${alt}</span> <span style="color:rgba(150,200,255,0.5);font-size:0.8rem;">m</span><br>
            <span style="color:rgba(150,200,255,0.6);font-size:0.78rem;">XP</span>&nbsp;
            <span class="hud-val">${SAVE.xp}</span>
        `;

        // Warn near ground
        if (this.player.mesh.position.y < 6 || this.player.mesh.position.y > CONFIG.maxAltitude - 4) {
            hud.classList.add('danger');
        } else {
            hud.classList.remove('danger');
        }
    }

    initMenu() {
        this.running = false;
        this.uiRoot.innerHTML = `
            <div class="menu">
                <div class="glass-card">
                    <h1>PAIRPLANE</h1>
                    <p class="subtitle">3 D &nbsp; F L I G H T</p>
                    <div class="xp-display">✦ TOTAL XP &nbsp; <span>${SAVE.xp}</span> &nbsp; ✦ BEST &nbsp; <span>${SAVE.bestDist}m</span></div>
                    <button class="primary-btn" onclick="game.start()">▶ &nbsp; FLY NOW</button>
                    <button onclick="game.planeMenu()">✈ &nbsp; SELECT PLANE</button>
                    <button onclick="game.howToPlay()">? &nbsp; HOW TO PLAY</button>
                    <button onclick="game.reset()" style="opacity:0.5;font-size:0.78rem;padding:8px;margin-top:8px;">RESET PROGRESS</button>
                </div>
            </div>
        `;
        // Render scene in background
        const renderBg = () => {
            if (this.running) return;
            requestAnimationFrame(renderBg);
            this.renderer.render(this.scene, this.camera);
        };
        renderBg();
    }

    planeMenu() {
        let cards = '';
        Object.entries(PLANES).forEach(([key, p]) => {
            const unlocked = SAVE.unlocked.includes(key);
            const selected = this.selectedPlane === key;
            const cost = UNLOCK_COST[key];
            const canBuy = !unlocked && SAVE.xp >= cost;
            const colorHex = '#' + p.color.toString(16).padStart(6,'0');

            let actionBtn = '';
            if (!unlocked) {
                actionBtn = `<button ${canBuy?'':'disabled'} onclick="game.unlock('${key}')"
                    style="${canBuy ? '' : ''}">${cost} XP</button>`;
            } else if (selected) {
                actionBtn = `<button style="border-color:rgba(79,172,254,0.6);color:#7dd3fc;" disabled>✓ ACTIVE</button>`;
            } else {
                actionBtn = `<button onclick="game.selectPlane('${key}')">SELECT</button>`;
            }

            cards += `
                <div class="plane-card ${selected?'selected':''}">
                    <div style="width:28px;height:28px;border-radius:50%;background:${colorHex};box-shadow:0 0 10px ${colorHex}66;flex-shrink:0;"></div>
                    <div class="plane-info" style="flex:1;">
                        <div class="plane-name">${p.name}</div>
                        <div class="plane-stats">SPD ${(p.speed*100).toFixed(0)} · HDL ${(p.handling*100).toFixed(0)} · STB ${(p.stability*100).toFixed(0)}</div>
                        <div class="plane-stats" style="color:rgba(150,200,255,0.4)">${p.desc}</div>
                    </div>
                    <div class="plane-action">${actionBtn}</div>
                </div>
            `;
        });

        this.uiRoot.innerHTML = `
            <div class="menu">
                <div class="glass-card" style="max-width:520px;">
                    <h1 style="font-size:1.8rem;">SELECT PLANE</h1>
                    <p class="subtitle">XP: ${SAVE.xp}</p>
                    <div class="plane-grid">${cards}</div>
                    <div style="height:12px;"></div>
                    <button onclick="game.initMenu()">← BACK</button>
                </div>
            </div>
        `;
    }

    selectPlane(key) {
        this.selectedPlane = key;
        this.planeMenu();
    }

    unlock(key) {
        if (SAVE.xp < UNLOCK_COST[key]) return;
        SAVE.xp -= UNLOCK_COST[key];
        SAVE.unlocked.push(key);
        Storage.save(SAVE);
        this.planeMenu();
    }

    howToPlay() {
        this.uiRoot.innerHTML = `
            <div class="menu">
                <div class="glass-card">
                    <h1 style="font-size:2rem;">HOW TO PLAY</h1>
                    <p class="subtitle">CONTROLS</p>
                    <div class="stat-row"><span>W / ↑</span><span class="val">Climb</span></div>
                    <div class="stat-row"><span>S / ↓</span><span class="val">Dive</span></div>
                    <div class="stat-row"><span>A / ←</span><span class="val">Bank Left</span></div>
                    <div class="stat-row"><span>D / →</span><span class="val">Bank Right</span></div>
                    <div style="height:16px;"></div>
                    <div class="stat-row"><span>Avoid</span><span class="val">Trees, Rocks, Arches, Balloons, Birds</span></div>
                    <div class="stat-row"><span>Near Misses</span><span class="val">+${CONFIG.xpNearMissBonus} XP Bonus</span></div>
                    <div class="stat-row"><span>Difficulty</span><span class="val">Increases with distance</span></div>
                    <div style="height:16px;"></div>
                    <button onclick="game.initMenu()">← BACK</button>
                </div>
            </div>
        `;
    }

    reset() {
        if (!confirm('Reset ALL progress? This cannot be undone.')) return;
        localStorage.removeItem(Storage.key);
        location.reload();
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

// ============================================================
//  PLAYER
// ============================================================
class Player {
    constructor(scene, stats) {
        this.stats = stats;
        this.velocity = new THREE.Vector3();
        this.input = { left:false, right:false, up:false, down:false };
        this.wobble = 0;
        this.rollAngle = 0;
        this.pitchAngle = 0;

        this.mesh = this.buildPaperPlane(stats.color, stats.stripe);
        this.mesh.position.set(0, 14, 0);
        scene.add(this.mesh);

        // Trail particles
        this.trailGeo = new THREE.BufferGeometry();
        this.trailPositions = new Float32Array(60 * 3);
        this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
        this.trailMat = new THREE.PointsMaterial({ color:0xaaddff, size:0.25, transparent:true, opacity:0.5 });
        this.trail = new THREE.Points(this.trailGeo, this.trailMat);
        scene.add(this.trail);
        this.trailHead = 0;

        this._keyDown = e => this.key(e, true);
        this._keyUp   = e => this.key(e, false);
        window.addEventListener('keydown', this._keyDown);
        window.addEventListener('keyup',   this._keyUp);
    }

    buildPaperPlane(mainColor, stripeColor) {
        const group = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({
            color: mainColor,
            roughness: 0.25,
            metalness: 0.0,
            side: THREE.DoubleSide,
        });
        const accentMat = new THREE.MeshStandardMaterial({
            color: stripeColor,
            roughness: 0.2,
            metalness: 0.05,
            side: THREE.DoubleSide,
        });

        // ── Left wing panel (flat triangle)
        const lw = new THREE.BufferGeometry();
        lw.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
            0,  0.05,  2.2,   // nose tip
           -4.5,-0.3, -1.8,  // left wingtip
            0,  0.3,  -1.4,  // centre back
        ]), 3));
        lw.computeVertexNormals();
        group.add(new THREE.Mesh(lw, mat));

        // ── Right wing panel
        const rw = new THREE.BufferGeometry();
        rw.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
            0,  0.05,  2.2,
            4.5,-0.3, -1.8,
            0,  0.3,  -1.4,
        ]), 3));
        rw.computeVertexNormals();
        group.add(new THREE.Mesh(rw, mat));

        // ── Left underfold (gives it depth/shadow)
        const luf = new THREE.BufferGeometry();
        luf.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
            0,  0.05,  2.2,
           -4.5,-0.3, -1.8,
            0, -0.2,  -1.0,
        ]), 3));
        luf.computeVertexNormals();
        group.add(new THREE.Mesh(luf, accentMat));

        // ── Right underfold
        const ruf = new THREE.BufferGeometry();
        ruf.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
            0,  0.05,  2.2,
            4.5,-0.3, -1.8,
            0, -0.2,  -1.0,
        ]), 3));
        ruf.computeVertexNormals();
        group.add(new THREE.Mesh(ruf, accentMat));

        // ── Center ridge / spine (thin box)
        const spineGeo = new THREE.BoxGeometry(0.12, 0.55, 3.8);
        const spine = new THREE.Mesh(spineGeo, accentMat);
        spine.position.set(0, 0.18, 0.4);
        spine.rotation.x = -0.05;
        group.add(spine);

        // ── Tail fin (small vertical triangle)
        const tf = new THREE.BufferGeometry();
        tf.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
            0,  0.35, -1.4,
            0,  0.9,  -2.0,
            0,  0.35, -2.4,
        ]), 3));
        tf.computeVertexNormals();
        group.add(new THREE.Mesh(tf, mat));

        // ── Shadow catcher (invisible, for correct shadow shape)
        const planeGeo = new THREE.PlaneGeometry(9, 4.5);
        const planeShadow = new THREE.Mesh(planeGeo, new THREE.MeshStandardMaterial({ visible:false }));
        planeShadow.rotation.x = Math.PI / 2;
        planeShadow.castShadow = true;
        group.add(planeShadow);

        group.castShadow = true;
        group.scale.setScalar(1.1);
        return group;
    }

    key(e, down) {
        if (e.key === 'a' || e.key === 'ArrowLeft')  this.input.left  = down;
        if (e.key === 'd' || e.key === 'ArrowRight') this.input.right = down;
        if (e.key === 'w' || e.key === 'ArrowUp')    this.input.up    = down;
        if (e.key === 's' || e.key === 'ArrowDown')  this.input.down  = down;
    }

    update(delta, speed, config) {
        const h = this.stats.handling * 14;
        const drag = 1 - (0.08 * this.stats.stability * delta * 60);

        if (this.input.left)  this.velocity.x -= h * delta;
        if (this.input.right) this.velocity.x += h * delta;
        if (this.input.up)    this.velocity.y += h * delta;
        if (this.input.down)  this.velocity.y -= h * delta;

        // Gravity / glide drag
        this.velocity.y -= 2.5 * delta;                // gentle gravity
        this.velocity.x *= Math.pow(drag, 1);
        this.velocity.y *= Math.pow(drag, 0.95);

        // Apply
        this.mesh.position.x += this.velocity.x * delta * 18;
        this.mesh.position.y += this.velocity.y * delta * 18;

        // Hard clamp on X — player cannot escape the obstacle corridor
        const maxX = config.playWidth;
        this.mesh.position.x = Math.max(-maxX, Math.min(maxX, this.mesh.position.x));

        // Altitude clamp (with bounce)
        if (this.mesh.position.y < config.minAltitude + 1) {
            this.mesh.position.y = config.minAltitude + 1;
            if (this.velocity.y < 0) this.velocity.y = 0;
        }
        if (this.mesh.position.y > config.maxAltitude - 1) {
            this.mesh.position.y = config.maxAltitude - 1;
            if (this.velocity.y > 0) this.velocity.y = 0;
        }

        // Wobble
        this.wobble += delta * 2.5;
        this.mesh.position.x += Math.sin(this.wobble * 1.3) * 0.03;
        this.mesh.position.y += Math.sin(this.wobble) * 0.02;

        // Realistic roll / pitch
        const targetRoll  = -this.velocity.x * 0.16;
        const targetPitch =  this.velocity.y * 0.10;
        this.rollAngle  += (targetRoll  - this.rollAngle)  * 0.12;
        this.pitchAngle += (targetPitch - this.pitchAngle) * 0.12;

        this.mesh.rotation.z = this.rollAngle;
        this.mesh.rotation.x = -0.08 + this.pitchAngle;
        this.mesh.rotation.y = this.velocity.x * 0.03;

        // Trail
        const tp = this.trailPositions;
        const h3 = this.trailHead * 3;
        tp[h3]   = this.mesh.position.x;
        tp[h3+1] = this.mesh.position.y;
        tp[h3+2] = this.mesh.position.z;
        this.trailHead = (this.trailHead + 1) % 60;
        this.trailGeo.attributes.position.needsUpdate = true;
    }

    crash(effects) {
        effects.explosion(this.mesh.position.clone());
        this.mesh.visible = false;
        window.removeEventListener('keydown', this._keyDown);
        window.removeEventListener('keyup', this._keyUp);
    }
}

// ============================================================
//  OBSTACLE DEFINITIONS
// ============================================================
function buildTree() {
    const g = new THREE.Group();
    const trunkH = 14 + Math.random() * 12;
    const variant = Math.floor(Math.random() * 3);

    // Trunk
    const trunkGeo = new THREE.CylinderGeometry(0.6, 1.1, trunkH, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b3d1e, roughness:0.9 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    g.add(trunk);

    const leafColor = [0x2d7a3e, 0x1d6b2e, 0x3a8a50][variant];
    const leafMat = new THREE.MeshStandardMaterial({ color: leafColor, roughness:0.95 });

    if (variant === 0) {
        // Round deciduous
        for (let i = 0; i < 4; i++) {
            const r = 2.5 + Math.random() * 1.5;
            const leaf = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 6), leafMat);
            leaf.position.set((Math.random()-0.5)*3, trunkH + i*1.2 - 2, (Math.random()-0.5)*3);
            leaf.castShadow = true;
            g.add(leaf);
        }
    } else if (variant === 1) {
        // Pine – layered cones
        for (let i = 0; i < 4; i++) {
            const cone = new THREE.Mesh(
                new THREE.ConeGeometry(3.5 - i*0.5, 4.5, 7),
                leafMat
            );
            cone.position.y = trunkH - 2 + i * 3;
            cone.castShadow = true;
            g.add(cone);
        }
    } else {
        // Sparse canopy with merged spheres
        const big = new THREE.Mesh(new THREE.SphereGeometry(3.2, 8, 6), leafMat);
        big.position.y = trunkH + 2;
        big.castShadow = true;
        g.add(big);
        for (let i = 0; i < 3; i++) {
            const sm = new THREE.Mesh(new THREE.SphereGeometry(1.8, 6, 5), leafMat);
            const angle = (i/3) * Math.PI * 2;
            sm.position.set(Math.cos(angle)*2.5, trunkH + 1 + Math.random()*2, Math.sin(angle)*2.5);
            g.add(sm);
        }
    }
    g.userData.radius = 2.2;
    g.userData.type   = 'tree';
    return g;
}

function buildRock() {
    const g = new THREE.Group();
    const h = 12 + Math.random() * 18;
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness:0.95, metalness:0.05 });

    // Main spire
    const geo = new THREE.CylinderGeometry(1.2 + Math.random(), 2.5 + Math.random(), h, 5 + Math.floor(Math.random()*3));
    const m = new THREE.Mesh(geo, mat);
    m.position.y = h / 2;
    m.rotation.y = Math.random() * Math.PI;
    m.castShadow = true;
    g.add(m);

    // Secondary rocks
    for (let i = 0; i < 2; i++) {
        const sh = h * (0.4 + Math.random() * 0.4);
        const sm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.6, 1.5, sh, 5),
            mat
        );
        const a = Math.random() * Math.PI * 2;
        sm.position.set(Math.cos(a)*1.8, sh/2, Math.sin(a)*1.8);
        sm.rotation.y = Math.random() * Math.PI;
        sm.castShadow = true;
        g.add(sm);
    }
    g.userData.radius = 2.8;
    g.userData.type   = 'rock';
    return g;
}

function buildArchway() {
    const g = new THREE.Group();
    const w = 8 + Math.random() * 4;
    const h = 10 + Math.random() * 8;
    const mat = new THREE.MeshStandardMaterial({ color: 0xc8a060, roughness:0.8, metalness:0.1 });

    // Left pillar
    const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, h, 8), mat);
    lp.position.set(-w/2, h/2, 0);
    lp.castShadow = true; g.add(lp);

    // Right pillar
    const rp = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, h, 8), mat);
    rp.position.set(w/2, h/2, 0);
    rp.castShadow = true; g.add(rp);

    // Horizontal beam
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 1.6, 1.2, 1.4), mat);
    beam.position.set(0, h + 0.6, 0);
    beam.castShadow = true; g.add(beam);

    // Deadly top cap (player must go through gap)
    g.userData.radius   = 1.5;     // collision radius for pillars
    g.userData.halfGap  = w / 2 - 1.5;
    g.userData.gapTop   = h + 1.5;
    g.userData.type     = 'archway';
    g.userData.archW    = w;
    g.userData.archH    = h;
    return g;
}

function buildBalloon() {
    const g = new THREE.Group();
    const colors = [0xff3333, 0xffaa00, 0xcc44ff, 0xff69b4];
    const col = colors[Math.floor(Math.random() * colors.length)];
    const mat = new THREE.MeshStandardMaterial({ color:col, roughness:0.3, metalness:0.1 });

    // Balloon sphere
    const balloon = new THREE.Mesh(new THREE.SphereGeometry(2.8, 10, 8), mat);
    balloon.position.y = 3;
    balloon.castShadow = true;
    g.add(balloon);

    // Basket
    const bmat = new THREE.MeshStandardMaterial({ color:0x8b5e2e, roughness:0.9 });
    const basket = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.4), bmat);
    basket.position.y = -0.2;
    basket.castShadow = true;
    g.add(basket);

    // Rope
    const ropeMat = new THREE.LineBasicMaterial({ color:0x888888 });
    const ropes = [[-0.5,0.4,-0.5],[0.5,0.4,-0.5],[-0.5,0.4,0.5],[0.5,0.4,0.5]];
    ropes.forEach(([x,,z]) => {
        const pts = [new THREE.Vector3(x,-0.2,z), new THREE.Vector3(0,2.8,0)];
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        g.add(new THREE.Line(lineGeo, ropeMat));
    });

    g.userData.radius = 3.2;
    g.userData.type   = 'balloon';
    g.userData.floatPhase = Math.random() * Math.PI * 2;
    g.userData.floatAmp   = 2 + Math.random() * 2;
    g.userData.floatSpeed = 0.8 + Math.random() * 0.6;
    return g;
}

function buildBirdFlock() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color:0x1a1a1a, roughness:0.8, side:THREE.DoubleSide });

    for (let i = 0; i < 6 + Math.floor(Math.random()*5); i++) {
        const bird = new THREE.Group();

        // Simple V-wing silhouette
        const lw2 = new THREE.BufferGeometry();
        lw2.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
            0, 0, 0,
           -1.2, 0.2, -0.5,
           -0.5, 0, -0.1
        ]), 3));
        lw2.computeVertexNormals();
        bird.add(new THREE.Mesh(lw2, mat));

        const rw2 = new THREE.BufferGeometry();
        rw2.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
            0, 0, 0,
            1.2, 0.2, -0.5,
            0.5, 0, -0.1
        ]), 3));
        rw2.computeVertexNormals();
        bird.add(new THREE.Mesh(rw2, mat));

        bird.position.set(
            (Math.random()-0.5) * 12,
            (Math.random()-0.5) * 6,
            (Math.random()-0.5) * 8
        );
        bird.userData.wingPhase = Math.random() * Math.PI * 2;
        g.add(bird);
    }
    g.userData.radius = 5;
    g.userData.type   = 'flock';
    g.userData.driftX = (Math.random()-0.5) * 8;  // flock drift speed
    g.userData.driftY = (Math.random()-0.5) * 4;
    g.userData.t      = 0;
    return g;
}

// ============================================================
//  WORLD
// ============================================================
class World {
    constructor(scene) {
        this.scene = scene;
        this.obstacles = [];
        this.time = 0;

        // Pre-build obstacle pool
        for (let i = 0; i < CONFIG.obstaclePoolSize; i++) {
            const type = OBS_TYPES[i % OBS_TYPES.length];
            const mesh = this.buildObs(type);
            mesh.position.z = -9999;  // park far away
            scene.add(mesh);
            this.obstacles.push({ mesh, active:false, type });
        }
    }

    buildObs(type) {
        switch(type) {
            case 'tree':    return buildTree();
            case 'rock':    return buildRock();
            case 'archway': return buildArchway();
            case 'balloon': return buildBalloon();
            case 'bird':    return buildBirdFlock();
            default:        return buildTree();
        }
    }

    getInactive() {
        for (const o of this.obstacles) if (!o.active) return o;
        return null;
    }

    spawnObstacle(playerZ, diffMult) {
        const o = this.getInactive();
        if (!o) return;

        const type = OBS_TYPES[Math.floor(Math.random() * OBS_TYPES.length)];

        // Remove old mesh, build new
        this.scene.remove(o.mesh);
        o.mesh = this.buildObs(type);
        o.type = type;
        this.scene.add(o.mesh);

        // X: spread fully across play width — no safe side zones
        const hw = CONFIG.playWidth - 3;
        const x = (Math.random() - 0.5) * 2 * hw;

        let y = 0;
        if (type === 'balloon') {
            y = 8 + Math.random() * 12;  // float at altitude
        } else if (type === 'flock') {
            y = 6 + Math.random() * 16;
        } else if (type === 'archway') {
            y = 0;
        }

        o.mesh.position.set(x, y, playerZ + CONFIG.spawnDepth);
        o.active = true;
        o.mesh.visible = true;
    }

    update(player, speed, delta, diffMult) {
        this.time += delta;

        const move = speed * delta;

        // Active obstacle updates
        for (const o of this.obstacles) {
            if (!o.active) continue;
            o.mesh.position.z += move;

            // Balloon float
            if (o.type === 'balloon') {
                const fp = o.mesh.userData.floatPhase;
                const fa = o.mesh.userData.floatAmp;
                const fs = o.mesh.userData.floatSpeed;
                o.mesh.position.y += Math.sin(this.time * fs + fp) * fa * delta;
                o.mesh.rotation.y += delta * 0.3;
            }

            // Bird flock flap & drift
            if (o.type === 'flock') {
                o.mesh.userData.t += delta;
                const t = o.mesh.userData.t;
                o.mesh.position.x += o.mesh.userData.driftX * delta;
                o.mesh.position.y += o.mesh.userData.driftY * delta * 0.3;
                o.mesh.children.forEach(bird => {
                    bird.userData.wingPhase = (bird.userData.wingPhase || 0) + delta * 5;
                    bird.rotation.z = Math.sin(bird.userData.wingPhase) * 0.4;
                });
            }

            // Recycle when behind player
            if (o.mesh.position.z > player.mesh.position.z + CONFIG.recycleDepth) {
                o.active = false;
                o.mesh.position.z = -9999;
            }
        }

        // Spawn rate based on difficulty
        const baseInterval = 0.55;
        const spawnInterval = Math.max(0.18, baseInterval / diffMult);

        if (!this._nextSpawn) this._nextSpawn = 0;
        if (this.time > this._nextSpawn) {
            // Spawn 1–3 obstacles at once at higher difficulties
            const burst = 1 + Math.floor(diffMult * 0.6);
            for (let b = 0; b < burst; b++) {
                this.spawnObstacle(player.mesh.position.z, diffMult);
            }
            this._nextSpawn = this.time + spawnInterval + (Math.random() * 0.3);
        }
    }

    checkCollision(player) {
        const p = player.mesh.position;

        for (const o of this.obstacles) {
            if (!o.active) return false; // skip, but never return early on whole loop
        }

        for (const o of this.obstacles) {
            if (!o.active) continue;
            const t = o.mesh.position;
            const dz = Math.abs(p.z - t.z);
            if (dz > 30) continue;  // quick Z cull

            if (o.type === 'archway') {
                const dx = Math.abs(p.x - t.x);
                const hw  = o.mesh.userData.archW / 2;
                const topH = o.mesh.userData.archH;
                // Collision if player is inside arch zone
                if (dz < 3) {
                    // Hit left pillar
                    if (p.x < t.x - hw + 2.5 || p.x > t.x + hw - 2.5) {
                        // Outside gap — hit pillar
                        if (p.y < topH + 1) return true;
                    }
                    // Hit beam above gap
                    if (p.y > topH - 0.5) return true;
                }
                continue;
            }

            const r = o.mesh.userData.radius || 3;
            const dx = p.x - t.x;
            const dy = p.y - t.y;
            const dist2D = Math.sqrt(dx*dx + dz*dz);

            if (o.type === 'flock') {
                // Sphere collision for flock
                const dy3 = p.y - t.y;
                if (Math.sqrt(dx*dx + dy3*dy3 + dz*dz) < r * 1.2) return true;
                continue;
            }

            if (dist2D < r) {
                // Check height
                const obsTop = t.y + (o.type === 'balloon' ? 6 : 22);
                if (p.y > t.y - 1 && p.y < obsTop) return true;
            }
        }
        return false;
    }
}

// ============================================================
//  EFFECTS
// ============================================================
class Effects {
    constructor(scene, uiRoot) {
        this.scene   = scene;
        this.uiRoot  = uiRoot;
        this.particles = [];
    }

    nearMissFlash() {
        document.body.classList.add('flash');
        setTimeout(() => document.body.classList.remove('flash'), 250);
    }

    showNearMissText() {
        const el = document.createElement('div');
        el.className = 'near-miss-popup';
        el.textContent = '✦ NEAR MISS! +' + CONFIG.xpNearMissBonus + ' XP';
        this.uiRoot.appendChild(el);
        setTimeout(() => el.remove(), 1300);
    }

    explosion(position) {
        const count = 35;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            pos[i*3]   = position.x + (Math.random()-0.5) * 4;
            pos[i*3+1] = position.y + (Math.random()-0.5) * 4;
            pos[i*3+2] = position.z + (Math.random()-0.5) * 4;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

        const mat = new THREE.PointsMaterial({ color:0xffaa00, size:0.7, transparent:true });
        const pts = new THREE.Points(geo, mat);
        this.scene.add(pts);

        // Animate fade
        let t = 0;
        const fade = () => {
            t += 0.03;
            mat.opacity = 1 - t;
            if (t < 1) requestAnimationFrame(fade);
            else this.scene.remove(pts);
        };
        requestAnimationFrame(fade);
    }
}

// ============================================================
//  INIT
// ============================================================
const game = new Game();

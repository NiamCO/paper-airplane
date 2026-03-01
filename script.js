// ================= CONFIG =================
const CONFIG = {
    baseSpeed: 20,
    speedIncrease: 0.002,
    forestWidth: 300,               // wider forest
    treeCount: 300,                 // more trees
    nearMissDistance: 8,            // increased for better feedback
    xpPerMeter: 1,
    xpNearMissBonus: 50,
    minAltitude: 2,                  // ground level
    maxAltitude: 30,                 // ceiling
    treeHeight: 20,                  // tall trees
    treeRadius: 2.5
};

// ================= STORAGE =================
const Storage = {
    key: "pairplane3d_save",
    load() {
        const data = localStorage.getItem(this.key);
        if (!data) return { xp: 0, unlocked: ["classic"] };
        return JSON.parse(data);
    },
    save(data) {
        localStorage.setItem(this.key, JSON.stringify(data));
    }
};

let SAVE = Storage.load();

// ================= PLANES =================
const PLANES = {
    classic: { name: "Classic", speed: 1, handling: 1, stability: 1, color: 0xffdd99 },
    swift: { name: "Swift", speed: 1.2, handling: 1.2, stability: 0.8, color: 0xff6666 },
    heavy: { name: "Heavy", speed: 0.9, handling: 0.7, stability: 1.4, color: 0x66cc66 },
    razor: { name: "Razor", speed: 1.4, handling: 1.3, stability: 0.6, color: 0x6666ff },
    ghost: { name: "Ghost", speed: 1.1, handling: 1.1, stability: 1.2, color: 0xccccff }
};

const UNLOCK_COST = {
    swift: 1000,
    heavy: 2000,
    razor: 4000,
    ghost: 7000
};

// ================= GAME CLASS =================
class Game {
    constructor() {
        this.canvas = document.getElementById("game");
        this.uiRoot = document.getElementById("ui");

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb);
        this.scene.fog = new THREE.Fog(0x87ceeb, 100, 500);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 15, 20);

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        window.addEventListener("resize", () => this.onResize());

        this.clock = new THREE.Clock();

        this.setupLighting();
        this.world = new World(this.scene);
        this.player = null;
        this.effects = new Effects(this.scene);

        this.distance = 0;
        this.speed = CONFIG.baseSpeed;
        this.running = false;
        this.selectedPlane = "classic";
        this.nearMissCooldown = new Set(); // track trees already rewarded

        this.initMenu();
    }

    setupLighting() {
        const ambient = new THREE.AmbientLight(0x404060);
        this.scene.add(ambient);

        const dir = new THREE.DirectionalLight(0xfff5e6, 1.2);
        dir.position.set(50, 100, 50);
        dir.castShadow = true;
        dir.shadow.mapSize.width = 1024;
        dir.shadow.mapSize.height = 1024;
        const d = 200;
        dir.shadow.camera.left = -d;
        dir.shadow.camera.right = d;
        dir.shadow.camera.top = d;
        dir.shadow.camera.bottom = -d;
        dir.shadow.camera.near = 1;
        dir.shadow.camera.far = 200;
        this.scene.add(dir);

        const fill = new THREE.PointLight(0x4466cc, 0.5);
        fill.position.set(-20, 30, 20);
        this.scene.add(fill);
    }

    start() {
        // Clean up old scene
        while(this.scene.children.length > 0) this.scene.remove(this.scene.children[0]);
        this.setupLighting();
        this.world = new World(this.scene);
        this.player = new Player(this.scene, PLANES[this.selectedPlane]);
        this.effects = new Effects(this.scene);
        this.distance = 0;
        this.speed = CONFIG.baseSpeed;
        this.running = true;
        this.nearMissCooldown.clear();
        this.uiRoot.innerHTML = `<div class="hud" id="hud"></div>`;
        this.loop();
    }

    gameOver() {
        this.running = false;
        this.player.crash(this.effects);

        const xpEarned = Math.floor(this.distance * CONFIG.xpPerMeter);
        SAVE.xp += xpEarned;

        Object.keys(UNLOCK_COST).forEach(p => {
            if (!SAVE.unlocked.includes(p) && SAVE.xp >= UNLOCK_COST[p]) {
                SAVE.unlocked.push(p);
            }
        });

        Storage.save(SAVE);

        setTimeout(() => {
            this.uiRoot.innerHTML = `
                <div class="overlay">
                    <h1>GAME OVER</h1>
                    <p style="font-size: 1.5rem; margin: 10px;">Distance: ${Math.floor(this.distance)} m</p>
                    <p style="font-size: 1.5rem; margin: 10px;">XP Earned: ${xpEarned}</p>
                    <button onclick="game.start()">FLY AGAIN</button>
                    <button onclick="game.initMenu()">MAIN MENU</button>
                </div>
            `;
        }, 500);
    }

    loop() {
        if (!this.running) return;

        requestAnimationFrame(() => this.loop());

        const delta = this.clock.getDelta();
        this.speed += CONFIG.speedIncrease * delta * 30; // scale with delta

        this.player.update(delta, this.speed, CONFIG);
        this.world.update(this.player, this.speed, delta);
        this.checkNearMisses();

        // Camera follow with smooth lerp
        const targetCamPos = new THREE.Vector3(
            this.player.mesh.position.x * 0.3,
            this.player.mesh.position.y + 5,
            this.player.mesh.position.z + 15
        );
        this.camera.position.lerp(targetCamPos, 0.05);
        this.camera.lookAt(this.player.mesh.position);

        this.distance += this.speed * delta;

        // Collision with trees
        if (this.world.checkCollision(this.player)) {
            this.gameOver();
            return;
        }

        // Update HUD
        document.getElementById("hud").innerHTML = `
            <span>📏 DIST</span> ${Math.floor(this.distance)} m<br>
            <span>⚡ SPEED</span> ${Math.floor(this.speed * 3.6)} km/h<br>
            <span>📐 ALT</span> ${this.player.mesh.position.y.toFixed(1)} m<br>
            <span>✨ XP</span> ${SAVE.xp}<br>
            <span>✈️ ${PLANES[this.selectedPlane].name}</span>
        `;

        this.renderer.render(this.scene, this.camera);
    }

    checkNearMisses() {
        if (!this.player) return;
        for (let tree of this.world.trees) {
            if (this.nearMissCooldown.has(tree)) continue;
            const dist = tree.position.distanceTo(this.player.mesh.position);
            if (dist < CONFIG.nearMissDistance && dist > 3) { // close but not crash
                SAVE.xp += CONFIG.xpNearMissBonus;
                this.nearMissCooldown.add(tree);
                this.effects.nearMissFlash();
                // Visual feedback: tree glows briefly
                this.effects.treeGlow(tree);
            }
        }
    }

    initMenu() {
        this.running = false;
        this.uiRoot.innerHTML = `
            <div class="menu">
                <h1>PAIRPLANE 3D</h1>
                <button onclick="game.start()">START GAME</button>
                <button onclick="game.planeMenu()">PLANE SELECT</button>
                <button onclick="game.reset()">RESET PROGRESS</button>
            </div>
        `;
    }

    planeMenu() {
        let list = "";
        Object.keys(PLANES).forEach(key => {
            const unlocked = SAVE.unlocked.includes(key);
            list += `
                <button ${!unlocked ? "disabled" : ""}
                onclick="game.selectedPlane='${key}'; game.initMenu();">
                ${PLANES[key].name} ${!unlocked ? `🔒 ${UNLOCK_COST[key]} XP` : "✅"}
                </button>`;
        });

        this.uiRoot.innerHTML = `
            <div class="menu">
                <h1>SELECT PLANE</h1>
                ${list}
                <button onclick="game.initMenu()">BACK</button>
            </div>
        `;
    }

    reset() {
        if (!confirm("Reset all progress?")) return;
        localStorage.removeItem(Storage.key);
        location.reload();
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

// ================= PLAYER (Paper Airplane) =================
class Player {
    constructor(scene, stats) {
        this.stats = stats;
        this.mesh = this.createPaperPlane(stats.color);
        this.mesh.position.set(0, 15, 0);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        scene.add(this.mesh);

        this.velocity = new THREE.Vector3();
        this.input = { left: false, right: false, up: false, down: false };

        window.addEventListener("keydown", e => this.key(e, true));
        window.addEventListener("keyup", e => this.key(e, false));
    }

    createPaperPlane(color) {
        const group = new THREE.Group();

        // Body (thin rectangle)
        const bodyGeo = new THREE.BoxGeometry(0.8, 0.2, 2.5);
        const bodyMat = new THREE.MeshStandardMaterial({ color, emissive: 0x222222 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.z = 0.5;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        // Wings (two flat triangles)
        const wingGeo = new THREE.ConeGeometry(2, 0.2, 3); // triangle shape
        const wingMat = new THREE.MeshStandardMaterial({ color, emissive: 0x111111 });
        
        const leftWing = new THREE.Mesh(wingGeo, wingMat);
        leftWing.rotation.y = Math.PI / 2;
        leftWing.rotation.z = -0.2;
        leftWing.position.set(-1.2, 0, 0.8);
        leftWing.scale.set(0.5, 1, 0.8);
        leftWing.castShadow = true;
        group.add(leftWing);

        const rightWing = new THREE.Mesh(wingGeo, wingMat);
        rightWing.rotation.y = Math.PI / 2;
        rightWing.rotation.z = 0.2;
        rightWing.position.set(1.2, 0, 0.8);
        rightWing.scale.set(0.5, 1, 0.8);
        rightWing.castShadow = true;
        group.add(rightWing);

        // Tail
        const tailGeo = new THREE.BoxGeometry(0.5, 0.8, 0.2);
        const tailMat = new THREE.MeshStandardMaterial({ color });
        const tail = new THREE.Mesh(tailGeo, tailMat);
        tail.position.set(0, 0.5, -1.2);
        tail.castShadow = true;
        group.add(tail);

        // Cockpit (small sphere)
        const cockpitGeo = new THREE.SphereGeometry(0.3, 8, 8);
        const cockpitMat = new THREE.MeshStandardMaterial({ color: 0x88ccff });
        const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
        cockpit.position.set(0, 0.2, 1.4);
        cockpit.castShadow = true;
        group.add(cockpit);

        return group;
    }

    key(e, down) {
        if (e.key === "a" || e.key === "ArrowLeft") this.input.left = down;
        if (e.key === "d" || e.key === "ArrowRight") this.input.right = down;
        if (e.key === "w" || e.key === "ArrowUp") this.input.up = down;
        if (e.key === "s" || e.key === "ArrowDown") this.input.down = down;
    }

    update(delta, speed, config) {
        const handling = this.stats.handling * 15;

        if (this.input.left) this.velocity.x -= handling * delta;
        if (this.input.right) this.velocity.x += handling * delta;
        if (this.input.up) this.velocity.y += handling * delta;
        if (this.input.down) this.velocity.y -= handling * delta;

        // Apply stability (damping)
        this.velocity.multiplyScalar(1 - (0.1 * this.stats.stability * delta * 10));

        // Update position
        this.mesh.position.x += this.velocity.x * delta * 20;
        this.mesh.position.y += this.velocity.y * delta * 20;

        // Clamp altitude
        this.mesh.position.y = Math.max(config.minAltitude + 2, Math.min(config.maxAltitude - 2, this.mesh.position.y));

        // Auto-level roll/pitch based on velocity
        this.mesh.rotation.z = -this.velocity.x * 0.02;
        this.mesh.rotation.x = this.velocity.y * 0.02;
        this.mesh.rotation.y += this.velocity.x * 0.005;
    }

    crash(effects) {
        effects.explosion(this.mesh.position.clone());
        this.mesh.visible = false; // hide plane, show crumple later
    }
}

// ================= WORLD =================
class World {
    constructor(scene) {
        this.scene = scene;
        this.trees = [];

        // Ground with texture-like pattern
        const groundGeo = new THREE.PlaneGeometry(1000, 1000);
        const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a4d2e, roughness: 0.8, metalness: 0.1 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = 0;
        ground.receiveShadow = true;
        scene.add(ground);

        // Grid helper for style
        const grid = new THREE.GridHelper(1000, 20, 0x88aa88, 0x335533);
        grid.position.y = 0.01;
        scene.add(grid);

        // Create trees
        for (let i = 0; i < CONFIG.treeCount; i++) {
            const tree = this.createTallTree();
            this.resetTree(tree);
            scene.add(tree);
            this.trees.push(tree);
        }
    }

    createTallTree() {
        const group = new THREE.Group();

        // Trunk (tall)
        const trunkGeo = new THREE.CylinderGeometry(1, 1.5, CONFIG.treeHeight);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = CONFIG.treeHeight / 2;
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        group.add(trunk);

        // Leaves (multiple spheres for a fuller look)
        const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e8b57 });
        for (let i = 0; i < 5; i++) {
            const leaf = new THREE.Mesh(new THREE.SphereGeometry(1.5, 5), leafMat);
            leaf.position.set(
                (Math.random() - 0.5) * 2,
                CONFIG.treeHeight - 2 + Math.random() * 3,
                (Math.random() - 0.5) * 2
            );
            leaf.castShadow = true;
            leaf.receiveShadow = true;
            group.add(leaf);
        }

        return group;
    }

    resetTree(tree) {
        tree.position.x = (Math.random() - 0.5) * CONFIG.forestWidth;
        tree.position.z = -Math.random() * 500 - 50; // spawn ahead
        tree.position.y = 0;
    }

    update(player, speed, delta) {
        const move = speed * delta * 15; // scale movement with speed
        this.trees.forEach(tree => {
            tree.position.z += move;

            if (tree.position.z > player.mesh.position.z + 30) {
                this.resetTree(tree);
                tree.position.z = player.mesh.position.z - 400;
            }
        });
    }

    checkCollision(player) {
        const p = player.mesh.position;
        for (let tree of this.trees) {
            const t = tree.position;
            // Cylinder collision: check XZ distance and Y overlap
            const dx = p.x - t.x;
            const dz = p.z - t.z;
            const distXZ = Math.sqrt(dx*dx + dz*dz);
            if (distXZ < CONFIG.treeRadius) {
                // Check vertical overlap (tree from y=0 to CONFIG.treeHeight)
                if (p.y > 0 && p.y < CONFIG.treeHeight + 2) {
                    return true;
                }
            }
        }
        return false;
    }
}

// ================= EFFECTS =================
class Effects {
    constructor(scene) {
        this.scene = scene;
        this.flashTimer = 0;
    }

    nearMissFlash() {
        document.body.classList.add('flash');
        setTimeout(() => document.body.classList.remove('flash'), 200);
    }

    treeGlow(tree) {
        // Simple highlight: temporarily change material color
        const originalColors = [];
        tree.children.forEach(child => {
            if (child.material) {
                if (Array.isArray(child.material)) {
                    originalColors.push(child.material.map(m => m.color.clone()));
                    child.material.forEach(m => m.emissive.setHex(0x444400));
                } else {
                    originalColors.push(child.material.color.clone());
                    child.material.emissive.setHex(0x444400);
                }
            }
        });
        setTimeout(() => {
            tree.children.forEach((child, i) => {
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach((m, j) => m.emissive.copy(originalColors[i][j]));
                    } else {
                        child.material.emissive.setHex(0x000000);
                    }
                }
            });
        }, 150);
    }

    explosion(position) {
        // Simple particle burst
        const particleCount = 20;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        for (let i = 0; i < particleCount; i++) {
            positions[i*3] = position.x + (Math.random() - 0.5) * 5;
            positions[i*3+1] = position.y + (Math.random() - 0.5) * 5;
            positions[i*3+2] = position.z + (Math.random() - 0.5) * 5;
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({ color: 0xffaa00, size: 0.5 });
        const particles = new THREE.Points(geometry, material);
        this.scene.add(particles);
        setTimeout(() => this.scene.remove(particles), 500);
    }
}

// ================= INIT =================
const game = new Game();

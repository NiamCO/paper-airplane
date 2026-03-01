// ================= CONFIG =================

const CONFIG = {
    baseSpeed: 20,
    speedIncrease: 0.002,
    forestWidth: 120,
    treeCount: 150,
    nearMissDistance: 3,
    xpPerMeter: 1,
    xpNearMissBonus: 50
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
    classic: { name: "Classic", speed: 1, handling: 1, stability: 1, color: 0xffffff },
    swift: { name: "Swift", speed: 1.2, handling: 1.1, stability: 0.9, color: 0xff4444 },
    heavy: { name: "Heavy", speed: 0.9, handling: 0.8, stability: 1.3, color: 0x44ff44 },
    razor: { name: "Razor", speed: 1.3, handling: 1.3, stability: 0.7, color: 0x4444ff },
    ghost: { name: "Ghost", speed: 1.1, handling: 1.2, stability: 1.2, color: 0xccccff }
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
        this.scene.fog = new THREE.Fog(0x87ceeb, 50, 400);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;

        window.addEventListener("resize", () => this.onResize());

        this.clock = new THREE.Clock();

        this.setupLighting();
        this.world = new World(this.scene);
        this.player = null;

        this.distance = 0;
        this.speed = CONFIG.baseSpeed;
        this.running = false;
        this.selectedPlane = "classic";

        this.initMenu();
    }

    setupLighting() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambient);

        const dir = new THREE.DirectionalLight(0xffffff, 1);
        dir.position.set(50, 100, 50);
        dir.castShadow = true;
        this.scene.add(dir);
    }

    start() {
        this.scene.clear();
        this.setupLighting();
        this.world = new World(this.scene);
        this.player = new Player(this.scene, PLANES[this.selectedPlane]);
        this.distance = 0;
        this.speed = CONFIG.baseSpeed;
        this.running = true;
        this.uiRoot.innerHTML = `<div class="hud" id="hud"></div>`;
        this.loop();
    }

    gameOver() {
        this.running = false;

        const xpEarned = Math.floor(this.distance * CONFIG.xpPerMeter);
        SAVE.xp += xpEarned;

        Object.keys(UNLOCK_COST).forEach(p => {
            if (!SAVE.unlocked.includes(p) && SAVE.xp >= UNLOCK_COST[p]) {
                SAVE.unlocked.push(p);
            }
        });

        Storage.save(SAVE);

        this.uiRoot.innerHTML = `
            <div class="overlay">
                <h1>Game Over</h1>
                <p>Distance: ${Math.floor(this.distance)} m</p>
                <p>XP Earned: ${xpEarned}</p>
                <button onclick="game.start()">Restart</button>
                <button onclick="game.initMenu()">Main Menu</button>
            </div>
        `;
    }

    loop() {
        if (!this.running) return;

        requestAnimationFrame(() => this.loop());

        const delta = this.clock.getDelta();

        this.speed += CONFIG.speedIncrease;

        this.player.update(delta, this.speed);
        this.world.update(this.player);

        this.camera.position.lerp(
            new THREE.Vector3(
                this.player.mesh.position.x,
                this.player.mesh.position.y + 3,
                this.player.mesh.position.z + 10
            ),
            0.1
        );

        this.camera.lookAt(this.player.mesh.position);

        this.distance += this.speed * delta;

        if (this.world.checkCollision(this.player)) {
            this.player.crash();
            this.gameOver();
        }

        document.getElementById("hud").innerHTML =
            `Distance: ${Math.floor(this.distance)} m<br>
             XP: ${SAVE.xp}<br>
             Plane: ${PLANES[this.selectedPlane].name}`;

        this.renderer.render(this.scene, this.camera);
    }

    initMenu() {
        this.running = false;

        this.uiRoot.innerHTML = `
            <div class="menu">
                <h1>Pairplane 3D</h1>
                <button onclick="game.start()">Start Game</button>
                <button onclick="game.planeMenu()">Plane Selection</button>
                <button onclick="game.reset()">Reset Progress</button>
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
                ${PLANES[key].name} ${!unlocked ? `(Locked ${UNLOCK_COST[key] || 0} XP)` : ""}
                </button>`;
        });

        this.uiRoot.innerHTML = `
            <div class="menu">
                <h1>Select Plane</h1>
                ${list}
                <button onclick="game.initMenu()">Back</button>
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

// ================= PLAYER =================

class Player {
    constructor(scene, stats) {
        this.stats = stats;
        this.mesh = this.createPlane(stats.color);
        this.mesh.position.set(0, 10, 0);
        scene.add(this.mesh);

        this.velocity = new THREE.Vector3();
        this.input = { left: false, right: false, up: false, down: false };

        window.addEventListener("keydown", e => this.key(e, true));
        window.addEventListener("keyup", e => this.key(e, false));
    }

    createPlane(color) {
        const group = new THREE.Group();

        const body = new THREE.Mesh(
            new THREE.ConeGeometry(1, 4, 4),
            new THREE.MeshStandardMaterial({ color })
        );
        body.rotation.x = Math.PI / 2;
        body.castShadow = true;
        group.add(body);

        return group;
    }

    key(e, down) {
        if (e.key === "a" || e.key === "ArrowLeft") this.input.left = down;
        if (e.key === "d" || e.key === "ArrowRight") this.input.right = down;
        if (e.key === "w" || e.key === "ArrowUp") this.input.up = down;
        if (e.key === "s" || e.key === "ArrowDown") this.input.down = down;
    }

    update(delta, speed) {
        const handling = this.stats.handling;

        if (this.input.left) this.velocity.x -= handling * delta * 20;
        if (this.input.right) this.velocity.x += handling * delta * 20;
        if (this.input.up) this.velocity.y += handling * delta * 20;
        if (this.input.down) this.velocity.y -= handling * delta * 20;

        this.velocity.multiplyScalar(0.95);

        this.mesh.position.add(this.velocity.clone().multiplyScalar(delta * 60));

        this.mesh.rotation.z = -this.velocity.x * 0.02;
        this.mesh.rotation.x = this.velocity.y * 0.02;
    }

    crash() {
        console.log("Crashed");
    }
}

// ================= WORLD =================

class World {
    constructor(scene) {
        this.scene = scene;
        this.trees = [];

        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(1000, 1000),
            new THREE.MeshStandardMaterial({ color: 0x2e8b57 })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);

        for (let i = 0; i < CONFIG.treeCount; i++) {
            const tree = this.createTree();
            this.resetTree(tree);
            scene.add(tree);
            this.trees.push(tree);
        }
    }

    createTree() {
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.5, 0.5, 5),
            new THREE.MeshStandardMaterial({ color: 0x8b4513 })
        );
        const leaves = new THREE.Mesh(
            new THREE.ConeGeometry(2, 6, 8),
            new THREE.MeshStandardMaterial({ color: 0x0f5132 })
        );
        leaves.position.y = 5;

        const group = new THREE.Group();
        group.add(trunk);
        group.add(leaves);
        return group;
    }

    resetTree(tree) {
        tree.position.x = (Math.random() - 0.5) * CONFIG.forestWidth;
        tree.position.z = -Math.random() * 500;
        tree.position.y = 2.5;
    }

    update(player) {
        this.trees.forEach(tree => {
            tree.position.z += 0.5;

            if (tree.position.z > player.mesh.position.z + 20) {
                this.resetTree(tree);
                tree.position.z = player.mesh.position.z - 400;
            }
        });
    }

    checkCollision(player) {
        for (let tree of this.trees) {
            const dist = tree.position.distanceTo(player.mesh.position);
            if (dist < 3) return true;
        }
        return false;
    }
}

// ================= INIT =================

const game = new Game();

import Phaser from "phaser";
import { generateMap, type MapData } from "../game/procgen/MapGen";
import { NavGrid, type Point } from "../game/nav/NavGrid";
import { makeRng, pickWeighted } from "../game/rng";
import { loadSave, saveSave } from "../game/persistence";
import {
  WEAPONS,
  canShoot,
  finishReloadIfDue,
  makeWeaponState,
  startReload,
  type AmmoType,
  type WeaponId,
  type WeaponState,
} from "../game/combat/weapons";
import { renderUi, setInventoryVisible } from "../ui/domUi";

type SceneData = { floor: number; baseSeed: number };

type PickupKind = "loot" | "ammo" | "mag" | "medkit" | "weapon";
type Pickup = Phaser.Physics.Arcade.Image & {
  kind: PickupKind;
  name: string;
  ammoType?: AmmoType;
  ammoAmount?: number;
  weaponId?: WeaponId;
  loadedBullets?: number;
  healAmount?: number;
};

type Bullet = Phaser.Physics.Arcade.Image;

type Enemy = Phaser.Physics.Arcade.Sprite & {
  hp: number;
  lastDamageAt: number;
  weapon: WeaponState;
  weaponReserve: number;
  role: "suppress" | "flank";
  path: Point[];
  pathI: number;
  goal?: Point;
};

type AmmoPools = Record<AmmoType, number>;

function dist(a: Point, b: Point) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function emptyAmmoPools(): AmmoPools {
  return { "9mm": 0, "5.56": 0, "7.62": 0 };
}

const ENEMY_INFINITE_AMMO = Number.POSITIVE_INFINITY;

export class RaidScene extends Phaser.Scene {
  constructor() {
    super("raid");
  }

  private floor = 1;
  private baseSeed = 0;

  private map!: MapData;
  private nav!: NavGrid;
  private coverPoints: Point[] = [];

  private player!: Phaser.Physics.Arcade.Sprite;
  private playerHp = 100;
  private readonly playerHpMax = 100;
  private medkits = 0;
  private ammoPools: AmmoPools = emptyAmmoPools();

  private playerWeapon!: WeaponState;

  private bullets!: Phaser.Physics.Arcade.Group;
  private enemies!: Phaser.Physics.Arcade.Group;
  private pickups!: Phaser.Physics.Arcade.Group;
  private walls!: Phaser.Physics.Arcade.StaticGroup;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  private inventoryVisible = true;
  private inventory: string[] = [];
  private stash: string[] = [];

  private lootRemaining = 0;

  private exitZone!: Phaser.GameObjects.Zone;
  private inExitZone = false;
  private exitProgressMs = 0;
  private readonly exitRequiredMs = 900;

  private message = "";

  init(data: SceneData) {
    this.floor = data?.floor ?? 1;
    this.baseSeed = data?.baseSeed ?? ((Date.now() & 0xffffffff) >>> 0);
  }

  create() {
    const save = loadSave();
    this.stash = save.stash;

    this.keys = this.input.keyboard!.addKeys("W,A,S,D,F,H,I,R,SHIFT") as any;

    const viewW = Math.max(320, this.scale.width);
    const viewH = Math.max(240, this.scale.height);
    this.map = generateMap(this.floor, this.baseSeed, viewW, viewH);
    this.nav = new NavGrid(this.map);
    this.coverPoints = this.nav.computeCoverPoints();

    const worldW = this.map.w * this.map.tileSize;
    const worldH = this.map.h * this.map.tileSize;

    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.physics.world.setBounds(0, 0, worldW, worldH);

    this.scale.on(Phaser.Scale.Events.RESIZE, (gameSize: Phaser.Structs.Size) => {
      this.cameras.resize(gameSize.width, gameSize.height);
    });

    this.walls = this.physics.add.staticGroup();
    this.drawMapAndWalls();

    const startW = this.nav.toWorldCenter(this.map.start.x, this.map.start.y);
    this.player = this.physics.add.sprite(startW.x, startW.y, "player");
    this.player.setCollideWorldBounds(true);
    this.player.setDamping(true);
    this.player.setDrag(1400, 1400);
    this.player.setMaxVelocity(320, 320);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    if (this.floor === 1) {
      this.playerHp = this.playerHpMax;
      this.medkits = 0;
      this.ammoPools = emptyAmmoPools();
      this.ammoPools["9mm"] = 60;
      this.playerWeapon = makeWeaponState(WEAPONS.pistol, WEAPONS.pistol.magSize);
    } else {
      this.playerHp = Math.min(this.playerHpMax, Math.max(35, this.playerHp));
    }

    this.bullets = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      runChildUpdate: false,
      maxSize: 400,
    });
    this.enemies = this.physics.add.group({ classType: Phaser.Physics.Arcade.Sprite });
    this.pickups = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image });

    this.spawnEnemies();
    this.spawnPickups();

    const exitW = this.nav.toWorldCenter(this.map.exit.x, this.map.exit.y);
    this.exitZone = this.add.zone(exitW.x, exitW.y, this.map.tileSize * 3, this.map.tileSize * 3);
    this.physics.add.existing(this.exitZone, true);

    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.enemies, this.walls);
    this.physics.add.collider(this.enemies, this.enemies);
    this.physics.add.collider(this.bullets, this.walls, (obj) => (obj as Bullet).destroy());

    this.physics.add.overlap(this.bullets, this.enemies, (bObj, eObj) => {
      const b = bObj as Bullet;
      if (b.getData("owner") !== "player") return;

      const dmg = Number(b.getData("dmg") ?? 0);
      const e = eObj as Enemy;
      if (!e.active) return;

      b.destroy();
      e.hp -= dmg;
      e.lastDamageAt = this.time.now;

      if (e.hp <= 0) this.handleEnemyDeath(e);
    });

    this.physics.add.overlap(this.player, this.pickups, (_p, itemObj) => {
      const item = itemObj as Pickup;
      this.message = this.pickupPrompt(item);
    });

    const z = this.add.graphics();
    z.lineStyle(2, 0x9cd3ff, 0.9);
    z.strokeRect(
      this.exitZone.x - this.exitZone.width / 2,
      this.exitZone.y - this.exitZone.height / 2,
      this.exitZone.width,
      this.exitZone.height
    );
    z.fillStyle(0x9cd3ff, 0.08);
    z.fillRect(
      this.exitZone.x - this.exitZone.width / 2,
      this.exitZone.y - this.exitZone.height / 2,
      this.exitZone.width,
      this.exitZone.height
    );

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) this.tryShootPlayer();
    });

    this.message = `Floor ${this.floor}. Full-auto weapons can now also spawn on the ground.`;
    setInventoryVisible(true);
    this.renderUi();
  }

  update(_t: number, dtMs: number) {
    const dts = dtMs / 1000;
    const now = this.time.now;

    this.finishPlayerReloadIfDue(now);
    this.updateMovement(dts);
    this.updateAim();
    this.inExitZone = this.isPlayerInExitZone();

    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) {
      const reserve = this.getCurrentReserve();
      if (startReload(this.playerWeapon, reserve, now)) this.message = "Reloading…";
      else if (reserve <= 0) this.message = "No ammo or mags for this weapon.";
      else if (this.playerWeapon.mag >= this.playerWeapon.def.magSize) this.message = "Magazine already full.";
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.H)) {
      this.useMedkit();
    }

    this.updateEnemies(now);
    this.applyEnemyBulletDamageSweep(dtMs);
    this.tryPickup();
    this.updateExit(dtMs);

    if (Phaser.Input.Keyboard.JustDown(this.keys.I)) {
      this.inventoryVisible = !this.inventoryVisible;
      setInventoryVisible(this.inventoryVisible);
    }

    this.renderUi();
  }

  private updateMovement(_dts: number) {
    const up = this.keys.W.isDown;
    const down = this.keys.S.isDown;
    const left = this.keys.A.isDown;
    const right = this.keys.D.isDown;

    const vx = (right ? 1 : 0) - (left ? 1 : 0);
    const vy = (down ? 1 : 0) - (up ? 1 : 0);

    const v = new Phaser.Math.Vector2(vx, vy);
    if (v.lengthSq() > 0) v.normalize();

    const sprinting = (vx !== 0 || vy !== 0) && this.keys.SHIFT.isDown;
    const speed = sprinting ? 330 : 245;

    this.player.setVelocity(v.x * speed, v.y * speed);
  }

  private updateAim() {
    const p = this.input.activePointer;
    const world = p.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const ang = Phaser.Math.Angle.Between(this.player.x, this.player.y, world.x, world.y);
    this.player.setRotation(ang);
  }

  private tryShootPlayer() {
    const now = this.time.now;

    if (!canShoot(this.playerWeapon, now)) {
      if (this.playerWeapon.mag <= 0) this.message = "Empty mag. Press R to reload.";
      return;
    }

    this.playerWeapon.mag -= 1;
    this.playerWeapon.nextShotAt = now + this.playerWeapon.def.fireDelayMs;

    const p = this.input.activePointer;
    const world = p.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;

    let ang = Phaser.Math.Angle.Between(this.player.x, this.player.y, world.x, world.y);
    ang += Phaser.Math.FloatBetween(-this.playerWeapon.def.spreadRad, this.playerWeapon.def.spreadRad);

    this.spawnBullet(
      "player",
      this.player.x,
      this.player.y,
      ang,
      this.playerWeapon.def.bulletSpeed,
      this.playerWeapon.def.damage,
      this.playerWeapon.def.bulletLifeMs
    );
  }

  private spawnBullet(owner: "player" | "enemy", x: number, y: number, angle: number, speed: number, dmg: number, lifeMs: number) {
    const tex = owner === "player" ? "bullet_player" : "bullet_enemy";
    const b = this.bullets.get(x, y, tex) as Bullet | null;
    if (!b) return;

    b.setActive(true).setVisible(true);
    this.physics.world.enable(b);

    b.setDataEnabled();
    b.setData("owner", owner);
    b.setData("dmg", dmg);

    b.setRotation(angle);
    b.setDepth(3);
    b.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);

    const body = b.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setSize(10, 4, true);

    this.time.delayedCall(lifeMs, () => {
      if (b && b.active) b.destroy();
    });
  }

  private applyEnemyBulletDamageSweep(dtMs: number) {
    const dt = dtMs / 1000;
    const playerRect = this.player.getBounds();

    for (const child of this.bullets.getChildren()) {
      const b = child as Bullet;
      if (!b || !b.active) continue;
      if (b.getData("owner") !== "enemy") continue;

      const body = b.body as Phaser.Physics.Arcade.Body | null;
      if (!body) continue;

      const prevX = b.x - body.velocity.x * dt;
      const prevY = b.y - body.velocity.y * dt;

      const line = new Phaser.Geom.Line(prevX, prevY, b.x, b.y);
      const hit =
        Phaser.Geom.Intersects.LineToRectangle(line, playerRect) ||
        Phaser.Geom.Intersects.RectangleToRectangle(b.getBounds(), playerRect);

      if (!hit) continue;

      const dmg = Number(b.getData("dmg") ?? 0);
      b.destroy();

      this.playerHp = Math.max(0, this.playerHp - dmg);
      this.message = `Hit! -${dmg} HP (${Math.floor(this.playerHp)}/${this.playerHpMax})`;

      if (this.playerHp <= 0) {
        this.onDeath();
        return;
      }
    }
  }

  private updateEnemies(now: number) {
    const playerPos: Point = { x: this.player.x, y: this.player.y };

    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e || !e.active) continue;

      e.weaponReserve = finishReloadIfDue(e.weapon, ENEMY_INFINITE_AMMO, now);

      const ePos: Point = { x: e.x, y: e.y };
      const d = dist(ePos, playerPos);
      const sees = d <= 1200 && this.nav.hasLineOfSightWorld(e.x, e.y, playerPos.x, playerPos.y);

      const threatened = (now - e.lastDamageAt) < 850;
      if (threatened && sees) {
        const cover = this.pickCoverPoint(ePos, playerPos, 520);
        if (cover) e.goal = cover;
      }

      if (!e.goal || dist(ePos, e.goal) < 20 || (now % 800) < 18) {
        if (e.role === "flank") {
          e.goal = this.pickFlankPoint(ePos, playerPos, 600) ?? playerPos;
        } else {
          if (sees && d < 260) {
            const away = new Phaser.Math.Vector2(e.x - playerPos.x, e.y - playerPos.y).normalize();
            e.goal = { x: e.x + away.x * 200, y: e.y + away.y * 200 };
          } else if (sees && d > 520) {
            e.goal = playerPos;
          } else {
            e.goal = ePos;
          }
        }
      }

      this.moveAlongPath(e, e.goal ?? ePos, 175);

      const outOfAmmo = false;
      if (!outOfAmmo) {
        if (e.weapon.mag <= 0) {
          startReload(e.weapon, ENEMY_INFINITE_AMMO, now);
        }

        if (sees && d <= e.weapon.def.range && canShoot(e.weapon, now)) {
          e.weapon.mag -= 1;
          e.weapon.nextShotAt = now + e.weapon.def.fireDelayMs + Phaser.Math.Between(0, 60);

          let ang = Phaser.Math.Angle.Between(e.x, e.y, playerPos.x, playerPos.y);
          const mult = e.weapon.def.id === "smg" ? 2.05 : e.weapon.def.id === "lmg" ? 1.55 : e.role === "flank" ? 1.9 : 1.25;
          ang += Phaser.Math.FloatBetween(-e.weapon.def.spreadRad * mult, e.weapon.def.spreadRad * mult);

          this.spawnBullet(
            "enemy",
            e.x,
            e.y,
            ang,
            e.weapon.def.bulletSpeed,
            this.enemyDamage(e.weapon.def.id),
            e.weapon.def.bulletLifeMs
          );
        }
      }

      e.setRotation(Math.atan2(playerPos.y - e.y, playerPos.x - e.x));
    }
  }

  private enemyDamage(id: WeaponId): number {
    if (id === "sniper") return 18;
    if (id === "lmg") return 8;
    if (id === "ar") return 7;
    if (id === "smg") return 5;
    return 6;
  }

  private moveAlongPath(e: Enemy, goal: Point, speed: number) {
    const needPlan = e.path.length === 0 || e.pathI >= e.path.length || (this.time.now % 520) < 18;
    if (needPlan) {
      e.path = this.nav.findPathWorld(e.x, e.y, goal.x, goal.y);
      e.pathI = 0;
    }

    const target = e.path[e.pathI] ?? goal;
    const dx = target.x - e.x;
    const dy = target.y - e.y;
    const d = Math.sqrt(dx * dx + dy * dy);

    if (d < 10) {
      e.pathI++;
      if (e.pathI >= e.path.length) {
        e.setVelocity(0, 0);
        return;
      }
    }

    const vx = (dx / Math.max(0.001, d)) * speed;
    const vy = (dy / Math.max(0.001, d)) * speed;
    e.setVelocity(vx, vy);
  }

  private pickCoverPoint(enemyPos: Point, threatPos: Point, radius: number): Point | null {
    let best: { p: Point; score: number } | null = null;
    for (const p of this.coverPoints) {
      const d = dist(enemyPos, p);
      if (d > radius) continue;
      const blocked = !this.nav.hasLineOfSightWorld(p.x, p.y, threatPos.x, threatPos.y);
      if (!blocked) continue;
      const dt = dist(p, threatPos);
      const score = d * 0.8 - dt * 0.15;
      if (!best || score < best.score) best = { p, score };
    }
    return best?.p ?? null;
  }

  private pickFlankPoint(enemyPos: Point, targetPos: Point, radius: number): Point | null {
    const toEnemy = Math.atan2(enemyPos.y - targetPos.y, enemyPos.x - targetPos.x);
    let best: { p: Point; score: number } | null = null;

    for (const p of this.coverPoints) {
      const d = dist(enemyPos, p);
      if (d > radius) continue;

      const blocked = !this.nav.hasLineOfSightWorld(p.x, p.y, targetPos.x, targetPos.y);
      if (!blocked) continue;

      const ang = Math.atan2(p.y - targetPos.y, p.x - targetPos.x);
      let delta = Math.abs(ang - toEnemy);
      while (delta > Math.PI) delta = Math.abs(delta - Math.PI * 2);
      if (delta < Math.PI / 3) continue;

      const dt = dist(p, targetPos);
      const score = d + dt * 0.25 - delta * 30;
      if (!best || score < best.score) best = { p, score };
    }
    return best?.p ?? null;
  }

  private tryPickup() {
    if (!Phaser.Input.Keyboard.JustDown(this.keys.F)) return;

    const overlapping: Pickup[] = [];
    this.physics.overlap(this.player, this.pickups, (_p, obj) => overlapping.push(obj as Pickup));

    if (overlapping.length === 0) {
      this.message = "Nothing to pick up.";
      return;
    }

    overlapping.sort(
      (a, b) =>
        Phaser.Math.Distance.Between(this.player.x, this.player.y, a.x, a.y) -
        Phaser.Math.Distance.Between(this.player.x, this.player.y, b.x, b.y)
    );

    const item = overlapping[0];
    this.pickupItem(item);
    item.destroy();
  }

  private pickupItem(item: Pickup) {
    switch (item.kind) {
      case "ammo": {
        const amt = item.ammoAmount ?? 0;
        const ammoType = item.ammoType!;
        this.ammoPools[ammoType] += amt;
        this.message = `Picked ammo: +${amt} ${ammoType}`;
        return;
      }

      case "mag": {
        const ammoType = item.ammoType!;
        const bullets = item.ammoAmount ?? this.magBulletsForAmmo(ammoType);
        this.ammoPools[ammoType] += bullets;
        this.message = `Picked mag: +${bullets} ${ammoType}`;
        return;
      }

      case "medkit": {
        const heal = item.healAmount ?? 35;
        this.medkits += 1;
        this.message = `Picked medkit (+1). Press H to heal ${heal} HP.`;
        return;
      }

      case "weapon": {
        const weaponId = item.weaponId!;
        const loaded = Math.max(0, item.loadedBullets ?? 0);
        const oldWeapon = this.playerWeapon;

        this.playerWeapon = makeWeaponState(WEAPONS[weaponId], loaded);
        this.playerWeapon.nextShotAt = 0;

        this.createWeaponPickup(item.x + 10, item.y + 10, oldWeapon.def.id, oldWeapon.mag);
        this.message = `Equipped ${WEAPONS[weaponId].name} (${loaded}/${WEAPONS[weaponId].magSize}).`;
        return;
      }

      case "loot": {
        this.inventory.push(item.name);
        this.lootRemaining = Math.max(0, this.lootRemaining - 1);
        this.message = `Picked loot: ${item.name}`;
        return;
      }
    }
  }

  private updateExit(dtMs: number) {
    const enemiesRemaining = this.enemies.countActive(true);
    const lootRemaining = this.lootRemaining;

    if (!this.inExitZone) {
      this.exitProgressMs = Math.max(0, this.exitProgressMs - dtMs * 2);
      return;
    }

    if (lootRemaining > 0 || enemiesRemaining > 0) {
      const parts: string[] = [];
      if (lootRemaining > 0) parts.push(`${lootRemaining} loot remaining`);
      if (enemiesRemaining > 0) parts.push(`${enemiesRemaining} enemies remaining`);
      this.message = `Exit locked: ${parts.join(", ")}.`;
      this.exitProgressMs = 0;
      return;
    }

    this.exitProgressMs += dtMs;
    if (this.exitProgressMs >= this.exitRequiredMs) {
      this.advanceFloor();
    } else {
      this.message = "Exit unlocked. Standing…";
    }
  }

  private advanceFloor() {
    this.stash = [...this.stash, ...this.inventory];
    saveSave({ stash: this.stash });

    this.inventory = [];
    this.playerHp = Math.max(35, this.playerHp);
    this.exitProgressMs = 0;

    this.scene.restart({ floor: this.floor + 1, baseSeed: this.baseSeed });
  }

  private onDeath() {
    this.inventory = [];
    this.playerHp = this.playerHpMax;
    this.exitProgressMs = 0;
    this.medkits = 0;
    this.ammoPools = emptyAmmoPools();
    this.ammoPools["9mm"] = 60;
    this.playerWeapon = makeWeaponState(WEAPONS.pistol, WEAPONS.pistol.magSize);
    this.message = "You died. Restarting at Floor 1.";
    this.scene.restart({ floor: 1, baseSeed: this.baseSeed });
  }

  private handleEnemyDeath(e: Enemy) {
    if (!e.active) return;
    const dropX = e.x;
    const dropY = e.y;
    const loaded = Math.max(0, e.weapon.mag);

    if (loaded > 0 || Math.random() < 0.75) {
      this.createWeaponPickup(dropX, dropY, e.weapon.def.id, loaded);
    } else if (Math.random() < 0.5) {
      this.createAmmoPickup(dropX, dropY, e.weapon.def.ammoType, Phaser.Math.Between(6, 18));
    }

    e.destroy();
  }

  private spawnEnemies() {
    const rng = makeRng(this.map.seed ^ 0xA53A9E3);
    const enemyCount = Math.min(22, 6 + Math.floor(this.floor * 1.15));

    for (let i = 0; i < enemyCount; i++) {
      const p = this.randomWalkableWorld(rng);
      const e = this.enemies.create(p.x, p.y, "enemy") as Enemy;
      e.setCollideWorldBounds(true);

      const wid = pickWeighted<WeaponId>(rng, [
        { item: "pistol", w: 0.22 },
        { item: "smg", w: 0.23 },
        { item: "ar", w: 0.35 },
        { item: "lmg", w: 0.10 },
        { item: "sniper", w: 0.10 },
      ]);

      const loaded = Math.max(1, Math.floor(WEAPONS[wid].magSize * (0.25 + rng() * 0.65)));
      e.weapon = makeWeaponState(WEAPONS[wid], loaded);
      e.weaponReserve = ENEMY_INFINITE_AMMO;

      e.weapon.nextShotAt = this.time.now + Math.floor(300 + rng() * 900);

      e.hp = 50 + Math.min(55, this.floor * 4);
      e.lastDamageAt = -99999;
      e.role = (i % 3 === 0) ? "suppress" : "flank";
      e.path = [];
      e.pathI = 0;
    }
  }

  private spawnPickups() {
    const rng = makeRng(this.map.seed ^ 0x51c0ffee);

    const lootCount = 6 + Math.floor(rng() * 4);
    this.lootRemaining = lootCount;

    const lootNames = ["Scrap", "Artifact", "Food", "Battery", "Document", "Circuit"];
    for (let i = 0; i < lootCount; i++) {
      const p = this.randomWalkableWorld(rng);
      const name = lootNames[Math.floor(rng() * lootNames.length)];
      this.createLootPickup(p.x, p.y, name);
    }

    const ammoCount = 4 + Math.floor(rng() * 5);
    for (let i = 0; i < ammoCount; i++) {
      const p = this.randomWalkableWorld(rng);
      const ammoType = pickWeighted<AmmoType>(rng, [
        { item: "9mm", w: 0.50 },
        { item: "5.56", w: 0.35 },
        { item: "7.62", w: 0.15 },
      ]);
      const amt = ammoType === "9mm"
        ? Math.floor(10 + rng() * 18)
        : ammoType === "5.56"
          ? Math.floor(16 + rng() * 24)
          : Math.floor(4 + rng() * 8);
      this.createAmmoPickup(p.x, p.y, ammoType, amt);
    }

    const magCount = 4 + Math.floor(rng() * 4);
    for (let i = 0; i < magCount; i++) {
      const p = this.randomWalkableWorld(rng);
      const ammoType = pickWeighted<AmmoType>(rng, [
        { item: "9mm", w: 0.45 },
        { item: "5.56", w: 0.40 },
        { item: "7.62", w: 0.15 },
      ]);
      this.createMagPickup(p.x, p.y, ammoType);
    }

    const medkitCount = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < medkitCount; i++) {
      const p = this.randomWalkableWorld(rng);
      this.createMedkitPickup(p.x, p.y, 35);
    }

    // Random floor weapon spawns so full-auto guns can also be found on the ground.
    const weaponCount = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < weaponCount; i++) {
      const p = this.randomWalkableWorld(rng);
      const weaponId = pickWeighted<WeaponId>(rng, [
        { item: "smg", w: 0.28 },
        { item: "ar", w: 0.38 },
        { item: "lmg", w: 0.12 },
        { item: "pistol", w: 0.15 },
        { item: "sniper", w: 0.07 },
      ]);
      const loaded = Math.max(0, Math.floor(WEAPONS[weaponId].magSize * (0.15 + rng() * 0.7)));
      this.createWeaponPickup(p.x, p.y, weaponId, loaded);
    }
  }

  private createLootPickup(x: number, y: number, name: string) {
    const it = this.pickups.create(x, y, "loot") as Pickup;
    it.kind = "loot";
    it.name = name;
    it.setImmovable(true);
  }

  private createAmmoPickup(x: number, y: number, ammoType: AmmoType, amt: number) {
    const it = this.pickups.create(x, y, "ammo") as Pickup;
    it.kind = "ammo";
    it.name = `${ammoType} Ammo`;
    it.ammoType = ammoType;
    it.ammoAmount = amt;
    it.setImmovable(true);
  }

  private createMagPickup(x: number, y: number, ammoType: AmmoType) {
    const bullets = this.magBulletsForAmmo(ammoType);
    const it = this.pickups.create(x, y, "mag") as Pickup;
    it.kind = "mag";
    it.name = `${ammoType} Mag`;
    it.ammoType = ammoType;
    it.ammoAmount = bullets;
    it.setImmovable(true);
  }

  private createMedkitPickup(x: number, y: number, healAmount: number) {
    const it = this.pickups.create(x, y, "medkit") as Pickup;
    it.kind = "medkit";
    it.name = "Medkit";
    it.healAmount = healAmount;
    it.setImmovable(true);
  }

  private createWeaponPickup(x: number, y: number, weaponId: WeaponId, loadedBullets: number) {
    const it = this.pickups.create(x, y, "weapon_drop") as Pickup;
    it.kind = "weapon";
    it.weaponId = weaponId;
    it.loadedBullets = Math.max(0, Math.min(WEAPONS[weaponId].magSize, loadedBullets));
    it.name = `${WEAPONS[weaponId].name} (${it.loadedBullets}/${WEAPONS[weaponId].magSize})`;
    it.setImmovable(true);
  }

  private magBulletsForAmmo(ammoType: AmmoType): number {
    if (ammoType === "9mm") return WEAPONS.smg.magSize;
    if (ammoType === "5.56") return WEAPONS.ar.magSize;
    return WEAPONS.sniper.magSize;
  }

  private pickupPrompt(item: Pickup): string {
    if (item.kind === "ammo") return `${item.name}: +${item.ammoAmount} loose rounds. Press F.`;
    if (item.kind === "mag") return `${item.name}: +${item.ammoAmount} rounds worth of mags. Press F.`;
    if (item.kind === "medkit") return `Medkit. Press F to pick up, H to use.`;
    if (item.kind === "weapon") return `${item.name}. Press F to equip / swap.`;
    return `Loot: ${item.name}. Press F to pick up.`;
  }

  private useMedkit() {
    if (this.medkits <= 0) {
      this.message = "No medkits.";
      return;
    }
    if (this.playerHp >= this.playerHpMax) {
      this.message = "HP already full.";
      return;
    }
    this.medkits -= 1;
    this.playerHp = Math.min(this.playerHpMax, this.playerHp + 35);
    this.message = `Used medkit. HP ${Math.floor(this.playerHp)}/${this.playerHpMax}.`;
  }

  private getCurrentReserve(): number {
    return this.ammoPools[this.playerWeapon.def.ammoType];
  }

  private setCurrentReserve(v: number) {
    this.ammoPools[this.playerWeapon.def.ammoType] = Math.max(0, Math.floor(v));
  }

  private finishPlayerReloadIfDue(now: number) {
    this.setCurrentReserve(finishReloadIfDue(this.playerWeapon, this.getCurrentReserve(), now));
  }

  private randomWalkableWorld(rng: () => number): Point {
    const start = this.nav.toWorldCenter(this.map.start.x, this.map.start.y);
    for (let i = 0; i < 9000; i++) {
      const tx = Math.floor(rng() * this.map.w);
      const ty = Math.floor(rng() * this.map.h);
      if (!this.nav.isWalkable(tx, ty)) continue;
      const p = this.nav.toWorldCenter(tx, ty);
      if (dist(p, start) < 160) continue;
      return p;
    }
    return start;
  }

  private isPlayerInExitZone(): boolean {
    const pr = this.player.getBounds();
    const zr = new Phaser.Geom.Rectangle(
      this.exitZone.x - this.exitZone.width / 2,
      this.exitZone.y - this.exitZone.height / 2,
      this.exitZone.width,
      this.exitZone.height
    );
    return Phaser.Geom.Intersects.RectangleToRectangle(pr, zr);
  }

  private drawMapAndWalls() {
    const g = this.add.graphics();
    const ts = this.map.tileSize;

    g.fillStyle(0x0f1622, 1);
    g.fillRect(0, 0, this.map.w * ts, this.map.h * ts);

    g.fillStyle(0x1f2a37, 1);
    for (let y = 0; y < this.map.h; y++) {
      for (let x = 0; x < this.map.w; x++) {
        if (this.map.tiles[y * this.map.w + x] === 1) g.fillRect(x * ts, y * ts, ts, ts);
      }
    }

    const used = new Array(this.map.w * this.map.h).fill(false);
    const isWall = (x: number, y: number) => this.map.tiles[y * this.map.w + x] === 1;

    for (let y = 0; y < this.map.h; y++) {
      for (let x = 0; x < this.map.w; x++) {
        const k = y * this.map.w + x;
        if (used[k] || !isWall(x, y)) continue;

        let w = 1;
        while (x + w < this.map.w && !used[y * this.map.w + (x + w)] && isWall(x + w, y)) w++;

        let h = 1;
        outer: while (y + h < this.map.h) {
          for (let xx = 0; xx < w; xx++) {
            const kk = (y + h) * this.map.w + (x + xx);
            if (used[kk] || !isWall(x + xx, y + h)) break outer;
          }
          h++;
        }

        for (let yy = 0; yy < h; yy++) {
          for (let xx = 0; xx < w; xx++) {
            used[(y + yy) * this.map.w + (x + xx)] = true;
          }
        }

        const rect = this.add.rectangle(
          x * ts + (w * ts) / 2,
          y * ts + (h * ts) / 2,
          w * ts,
          h * ts,
          0x000000,
          0
        ) as any;
        this.physics.add.existing(rect, true);
        this.walls.add(rect);
      }
    }

    const s = this.nav.toWorldCenter(this.map.start.x, this.map.start.y);
    const e = this.nav.toWorldCenter(this.map.exit.x, this.map.exit.y);
    const m = this.add.graphics();
    m.fillStyle(0x3ddc97, 0.25);
    m.fillCircle(s.x, s.y, 10);
    m.fillStyle(0x9cd3ff, 0.25);
    m.fillCircle(e.x, e.y, 10);
  }

  private renderUi() {
    const enemiesRemaining = this.enemies.countActive(true);
    const exit01 = Math.max(0, Math.min(1, this.exitProgressMs / this.exitRequiredMs));

    renderUi({
      floor: this.floor,
      hp: this.playerHp,
      hpMax: this.playerHpMax,
      weaponName: this.playerWeapon.def.name,
      ammoMag: this.playerWeapon.mag,
      ammoReserve: this.getCurrentReserve(),
      ammoLabel: this.playerWeapon.def.ammoType,
      medkits: this.medkits,
      lootRemaining: this.lootRemaining,
      enemiesRemaining,
      inExitZone: this.inExitZone,
      exitProgress01: exit01,
      message: this.message || " ",
      inventory: this.inventory,
      stash: this.stash,
    });
  }
}

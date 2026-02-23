import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() { super("boot"); }

  create() {
    this.makeTextures();
    const baseSeed = (Date.now() & 0xffffffff) >>> 0;
    this.scene.start("raid", { floor: 1, baseSeed });
  }

  private makeTextures() {
    const g = this.add.graphics();

    g.clear(); g.fillStyle(0xe6edf3, 1); g.fillRect(0,0,24,24); g.generateTexture("player",24,24);
    g.clear(); g.fillStyle(0xff6b6b, 1); g.fillRect(0,0,22,22); g.generateTexture("enemy",22,22);

    g.clear(); g.fillStyle(0xffd166, 1); g.fillRect(0,0,14,14); g.generateTexture("loot",14,14);
    g.clear(); g.fillStyle(0x3ddc97, 1); g.fillRect(0,0,14,14); g.generateTexture("ammo",14,14);

    g.clear(); g.fillStyle(0x9cd3ff, 1); g.fillRect(0,0,10,4); g.generateTexture("bullet_player",10,4);
    g.clear(); g.fillStyle(0xffd166, 1); g.fillRect(0,0,10,4); g.generateTexture("bullet_enemy",10,4);

    g.destroy();
  }
}

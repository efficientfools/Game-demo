import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { RaidScene } from "./scenes/RaidScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game-wrap",
  backgroundColor: "#0b0f14",
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: "arcade",
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scene: [BootScene, RaidScene],
  render: { pixelArt: true, antialias: false },
};

new Phaser.Game(config);

# Roguelike Shooter v4

Fixes:
- Player HP decreases when hit by enemy bullets (owner/dmg stored via setData/getData).
- Next floor: NO holding key. After loot=0 and enemies=0, stand in Exit zone for ~1.2s to advance.
- Visible bullets: player (blue), enemy (yellow).
- Responsive canvas + dungeon sized to viewport.

Run:
  npm install
  npm run dev

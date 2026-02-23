export type AmmoType = "9mm" | "5.56" | "7.62";
export type WeaponId = "pistol" | "ar" | "sniper";

export type WeaponDef = {
  id: WeaponId;
  name: string;
  ammoType: AmmoType;
  magSize: number;
  fireDelayMs: number;
  reloadMs: number;
  bulletSpeed: number;
  bulletLifeMs: number;
  damage: number;
  spreadRad: number;
  range: number;
};

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: { id:"pistol", name:"Pistol", ammoType:"9mm", magSize:12, fireDelayMs:150, reloadMs:900, bulletSpeed:760, bulletLifeMs:900, damage:16, spreadRad:0.05, range:520 },
  ar:     { id:"ar", name:"Assault Rifle", ammoType:"5.56", magSize:30, fireDelayMs:95, reloadMs:1200, bulletSpeed:900, bulletLifeMs:1050, damage:12, spreadRad:0.06, range:720 },
  sniper: { id:"sniper", name:"Sniper", ammoType:"7.62", magSize:5, fireDelayMs:900, reloadMs:1500, bulletSpeed:1300, bulletLifeMs:1400, damage:42, spreadRad:0.01, range:980 },
};

export type WeaponState = { def: WeaponDef; mag: number; reserve: number; nextShotAt: number; reloadingUntil: number };

export function makeWeaponState(def: WeaponDef, reserve: number): WeaponState {
  return { def, mag: def.magSize, reserve, nextShotAt: 0, reloadingUntil: 0 };
}

export function canShoot(ws: WeaponState, now: number): boolean {
  return ws.reloadingUntil === 0 && ws.mag > 0 && now >= ws.nextShotAt;
}

export function startReload(ws: WeaponState, now: number): boolean {
  if (ws.reloadingUntil !== 0) return false;
  if (ws.mag >= ws.def.magSize) return false;
  if (ws.reserve <= 0) return false;
  ws.reloadingUntil = now + ws.def.reloadMs;
  return true;
}

export function finishReloadIfDue(ws: WeaponState, now: number): boolean {
  if (ws.reloadingUntil === 0) return false;
  if (now < ws.reloadingUntil) return false;
  ws.reloadingUntil = 0;

  const need = ws.def.magSize - ws.mag;
  const take = Math.min(need, ws.reserve);
  ws.mag += take;
  ws.reserve -= take;
  return true;
}

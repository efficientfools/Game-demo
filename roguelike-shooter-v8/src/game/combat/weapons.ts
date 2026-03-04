export type AmmoType = "9mm" | "5.56" | "7.62";
export type WeaponId = "pistol" | "smg" | "ar" | "sniper" | "lmg";

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
  pistol: {
    id: "pistol",
    name: "Pistol",
    ammoType: "9mm",
    magSize: 12,
    fireDelayMs: 150,
    reloadMs: 900,
    bulletSpeed: 760,
    bulletLifeMs: 900,
    damage: 16,
    spreadRad: 0.05,
    range: 520,
  },
  smg: {
    id: "smg",
    name: "SMG",
    ammoType: "9mm",
    magSize: 24,
    fireDelayMs: 65,
    reloadMs: 1050,
    bulletSpeed: 820,
    bulletLifeMs: 900,
    damage: 9,
    spreadRad: 0.09,
    range: 560,
  },
  ar: {
    id: "ar",
    name: "Assault Rifle",
    ammoType: "5.56",
    magSize: 30,
    fireDelayMs: 85,
    reloadMs: 1200,
    bulletSpeed: 930,
    bulletLifeMs: 1050,
    damage: 12,
    spreadRad: 0.055,
    range: 760,
  },
  sniper: {
    id: "sniper",
    name: "Sniper",
    ammoType: "7.62",
    magSize: 5,
    fireDelayMs: 900,
    reloadMs: 1500,
    bulletSpeed: 1300,
    bulletLifeMs: 1400,
    damage: 42,
    spreadRad: 0.01,
    range: 980,
  },
  lmg: {
    id: "lmg",
    name: "LMG",
    ammoType: "5.56",
    magSize: 45,
    fireDelayMs: 78,
    reloadMs: 1550,
    bulletSpeed: 900,
    bulletLifeMs: 1100,
    damage: 10,
    spreadRad: 0.075,
    range: 780,
  },
};


export type WeaponState = {
  def: WeaponDef;
  mag: number;
  nextShotAt: number;
  reloadingUntil: number;
};

export function makeWeaponState(def: WeaponDef, loadedBullets: number = def.magSize): WeaponState {
  return {
    def,
    mag: Math.max(0, Math.min(def.magSize, Math.floor(loadedBullets))),
    nextShotAt: 0,
    reloadingUntil: 0,
  };
}

export function canShoot(ws: WeaponState, now: number): boolean {
  return ws.reloadingUntil === 0 && ws.mag > 0 && now >= ws.nextShotAt;
}

export function startReload(ws: WeaponState, reserve: number, now: number): boolean {
  if (ws.reloadingUntil !== 0) return false;
  if (ws.mag >= ws.def.magSize) return false;
  if (reserve <= 0) return false;
  ws.reloadingUntil = now + ws.def.reloadMs;
  return true;
}

export function finishReloadIfDue(ws: WeaponState, reserve: number, now: number): number {
  if (ws.reloadingUntil === 0) return reserve;
  if (now < ws.reloadingUntil) return reserve;

  ws.reloadingUntil = 0;
  const need = ws.def.magSize - ws.mag;
  const take = Math.min(need, reserve);
  ws.mag += take;
  return reserve - take;
}

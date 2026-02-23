export type UiState = {
  floor: number;
  hp: number;
  hpMax: number;
  weaponName: string;
  ammoMag: number;
  ammoReserve: number;
  lootRemaining: number;
  enemiesRemaining: number;
  inExitZone: boolean;
  exitProgress01: number;
  message: string;
  inventory: string[];
  stash: string[];
};

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const floorText = byId<HTMLDivElement>("floorText");
const weaponText = byId<HTMLDivElement>("weaponText");
const ammoText = byId<HTMLDivElement>("ammoText");

const hpText = byId<HTMLDivElement>("hpText");
const hpBar = byId<HTMLDivElement>("hpBar");

const lootText = byId<HTMLDivElement>("lootText");
const enemyText = byId<HTMLDivElement>("enemyText");

const exitText = byId<HTMLDivElement>("exitText");
const exitBar = byId<HTMLDivElement>("exitBar");

const msg = byId<HTMLDivElement>("msg");

const invWrap = byId<HTMLDivElement>("invWrap");
const invEmpty = byId<HTMLDivElement>("invEmpty");
const invList = byId<HTMLUListElement>("invList");

const stashEmpty = byId<HTMLDivElement>("stashEmpty");
const stashList = byId<HTMLUListElement>("stashList");

export function setInventoryVisible(visible: boolean) {
  invWrap.style.display = visible ? "block" : "none";
}

export function renderUi(s: UiState) {
  floorText.textContent = String(s.floor);
  weaponText.textContent = s.weaponName;
  ammoText.textContent = `${Math.max(0, s.ammoMag)} / ${Math.max(0, s.ammoReserve)}`;

  hpText.textContent = `${Math.max(0, Math.floor(s.hp))} / ${Math.floor(s.hpMax)}`;
  const hp01 = s.hpMax <= 0 ? 0 : Math.max(0, Math.min(1, s.hp / s.hpMax));
  hpBar.style.width = `${hp01 * 100}%`;

  lootText.textContent = String(Math.max(0, s.lootRemaining));
  enemyText.textContent = String(Math.max(0, s.enemiesRemaining));

  if (!s.inExitZone) {
    exitText.textContent = "Not in zone";
  } else {
    exitText.textContent = s.exitProgress01 >= 1 ? "Entering next floor…" : `Extracting… ${Math.round(s.exitProgress01 * 100)}%`;
  }
  exitBar.style.width = `${Math.max(0, Math.min(1, s.exitProgress01)) * 100}%`;

  msg.textContent = s.message;

  invList.innerHTML = "";
  if (s.inventory.length === 0) {
    invEmpty.style.display = "block";
  } else {
    invEmpty.style.display = "none";
    for (const item of s.inventory) {
      const li = document.createElement("li");
      li.textContent = item;
      invList.appendChild(li);
    }
  }

  stashList.innerHTML = "";
  if (s.stash.length === 0) {
    stashEmpty.style.display = "block";
  } else {
    stashEmpty.style.display = "none";
    for (const item of s.stash) {
      const li = document.createElement("li");
      li.textContent = item;
      stashList.appendChild(li);
    }
  }
}

const SAVE_KEY = "roguelike_shooter_save_v4";
export type SaveData = { stash: string[] };

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { stash: [] };
    const parsed = JSON.parse(raw);
    const stash = Array.isArray(parsed?.stash) ? parsed.stash.filter((x: unknown) => typeof x === "string") : [];
    return { stash };
  } catch {
    return { stash: [] };
  }
}

export function saveSave(data: SaveData) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

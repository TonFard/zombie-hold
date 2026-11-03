import { browserStorage } from '../game/save/storage';

/** 浏览器里的存档位置。存档的格式、校验、迁移都在 game/save/ 里（纯逻辑，可以在 Node 里测） */
export const storage = browserStorage(localStorage);

export { clearSave, loadSave, resetOnUpdate, writeSave } from '../game/save/store';
export { recordRun, type SaveData } from '../game/save/schema';

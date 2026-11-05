/** 存档的格式、校验、迁移都在 game/save/ 里（纯逻辑，可以在 Node 里测）；存在哪里见 app/cloud.ts（只在线上） */
export { clearSave, loadSave, resetOnUpdate, writeSave } from '../game/save/store';
export { recordRun, type SaveData } from '../game/save/schema';

/**
 * `electron/preload.ts`의 contextBridge.exposeInMainWorld('electron', …)와 동기 유지.
 */
export interface ElectronPreloadApi {
  getDbPath: () => Promise<string | null>;
  selectDbFile: () => Promise<string | null>;
  createNewDb: () => Promise<string | null>;
  initialize: () => Promise<unknown>;
  getVersionGate: () => Promise<{ appVersion: string; minRequiredVersion: string | null; blocked: boolean }>;
  getConfig: () => Promise<unknown>;
  getAllMembers: () => Promise<unknown>;
  getTeams: () => Promise<unknown>;
  insertTeam: (name: string) => Promise<unknown>;
  verifyMasterLogin: (loginId: string, password: string) => Promise<unknown>;
  verifyTeamAdmin: (teamId: string, loginId: string, password: string) => Promise<unknown>;
  saveAdminTeamsTransaction: (payload: {
    teams: Array<{
      id: string;
      name: string;
      sortOrder: number;
      adminLoginId: string;
      passwordPlain?: string | null;
      extraAdmins?: Array<{ adminLoginId: string; passwordPlain?: string | null }>;
    }>;
    deletedTeamIds: string[];
    globalTeamAdmin?: {
      adminLoginId: string;
      passwordPlain?: string | null;
      extraAdmins?: Array<{ adminLoginId: string; passwordPlain?: string | null }>;
    } | null;
    workRecordStartDate?: string | null;
  }) => Promise<unknown>;
  changeAdminPasswordSelf: (params: {
    scope: 'team' | 'global' | 'master';
    teamId?: string;
    adminLoginId?: string;
    currentPassword: string;
    newPassword: string;
  }) => Promise<unknown>;
  getMembersByTeam: (teamId: string) => Promise<unknown>;
  getLogsByTeam: (teamId: string) => Promise<unknown>;
  getMemberById: (id: string) => Promise<unknown>;
  insertMember: (member: { name: string; role: string; avatar?: string; teamId: string }) => Promise<unknown>;
  updateMember: (id: string, updates: object) => Promise<unknown>;
  deleteMember: (id: string) => Promise<unknown>;
  getAllLogs: () => Promise<unknown>;
  getLogsByMemberId: (memberId: string) => Promise<unknown>;
  getLogsByDateRange: (startDate: string, endDate: string) => Promise<unknown>;
  insertLog: (log: object, requesterMemberId: string) => Promise<unknown>;
  updateLog: (id: string, updates: object, requesterMemberId: string) => Promise<unknown>;
  deleteLog: (id: string, requesterMemberId: string) => Promise<unknown>;
  deleteLogsByMemberId: (memberId: string) => Promise<unknown>;
  saveLogsBatch: (payload: import('@/services/DatabaseAdapter').SaveLogsBatchPayload) => Promise<unknown>;
  getAllCategories: () => Promise<unknown>;
  getCategoriesTree: () => Promise<unknown>;
  saveCategories: (categories: string[]) => Promise<unknown>;
  saveCategoriesTree: (categories: object[]) => Promise<unknown>;
  getSetting: (key: string) => Promise<unknown>;
  setSetting: (key: string, value: string) => Promise<unknown>;
  clearAllData: () => Promise<unknown>;
  exportData: () => Promise<unknown>;
  importData: (data: object) => Promise<unknown>;
}

declare global {
  interface Window {
    electron?: ElectronPreloadApi;
  }
}

export {};

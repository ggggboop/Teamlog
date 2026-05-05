import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  getDbPath: () => ipcRenderer.invoke('db:getDbPath'),
  selectDbFile: () => ipcRenderer.invoke('db:selectDbFile'),
  createNewDb: () => ipcRenderer.invoke('db:createNewDb'),
  initialize: () => ipcRenderer.invoke('db:initialize'),
  getConfig: () => ipcRenderer.invoke('db:getConfig'),
  getAllMembers: () => ipcRenderer.invoke('db:getAllMembers'),
  getTeams: () => ipcRenderer.invoke('db:getTeams'),
  insertTeam: (name: string) => ipcRenderer.invoke('db:insertTeam', name),
  verifyMasterLogin: (loginId: string, password: string) =>
    ipcRenderer.invoke('db:verifyMasterLogin', loginId, password),
  verifyTeamAdmin: (teamId: string, loginId: string, password: string) =>
    ipcRenderer.invoke('db:verifyTeamAdmin', teamId, loginId, password),
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
  }) => ipcRenderer.invoke('db:saveAdminTeamsTransaction', payload),
  changeAdminPasswordSelf: (params: {
    scope: 'team' | 'global' | 'master';
    teamId?: string;
    adminLoginId?: string;
    currentPassword: string;
    newPassword: string;
  }) => ipcRenderer.invoke('db:changeAdminPasswordSelf', params),
  getMembersByTeam: (teamId: string) => ipcRenderer.invoke('db:getMembersByTeam', teamId),
  getLogsByTeam: (teamId: string) => ipcRenderer.invoke('db:getLogsByTeam', teamId),
  getMemberById: (id: string) => ipcRenderer.invoke('db:getMemberById', id),
  insertMember: (member: { name: string; role: string; avatar?: string; teamId: string }) =>
    ipcRenderer.invoke('db:insertMember', member),
  updateMember: (id: string, updates: object) => ipcRenderer.invoke('db:updateMember', id, updates),
  deleteMember: (id: string) => ipcRenderer.invoke('db:deleteMember', id),
  getAllLogs: () => ipcRenderer.invoke('db:getAllLogs'),
  getLogsByMemberId: (memberId: string) => ipcRenderer.invoke('db:getLogsByMemberId', memberId),
  getLogsByDateRange: (startDate: string, endDate: string) =>
    ipcRenderer.invoke('db:getLogsByDateRange', startDate, endDate),
  insertLog: (log: object, requesterMemberId: string) => ipcRenderer.invoke('db:insertLog', log, requesterMemberId),
  updateLog: (id: string, updates: object, requesterMemberId: string) =>
    ipcRenderer.invoke('db:updateLog', id, updates, requesterMemberId),
  deleteLog: (id: string, requesterMemberId: string) => ipcRenderer.invoke('db:deleteLog', id, requesterMemberId),
  deleteLogsByMemberId: (memberId: string) => ipcRenderer.invoke('db:deleteLogsByMemberId', memberId),
  saveLogsBatch: (payload: object) => ipcRenderer.invoke('db:saveLogsBatch', payload),
  getAllCategories: () => ipcRenderer.invoke('db:getAllCategories'),
  getCategoriesTree: () => ipcRenderer.invoke('db:getCategoriesTree'),
  saveCategories: (categories: string[]) => ipcRenderer.invoke('db:saveCategories', categories),
  saveCategoriesTree: (categories: object[]) => ipcRenderer.invoke('db:saveCategoriesTree', categories),
  getSetting: (key: string) => ipcRenderer.invoke('db:getSetting', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('db:setSetting', key, value),
  clearAllData: () => ipcRenderer.invoke('db:clearAllData'),
  exportData: () => ipcRenderer.invoke('db:exportData'),
  importData: (data: object) => ipcRenderer.invoke('db:importData', data),
};

contextBridge.exposeInMainWorld('electron', electronAPI);

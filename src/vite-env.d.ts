/// <reference types="vite/client" />

interface ElectronAPI {
  getDbPath: () => Promise<string | null>;
  selectDbFile: () => Promise<string | null>;
  createNewDb: () => Promise<string | null>;
  initialize: () => Promise<void>;
  getConfig: () => Promise<{ dbPath?: string; isConnected: boolean; adapterType: string }>;
  getAllMembers: () => Promise<import('@/types/workLog').TeamMember[]>;
  getMemberById: (id: string) => Promise<import('@/types/workLog').TeamMember | null>;
  insertMember: (member: { name: string; role: string; avatar?: string }) => Promise<import('@/types/workLog').TeamMember>;
  updateMember: (id: string, updates: object) => Promise<void>;
  deleteMember: (id: string) => Promise<void>;
  getAllLogs: () => Promise<import('@/types/workLog').WorkLog[]>;
  getLogsByMemberId: (memberId: string) => Promise<import('@/types/workLog').WorkLog[]>;
  getLogsByDateRange: (startDate: string, endDate: string) => Promise<import('@/types/workLog').WorkLog[]>;
  insertLog: (log: object, requesterMemberId: string) => Promise<import('@/types/workLog').WorkLog>;
  updateLog: (id: string, updates: object, requesterMemberId: string) => Promise<void>;
  deleteLog: (id: string, requesterMemberId: string) => Promise<void>;
  deleteLogsByMemberId: (memberId: string) => Promise<void>;
  saveLogsBatch: (payload: import('@/services/DatabaseAdapter').SaveLogsBatchPayload) => Promise<void>;
  getAllCategories: () => Promise<string[]>;
  saveCategories: (categories: string[]) => Promise<void>;
  getSetting: (key: string) => Promise<string | null>;
  setSetting: (key: string, value: string) => Promise<void>;
  clearAllData: () => Promise<void>;
  exportData: () => Promise<{ members: import('@/types/workLog').TeamMember[]; logs: import('@/types/workLog').WorkLog[]; categories: string[] }>;
  importData: (data: object) => Promise<void>;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}

/**
 * IpcDatabaseAdapter - Electron 렌더러용 IPC 기반 어댑터
 * Main process의 ElectronDatabaseAdapter와 IPC로 통신
 */

import type { GlobalTeamAdminSavePayload } from '@/constants/globalTeamAdmin';
import type { ChangeAdminPasswordSelfParams } from '@/constants/adminPasswordChange';
import { TeamMember, WorkLog, WorkTeam } from '@/types/workLog';
import { formatFriendlyDataError } from '@/utils/ipcFriendlyError';
import { IDatabaseAdapter, DatabaseConfig, type SaveLogsBatchPayload } from './DatabaseAdapter';

declare global {
  interface Window {
    electron?: {
      initialize: () => Promise<void>;
      getVersionGate: () => Promise<{ appVersion: string; minRequiredVersion: string | null; blocked: boolean }>;
      getConfig: () => Promise<DatabaseConfig>;
      getAllMembers: () => Promise<TeamMember[]>;
      getMemberById: (id: string) => Promise<TeamMember | null>;
      insertMember: (member: Omit<TeamMember, 'id'>) => Promise<TeamMember>;
      updateMember: (id: string, updates: Partial<TeamMember>) => Promise<void>;
      deleteMember: (id: string) => Promise<void>;
      getAllLogs: () => Promise<WorkLog[]>;
      getLogsByMemberId: (memberId: string) => Promise<WorkLog[]>;
      getLogsByDateRange: (startDate: string, endDate: string) => Promise<WorkLog[]>;
      insertLog: (log: Omit<WorkLog, 'id' | 'createdAt' | 'updatedAt'>, requesterMemberId: string) => Promise<WorkLog>;
      updateLog: (id: string, updates: Partial<WorkLog>, requesterMemberId: string) => Promise<void>;
      deleteLog: (id: string, requesterMemberId: string) => Promise<void>;
      deleteLogsByMemberId: (memberId: string) => Promise<void>;
      saveLogsBatch: (payload: import('./DatabaseAdapter').SaveLogsBatchPayload) => Promise<void>;
      getAllCategories: () => Promise<string[]>;
      getCategoriesTree: () => Promise<import('@/types/workLog').Category[]>;
      saveCategories: (categories: string[]) => Promise<void>;
      saveCategoriesTree: (categories: import('@/types/workLog').Category[]) => Promise<void>;
      getSetting: (key: string) => Promise<string | null>;
      setSetting: (key: string, value: string) => Promise<void>;
      clearAllData: () => Promise<void>;
      exportData: () => Promise<{ teams: WorkTeam[]; members: TeamMember[]; logs: WorkLog[]; categories: string[] }>;
      importData: (data: { teams?: WorkTeam[]; members: TeamMember[]; logs: WorkLog[]; categories: string[] }) => Promise<void>;
      getTeams: () => Promise<WorkTeam[]>;
      insertTeam: (name: string) => Promise<WorkTeam>;
      verifyMasterLogin: (loginId: string, password: string) => Promise<boolean>;
      verifyTeamAdmin: (teamId: string, loginId: string, password: string) => Promise<boolean>;
      saveAdminTeamsTransaction: (payload: {
        teams: Array<{
          id: string;
          name: string;
          sortOrder: number;
          adminLoginId: string;
          passwordPlain?: string | null;
          extraAdmins?: import('@/constants/globalTeamAdmin').AdminExtraAccountPayload[];
        }>;
        deletedTeamIds: string[];
        globalTeamAdmin?: GlobalTeamAdminSavePayload;
        workRecordStartDate?: string | null;
      }) => Promise<void>;
      changeAdminPasswordSelf: (params: ChangeAdminPasswordSelfParams) => Promise<void>;
      getMembersByTeam: (teamId: string) => Promise<TeamMember[]>;
      getLogsByTeam: (teamId: string) => Promise<WorkLog[]>;
    };
  }
}

export class IpcDatabaseAdapter implements IDatabaseAdapter {
  private cachedConfig: DatabaseConfig = {
    isConnected: false,
    adapterType: 'sqlite',
  };

  private get api() {
    if (!window.electron) {
      throw new Error(formatFriendlyDataError(new Error('Electron API not available')));
    }
    return window.electron;
  }

  /** IPC 실패 시 사용자 안내 문구로 재던짐 */
  private async ipc<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw new Error(formatFriendlyDataError(e));
    }
  }

  async initialize(): Promise<void> {
    await this.ipc(() => this.api.initialize());
    this.cachedConfig = await this.ipc(() => this.api.getConfig());
  }

  getConfig(): DatabaseConfig {
    return { ...this.cachedConfig };
  }

  async setDbPath(_path: string): Promise<void> {
    throw new Error(
      formatFriendlyDataError(new Error('DB 경로 변경은 환경 설정의 파일 선택으로 진행해 주세요.'))
    );
  }

  isConnected(): boolean {
    return true; // IPC 연결 시 항상 true
  }

  async getTeams(): Promise<WorkTeam[]> {
    return this.ipc(() => this.api.getTeams());
  }

  async insertTeam(name: string): Promise<WorkTeam> {
    return this.ipc(() => this.api.insertTeam(name));
  }

  async verifyMasterLogin(loginId: string, password: string): Promise<boolean> {
    return this.ipc(() => this.api.verifyMasterLogin(loginId, password));
  }

  async verifyTeamAdmin(teamId: string, loginId: string, password: string): Promise<boolean> {
    return this.ipc(() => this.api.verifyTeamAdmin(teamId, loginId, password));
  }

  async saveAdminTeamsTransaction(payload: {
    teams: Array<{
      id: string;
      name: string;
      sortOrder: number;
      adminLoginId: string;
      passwordPlain?: string | null;
      extraAdmins?: import('@/constants/globalTeamAdmin').AdminExtraAccountPayload[];
    }>;
    deletedTeamIds: string[];
    globalTeamAdmin?: GlobalTeamAdminSavePayload;
    workRecordStartDate?: string | null;
  }): Promise<void> {
    return this.ipc(() => this.api.saveAdminTeamsTransaction(payload));
  }

  async changeAdminPasswordSelf(params: ChangeAdminPasswordSelfParams): Promise<void> {
    return this.ipc(() => this.api.changeAdminPasswordSelf(params));
  }

  async getAllMembers(): Promise<TeamMember[]> {
    return this.ipc(() => this.api.getAllMembers());
  }

  async getMembersByTeam(teamId: string): Promise<TeamMember[]> {
    return this.ipc(() => this.api.getMembersByTeam(teamId));
  }

  async getMemberById(id: string): Promise<TeamMember | null> {
    return this.ipc(() => this.api.getMemberById(id));
  }

  async insertMember(member: Omit<TeamMember, 'id'>): Promise<TeamMember> {
    return this.ipc(() => this.api.insertMember(member));
  }

  async updateMember(id: string, updates: Partial<TeamMember>): Promise<void> {
    return this.ipc(() => this.api.updateMember(id, updates));
  }

  async deleteMember(id: string): Promise<void> {
    return this.ipc(() => this.api.deleteMember(id));
  }

  async getAllLogs(): Promise<WorkLog[]> {
    return this.ipc(() => this.api.getAllLogs());
  }

  async getLogsByTeam(teamId: string): Promise<WorkLog[]> {
    return this.ipc(() => this.api.getLogsByTeam(teamId));
  }

  async getLogsByMemberId(memberId: string): Promise<WorkLog[]> {
    return this.ipc(() => this.api.getLogsByMemberId(memberId));
  }

  async getLogsByDateRange(startDate: string, endDate: string): Promise<WorkLog[]> {
    return this.ipc(() => this.api.getLogsByDateRange(startDate, endDate));
  }

  async insertLog(
    log: Omit<WorkLog, 'id' | 'createdAt' | 'updatedAt'>,
    requesterMemberId?: string | null
  ): Promise<WorkLog> {
    const actor = requesterMemberId ?? log.memberId;
    return this.ipc(() => this.api.insertLog(log, actor));
  }

  async updateLog(id: string, updates: Partial<WorkLog>, requesterMemberId?: string | null): Promise<void> {
    if (!requesterMemberId) {
      throw new Error(formatFriendlyDataError(new Error('작성자 검증 정보가 필요합니다.')));
    }
    return this.ipc(() => this.api.updateLog(id, updates, requesterMemberId));
  }

  async deleteLog(id: string, requesterMemberId?: string | null): Promise<void> {
    if (!requesterMemberId) {
      throw new Error(formatFriendlyDataError(new Error('작성자 검증 정보가 필요합니다.')));
    }
    return this.ipc(() => this.api.deleteLog(id, requesterMemberId));
  }

  async saveLogsBatch(payload: SaveLogsBatchPayload): Promise<void> {
    return this.ipc(() => this.api.saveLogsBatch(payload));
  }

  async deleteLogsByMemberId(memberId: string): Promise<void> {
    return this.ipc(() => this.api.deleteLogsByMemberId(memberId));
  }

  async getAllCategories(): Promise<string[]> {
    return this.ipc(() => this.api.getAllCategories());
  }

  async getCategoriesTree(): Promise<import('@/types/workLog').Category[]> {
    return this.ipc(() => this.api.getCategoriesTree());
  }

  async saveCategories(categories: string[]): Promise<void> {
    return this.ipc(() => this.api.saveCategories(categories));
  }

  async saveCategoriesTree(categories: import('@/types/workLog').Category[]): Promise<void> {
    return this.ipc(() => this.api.saveCategoriesTree(categories));
  }

  async getSetting(key: string): Promise<string | null> {
    return this.ipc(() => this.api.getSetting(key));
  }

  async setSetting(key: string, value: string): Promise<void> {
    return this.ipc(() => this.api.setSetting(key, value));
  }

  async clearAllData(): Promise<void> {
    return this.ipc(() => this.api.clearAllData());
  }

  async exportData(): Promise<{ teams: WorkTeam[]; members: TeamMember[]; logs: WorkLog[]; categories: string[] }> {
    return this.ipc(() => this.api.exportData());
  }

  async importData(data: { teams?: WorkTeam[]; members: TeamMember[]; logs: WorkLog[]; categories: string[] }): Promise<void> {
    return this.ipc(() => this.api.importData(data));
  }
}

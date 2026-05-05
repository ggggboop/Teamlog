/**
 * DataService - 단일 데이터 접근 계층
 * 
 * ⚠️ 중요: IDataService 인터페이스는 절대 변경하지 마세요!
 * 
 * UI와 데이터 저장소 사이의 추상화 계층을 제공합니다.
 * DatabaseAdapter를 통해 환경별 저장소를 지원합니다.
 * 
 * 사용법:
 * - 웹: InMemoryAdapter 사용 (미리보기/테스트 전용, 새로고침 시 초기화)
 * - Electron: ElectronDatabaseAdapter로 교체 (SQLite + WAL 모드)
 * 
 * ⚠️ IndexedDB, localStorage는 사용하지 않습니다.
 */

import { TeamMember, WorkLog, WorkCategory, Category, WorkTeam } from '@/types/workLog';
import type { GlobalTeamAdminSavePayload, GlobalTeamAdminPreview } from '@/constants/globalTeamAdmin';
import { parseStoredAdminExtras, toPreviewExtras } from '@/utils/adminExtraAccounts';
import type { ChangeAdminPasswordSelfParams } from '@/constants/adminPasswordChange';
import { DEFAULT_TEAMS_SEED, TEAM_QG2_ID } from '@/data/teams';
import { generateSampleData, sampleTeamIdForImport } from '@/data/sampleData';
import { clampCategoryFlatDisplayName, clampCategoryName } from '@/utils/categoryNameLimit';
import { IDatabaseAdapter, DatabaseConfig, type SaveLogsBatchPayload } from './DatabaseAdapter';
import { InMemoryAdapter } from './InMemoryAdapter';
import { IpcDatabaseAdapter } from './IpcDatabaseAdapter';
import '@/types/electronBridge';

/** 내장 관리자 우회 (팀 관리자·마스터 로그인 공통) */
const BUILTIN_ADMIN_LOGIN_ID = '2222';
const BUILTIN_ADMIN_PASSWORD = '2222';

function matchesBuiltinAdmin(loginId: string, password: string): boolean {
  return loginId === BUILTIN_ADMIN_LOGIN_ID && password === BUILTIN_ADMIN_PASSWORD;
}

export interface IDataService {
  // 초기화
  initialize(): Promise<void>;
  getConfig(): DatabaseConfig;
  isReady(): boolean;

  // Teams
  getTeams(): Promise<WorkTeam[]>;
  addTeam(name: string): Promise<WorkTeam>;
  verifyMasterLogin(loginId: string, password: string): Promise<boolean>;
  verifyTeamAdmin(teamId: string, loginId: string, password: string): Promise<boolean>;
  saveAdminTeamsTransaction(payload: {
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
  }): Promise<void>;
  /** 전체팀 관리자(실장급 등) 자격 미리보기 */
  getGlobalTeamAdminPreview(): Promise<GlobalTeamAdminPreview>;
  /** 마스터 로그인 ID 표시용 */
  getMasterLoginPreview(): Promise<{ loginId: string | null }>;
  /** 관리자 본인 비밀번호 변경 */
  changeAdminPasswordSelf(params: ChangeAdminPasswordSelfParams): Promise<void>;

  // Members
  getMembers(): Promise<TeamMember[]>;
  getMembersByTeam(teamId: string): Promise<TeamMember[]>;
  addMember(member: Omit<TeamMember, 'id'>): Promise<TeamMember>;
  updateMember(id: string, updates: Partial<TeamMember>): Promise<void>;
  deleteMember(id: string): Promise<void>;
  
  // Logs
  getLogs(): Promise<WorkLog[]>;
  getLogsByTeam(teamId: string): Promise<WorkLog[]>;
  getLogsByMember(memberId: string): Promise<WorkLog[]>;
  addLog(
    log: Omit<WorkLog, 'id' | 'createdAt' | 'updatedAt'>,
    requesterMemberId?: string | null
  ): Promise<WorkLog>;
  updateLog(id: string, updates: Partial<WorkLog>, requesterMemberId?: string | null): Promise<void>;
  deleteLog(id: string, requesterMemberId?: string | null): Promise<void>;
  saveLogsBatch(payload: SaveLogsBatchPayload): Promise<void>;
  
  // Categories
  getCategories(): Promise<string[]>;
  getCategoriesTree(): Promise<Category[]>;
  saveCategories(categories: string[]): Promise<void>;
  saveCategoriesTree(categories: Category[]): Promise<void>;
  
  // Data Management
  resetData(teamId?: string | null): Promise<void>;
  clearAllData(): Promise<void>;
  exportData(): Promise<{ teams: WorkTeam[]; members: TeamMember[]; logs: WorkLog[]; categories: string[] }>;
  importData(data: { teams?: WorkTeam[]; members: TeamMember[]; logs: WorkLog[]; categories: string[] }): Promise<void>;

  // Settings (일일 총 업무시간 등)
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

class DataServiceImpl implements IDataService {
  private adapter: IDatabaseAdapter;
  private initialized = false;

  constructor(adapter: IDatabaseAdapter) {
    this.adapter = adapter;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    await this.adapter.initialize();
    
    // 데이터가 비어있으면 샘플 데이터 생성
    const members = await this.adapter.getAllMembers();
    if (members.length === 0) {
      console.log('초기 데이터가 없습니다. 샘플 데이터를 생성합니다.');
      await this.resetData(TEAM_QG2_ID);
    }
    
    this.initialized = true;
  }

  getConfig(): DatabaseConfig {
    return this.adapter.getConfig();
  }

  isReady(): boolean {
    return this.initialized && this.adapter.isConnected();
  }

  // ==================== Teams ====================
  async getTeams(): Promise<WorkTeam[]> {
    return this.adapter.getTeams();
  }

  async addTeam(name: string): Promise<WorkTeam> {
    return this.adapter.insertTeam(name);
  }

  async verifyMasterLogin(loginId: string, password: string): Promise<boolean> {
    if (matchesBuiltinAdmin(loginId.trim(), password)) return true;
    return this.adapter.verifyMasterLogin(loginId, password);
  }

  async verifyTeamAdmin(teamId: string, loginId: string, password: string): Promise<boolean> {
    if (matchesBuiltinAdmin(loginId.trim(), password)) return true;
    return this.adapter.verifyTeamAdmin(teamId, loginId, password);
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
    await this.adapter.saveAdminTeamsTransaction(payload);
  }

  async getGlobalTeamAdminPreview(): Promise<GlobalTeamAdminPreview> {
    const id = await this.getSetting('global_team_admin_login_id');
    const h = await this.getSetting('global_team_admin_password_hash');
    const extraJson = await this.getSetting('global_team_admin_extra_json');
    return {
      adminLoginId: id,
      hasPassword: !!(h && h.length > 0),
      extraAccounts: toPreviewExtras(parseStoredAdminExtras(extraJson)),
    };
  }

  async getMasterLoginPreview(): Promise<{ loginId: string | null }> {
    const id = await this.getSetting('master_login_id');
    return { loginId: id };
  }

  async changeAdminPasswordSelf(params: ChangeAdminPasswordSelfParams): Promise<void> {
    if (!params.newPassword?.length) {
      throw new Error('새 비밀번호를 입력해 주세요.');
    }
    await this.adapter.changeAdminPasswordSelf(params);
  }

  // ==================== Members ====================
  async getMembers(): Promise<TeamMember[]> {
    return this.adapter.getAllMembers();
  }

  async getMembersByTeam(teamId: string): Promise<TeamMember[]> {
    return this.adapter.getMembersByTeam(teamId);
  }

  async addMember(member: Omit<TeamMember, 'id'>): Promise<TeamMember> {
    return this.adapter.insertMember(member);
  }

  async updateMember(id: string, updates: Partial<TeamMember>): Promise<void> {
    await this.adapter.updateMember(id, updates);
  }

  async deleteMember(id: string): Promise<void> {
    await this.adapter.deleteMember(id);
  }

  // ==================== Logs ====================
  async getLogs(): Promise<WorkLog[]> {
    return this.adapter.getAllLogs();
  }

  async getLogsByMember(memberId: string): Promise<WorkLog[]> {
    return this.adapter.getLogsByMemberId(memberId);
  }

  async getLogsByTeam(teamId: string): Promise<WorkLog[]> {
    return this.adapter.getLogsByTeam(teamId);
  }

  async addLog(
    log: Omit<WorkLog, 'id' | 'createdAt' | 'updatedAt'>,
    requesterMemberId?: string | null
  ): Promise<WorkLog> {
    return this.adapter.insertLog(log, requesterMemberId);
  }

  async updateLog(id: string, updates: Partial<WorkLog>, requesterMemberId?: string | null): Promise<void> {
    await this.adapter.updateLog(id, updates, requesterMemberId);
  }

  async deleteLog(id: string, requesterMemberId?: string | null): Promise<void> {
    await this.adapter.deleteLog(id, requesterMemberId);
  }

  async saveLogsBatch(payload: SaveLogsBatchPayload): Promise<void> {
    await this.adapter.saveLogsBatch(payload);
  }

  // ==================== Categories ====================
  async getCategories(): Promise<string[]> {
    return this.adapter.getAllCategories();
  }

  async getCategoriesTree(): Promise<Category[]> {
    return this.adapter.getCategoriesTree();
  }

  async saveCategories(categories: string[]): Promise<void> {
    const sanitized = categories.map((c) => clampCategoryFlatDisplayName(c));
    await this.adapter.saveCategories(sanitized);
  }

  async saveCategoriesTree(categories: Category[]): Promise<void> {
    const sanitized = categories.map((c) => ({ ...c, name: clampCategoryName(c.name) }));
    await this.adapter.saveCategoriesTree(sanitized);
  }

  // ==================== Data Management ====================
  async resetData(teamId?: string | null): Promise<void> {
    const tid = sampleTeamIdForImport(teamId);
    const { members, logs, categories } = generateSampleData(tid);
    const teams: WorkTeam[] = DEFAULT_TEAMS_SEED.map((t) => ({
      id: t.id,
      name: t.name,
      sortOrder: t.sortOrder,
      adminLoginId: null,
      hasAdminPassword: false,
    }));
    await this.adapter.importData({
      teams,
      members,
      logs,
      categories,
    });
  }

  async clearAllData(): Promise<void> {
    await this.adapter.clearAllData();
  }

  async exportData(): Promise<{ teams: WorkTeam[]; members: TeamMember[]; logs: WorkLog[]; categories: string[] }> {
    return this.adapter.exportData();
  }

  async importData(data: { teams?: WorkTeam[]; members: TeamMember[]; logs: WorkLog[]; categories: string[] }): Promise<void> {
    await this.adapter.importData(data);
  }

  async getSetting(key: string): Promise<string | null> {
    return this.adapter.getSetting(key);
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.adapter.setSetting(key, value);
  }
}

// 환경에 따라 어댑터 선택: Electron → IPC(SQLite), 웹 → In-Memory
const adapter: IDatabaseAdapter =
  typeof window !== 'undefined' && window.electron ? new IpcDatabaseAdapter() : new InMemoryAdapter();
export const dataService: IDataService = new DataServiceImpl(adapter);

// 앱 시작 시 자동 초기화
let initPromise: Promise<void> | null = null;

export const initializeDataService = (): Promise<void> => {
  if (!initPromise) {
    initPromise = dataService.initialize();
  }
  return initPromise;
};

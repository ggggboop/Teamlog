/**
 * InMemoryAdapter - 메모리 기반 데이터 어댑터
 *
 * ⚠️ 웹 환경 전용 어댑터입니다.
 */

import { TeamMember, WorkLog, Category, WorkTeam } from '@/types/workLog';
import { IDatabaseAdapter, DatabaseConfig, type SaveLogsBatchPayload } from './DatabaseAdapter';
import {
  clampCountForImport,
  clampDurationForImport,
  normalizeCountForStorage,
  normalizeDurationForStorage,
} from '@/utils/workLogNumeric';
import { qaCategoriesToTree } from '@/data/qaCategories';
import { DEFAULT_TEAMS_SEED, TEAM_QG2_ID } from '@/data/teams';
import { GLOBAL_TEAM_ADMIN_SCOPE_ID } from '@/constants/globalTeamAdmin';
import { GLOBAL_WORK_RECORD_START_DATE_KEY } from '@/constants/workRecordPolicy';
import type { GlobalTeamAdminSavePayload } from '@/constants/globalTeamAdmin';
import type { ChangeAdminPasswordSelfParams } from '@/constants/adminPasswordChange';
import {
  mergeAdminExtrasOnSave,
  parseStoredAdminExtras,
  serializeAdminExtras,
  toPreviewExtras,
} from '@/utils/adminExtraAccounts';
import { sha256Hex } from '@/utils/passwordHash';
import { shouldPreserveImportedTeamAdmin } from '@/utils/preserveTeamAdminOnImport';

async function hashPw(pw: string): Promise<string> {
  return sha256Hex(pw + 'teamlog');
}

export class InMemoryAdapter implements IDatabaseAdapter {
  private teams: WorkTeam[] = [];
  /** 팀별 비밀번호 해시 (메모리 전용) */
  private teamPasswordHashes = new Map<string, string>();
  /** 팀별 추가 관리자 JSON (loginId + hash) */
  private teamAdminExtrasJson = new Map<string, string>();
  private members: TeamMember[] = [];
  private logs: WorkLog[] = [];
  private categoriesTree: Category[] = qaCategoriesToTree();
  private settings: Map<string, string> = new Map();
  private connected = false;

  async initialize(): Promise<void> {
    this.connected = true;
    if (!this.settings.has('master_login_id')) {
      this.settings.set('master_login_id', '201521570');
      this.settings.set('master_password_hash', await hashPw('1111'));
    }
    console.log('[InMemoryAdapter] 초기화 완료 (메모리 기반 - 새로고침 시 초기화됨)');
  }

  getConfig(): DatabaseConfig {
    return {
      isConnected: this.connected,
      adapterType: 'indexeddb',
    };
  }

  async setDbPath(_path: string): Promise<void> {
    console.log('[InMemoryAdapter] setDbPath 호출됨 - 메모리 어댑터에서는 무시됨');
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getTeams(): Promise<WorkTeam[]> {
    return [...this.teams]
      .map((t) => ({
        ...t,
        hasAdminPassword: this.teamPasswordHashes.has(t.id),
        extraAdminAccounts: toPreviewExtras(parseStoredAdminExtras(this.teamAdminExtrasJson.get(t.id) ?? null)),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async insertTeam(name: string): Promise<WorkTeam> {
    const id = crypto.randomUUID();
    const sortOrder = this.teams.length === 0 ? 1 : Math.max(...this.teams.map(t => t.sortOrder)) + 1;
    const t: WorkTeam = { id, name, sortOrder, adminLoginId: null, hasAdminPassword: false };
    this.teams.push(t);
    return t;
  }

  async verifyMasterLogin(loginId: string, password: string): Promise<boolean> {
    const id = await this.getSetting('master_login_id');
    if (!id || id !== loginId) return false;
    const pw = (password ?? '').trim();
    if (pw === '') return true;
    const h = await this.getSetting('master_password_hash');
    if (!h) return false;
    return h === (await hashPw(password));
  }

  async verifyTeamAdmin(teamId: string, loginId: string, password: string): Promise<boolean> {
    const hp = await hashPw(password);
    if (teamId === GLOBAL_TEAM_ADMIN_SCOPE_ID) {
      const id = await this.getSetting('global_team_admin_login_id');
      const h = await this.getSetting('global_team_admin_password_hash');
      if (id?.trim() && h && id === loginId && h === hp) return true;
      const extraJson = await this.getSetting('global_team_admin_extra_json');
      for (const e of parseStoredAdminExtras(extraJson)) {
        if (e.loginId === loginId && e.passwordHash === hp) return true;
      }
      return false;
    }
    const team = this.teams.find((x) => x.id === teamId);
    const storedHash = this.teamPasswordHashes.get(teamId);
    if (team?.adminLoginId && storedHash && team.adminLoginId === loginId && storedHash === hp) return true;
    const extraJson = this.teamAdminExtrasJson.get(teamId);
    for (const e of parseStoredAdminExtras(extraJson ?? null)) {
      if (e.loginId === loginId && e.passwordHash === hp) return true;
    }
    return false;
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
    for (const tid of payload.deletedTeamIds) {
      const mids = this.members.filter((m) => m.teamId === tid).map((m) => m.id);
      for (const mid of mids) {
        this.logs = this.logs.filter((l) => l.memberId !== mid);
      }
      this.members = this.members.filter((m) => m.teamId !== tid);
      this.teams = this.teams.filter((t) => t.id !== tid);
      this.teamPasswordHashes.delete(tid);
      this.teamAdminExtrasJson.delete(tid);
    }
    if (payload.globalTeamAdmin !== undefined) {
      await this.applyGlobalTeamAdminSave(payload.globalTeamAdmin);
    }
    if (payload.workRecordStartDate !== undefined) {
      const raw = (payload.workRecordStartDate ?? '').trim();
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(raw);
      await this.setSetting(GLOBAL_WORK_RECORD_START_DATE_KEY, ok ? raw : '');
    }
    for (const row of payload.teams) {
      const hasNewPw =
        row.passwordPlain !== undefined && row.passwordPlain !== null && String(row.passwordPlain).length > 0;
      const idx = this.teams.findIndex((t) => t.id === row.id);
      if (idx >= 0) {
        this.teams[idx] = {
          ...this.teams[idx],
          name: row.name,
          sortOrder: row.sortOrder,
          adminLoginId: row.adminLoginId || null,
          hasAdminPassword: hasNewPw ? true : this.teamPasswordHashes.has(row.id),
        };
        if (hasNewPw) {
          this.teamPasswordHashes.set(row.id, await hashPw(String(row.passwordPlain)));
        }
      } else {
        this.teams.push({
          id: row.id,
          name: row.name,
          sortOrder: row.sortOrder,
          adminLoginId: row.adminLoginId || null,
          hasAdminPassword: !!hasNewPw,
        });
        if (hasNewPw) {
          this.teamPasswordHashes.set(row.id, await hashPw(String(row.passwordPlain)));
        }
      }
      if (row.extraAdmins !== undefined) {
        const merged = await mergeAdminExtrasOnSave(
          this.teamAdminExtrasJson.get(row.id) ?? null,
          row.extraAdmins,
          hashPw
        );
        this.teamAdminExtrasJson.set(row.id, serializeAdminExtras(merged));
      }
    }
  }

  async changeAdminPasswordSelf(params: ChangeAdminPasswordSelfParams): Promise<void> {
    const cur = params.currentPassword;
    const neu = params.newPassword;
    if (!neu?.length) {
      throw new Error('새 비밀번호를 입력해 주세요.');
    }
    if (params.scope === 'master') {
      const id = await this.getSetting('master_login_id');
      const h = await this.getSetting('master_password_hash');
      if (!id?.trim() || !h) {
        throw new Error('마스터 계정이 설정되지 않았습니다.');
      }
      if (h !== (await hashPw(cur))) {
        throw new Error('현재 비밀번호가 올바르지 않습니다.');
      }
      await this.setSetting('master_password_hash', await hashPw(neu));
      return;
    }
    if (params.scope === 'global') {
      const target = (params.adminLoginId ?? '').trim();
      const primaryId = (await this.getSetting('global_team_admin_login_id')) ?? '';
      const primaryH = await this.getSetting('global_team_admin_password_hash');
      const extraJson = await this.getSetting('global_team_admin_extra_json');
      const extras = parseStoredAdminExtras(extraJson);
      const curH = await hashPw(cur);
      const neuH = await hashPw(neu);

      if (!target || target === primaryId) {
        if (!primaryId?.trim() || !primaryH) {
          throw new Error('전체팀 관리자가 설정되지 않았습니다.');
        }
        if (primaryH !== curH) {
          throw new Error('현재 비밀번호가 올바르지 않습니다.');
        }
        await this.setSetting('global_team_admin_password_hash', neuH);
        return;
      }
      const idx = extras.findIndex((e) => e.loginId === target);
      if (idx < 0) {
        throw new Error('관리자 계정을 찾을 수 없습니다.');
      }
      if (extras[idx].passwordHash !== curH) {
        throw new Error('현재 비밀번호가 올바르지 않습니다.');
      }
      extras[idx] = { loginId: target, passwordHash: neuH };
      await this.setSetting('global_team_admin_extra_json', serializeAdminExtras(extras));
      return;
    }
    const teamId = params.teamId;
    const team = this.teams.find((x) => x.id === teamId);
    const storedHash = this.teamPasswordHashes.get(teamId);
    const target = (params.adminLoginId ?? '').trim();
    const primaryId = (team?.adminLoginId ?? '').trim();
    const curH = await hashPw(cur);
    const neuH = await hashPw(neu);

    if (!target || target === primaryId) {
      if (!primaryId || !storedHash) {
        throw new Error('팀 관리자가 설정되지 않았습니다. 마스터 관리자에게 사번 등록을 요청하세요.');
      }
      if (storedHash !== curH) {
        throw new Error('현재 비밀번호가 올바르지 않습니다.');
      }
      this.teamPasswordHashes.set(teamId, neuH);
      return;
    }
    const extraJson = this.teamAdminExtrasJson.get(teamId);
    const extras = parseStoredAdminExtras(extraJson ?? null);
    const idx = extras.findIndex((e) => e.loginId === target);
    if (idx < 0) {
      throw new Error('관리자 계정을 찾을 수 없습니다.');
    }
    if (extras[idx].passwordHash !== curH) {
      throw new Error('현재 비밀번호가 올바르지 않습니다.');
    }
    extras[idx] = { loginId: target, passwordHash: neuH };
    this.teamAdminExtrasJson.set(teamId, serializeAdminExtras(extras));
  }

  private async applyGlobalTeamAdminSave(g: GlobalTeamAdminSavePayload): Promise<void> {
    if (g === null) {
      this.settings.delete('global_team_admin_login_id');
      this.settings.delete('global_team_admin_password_hash');
      this.settings.delete('global_team_admin_extra_json');
      return;
    }
    const login = (g.adminLoginId ?? '').trim();
    if (!login) {
      this.settings.delete('global_team_admin_login_id');
      this.settings.delete('global_team_admin_password_hash');
      this.settings.delete('global_team_admin_extra_json');
      return;
    }
    this.settings.set('global_team_admin_login_id', login);
    const pw = g.passwordPlain;
    const hasNewPw = pw !== undefined && pw !== null && String(pw).length > 0;
    if (hasNewPw) {
      this.settings.set('global_team_admin_password_hash', await hashPw(String(pw)));
    }
    if (g.extraAdmins !== undefined) {
      const oldExtra = this.settings.get('global_team_admin_extra_json') ?? null;
      const merged = await mergeAdminExtrasOnSave(oldExtra, g.extraAdmins, hashPw);
      this.settings.set('global_team_admin_extra_json', serializeAdminExtras(merged));
    }
  }

  async getAllMembers(): Promise<TeamMember[]> {
    return [...this.members];
  }

  async getMembersByTeam(teamId: string): Promise<TeamMember[]> {
    return this.members.filter(m => m.teamId === teamId);
  }

  async getMemberById(id: string): Promise<TeamMember | null> {
    return this.members.find(m => m.id === id) || null;
  }

  async insertMember(member: Omit<TeamMember, 'id'>): Promise<TeamMember> {
    const newMember: TeamMember = {
      ...member,
      id: crypto.randomUUID(),
    };
    this.members.push(newMember);
    return newMember;
  }

  async updateMember(id: string, updates: Partial<TeamMember>): Promise<void> {
    const index = this.members.findIndex(m => m.id === id);
    if (index !== -1) {
      this.members[index] = { ...this.members[index], ...updates };
    }
  }

  async deleteMember(id: string): Promise<void> {
    this.members = this.members.filter(m => m.id !== id);
    this.logs = this.logs.filter(l => l.memberId !== id);
  }

  async getAllLogs(): Promise<WorkLog[]> {
    return [...this.logs];
  }

  async getLogsByTeam(teamId: string): Promise<WorkLog[]> {
    const ids = new Set(this.members.filter(m => m.teamId === teamId).map(m => m.id));
    return this.logs.filter(l => ids.has(l.memberId));
  }

  async getLogsByMemberId(memberId: string): Promise<WorkLog[]> {
    return this.logs.filter(l => l.memberId === memberId);
  }

  async getLogsByDateRange(startDate: string, endDate: string): Promise<WorkLog[]> {
    return this.logs.filter(l => l.date >= startDate && l.date <= endDate);
  }

  async insertLog(
    log: Omit<WorkLog, 'id' | 'createdAt' | 'updatedAt'>,
    requesterMemberId?: string | null
  ): Promise<WorkLog> {
    if (requesterMemberId != null && requesterMemberId !== '' && log.memberId !== requesterMemberId) {
      throw new Error('다른 멤버 명의로 업무를 저장할 수 없습니다.');
    }
    const now = new Date().toISOString();
    const dur = normalizeDurationForStorage(log.duration);
    const cnt = normalizeCountForStorage(log.count);
    const newLog: WorkLog = {
      ...log,
      duration: dur,
      count: cnt,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.logs.push(newLog);
    return newLog;
  }

  async updateLog(id: string, updates: Partial<WorkLog>, requesterMemberId?: string | null): Promise<void> {
    const index = this.logs.findIndex((l) => l.id === id);
    if (index === -1) {
      throw new Error(`업무 기록을 찾을 수 없습니다. (id=${id})`);
    }
    const cur = this.logs[index]!;
    if (requesterMemberId != null && requesterMemberId !== '' && cur.memberId !== requesterMemberId) {
      throw new Error('수정: 본인 소유 업무가 아닙니다.');
    }
    if (updates.memberId !== undefined && updates.memberId !== cur.memberId) {
      throw new Error('담당자 변경은 허용되지 않습니다.');
    }
    const merged: WorkLog = { ...cur, ...updates };
    merged.duration =
      updates.duration !== undefined ? normalizeDurationForStorage(updates.duration) : normalizeDurationForStorage(cur.duration);
    merged.count =
      updates.count !== undefined ? normalizeCountForStorage(updates.count) : normalizeCountForStorage(cur.count);
    merged.updatedAt = new Date().toISOString();
    this.logs[index] = merged;
  }

  async deleteLog(id: string, requesterMemberId?: string | null): Promise<void> {
    const idx = this.logs.findIndex((l) => l.id === id);
    if (idx === -1) {
      throw new Error(`삭제할 업무를 찾을 수 없습니다. (id=${id})`);
    }
    if (requesterMemberId != null && requesterMemberId !== '' && this.logs[idx]!.memberId !== requesterMemberId) {
      throw new Error('삭제: 본인 소유 업무가 아닙니다.');
    }
    this.logs = this.logs.filter((l) => l.id !== id);
  }

  async saveLogsBatch(payload: SaveLogsBatchPayload): Promise<void> {
    const { requesterMemberId, deletedLogIds, updatedLogs, newLogs } = payload;
    if (!requesterMemberId) throw new Error('일괄 저장에는 작성자(member) id가 필요합니다.');
    const snapshot = this.logs.map((l) => ({ ...l }));
    try {
      let next = [...this.logs];
      for (const delId of deletedLogIds) {
        const row = next.find((l) => l.id === delId);
        if (!row) throw new Error(`삭제할 업무를 찾을 수 없습니다. (id=${delId})`);
        if (row.memberId !== requesterMemberId) throw new Error('삭제: 본인 소유 업무가 아닙니다.');
        next = next.filter((l) => l.id !== delId);
      }
      for (const { id: uid, updates } of updatedLogs) {
        if (!updates || Object.keys(updates).length === 0) continue;
        const idx = next.findIndex((l) => l.id === uid);
        if (idx === -1) throw new Error(`업무 기록을 찾을 수 없습니다. (id=${uid})`);
        const cur = next[idx]!;
        if (cur.memberId !== requesterMemberId) throw new Error('수정: 본인 소유 업무가 아닙니다.');
        if (updates.memberId !== undefined && updates.memberId !== cur.memberId) {
          throw new Error('담당자 변경은 허용되지 않습니다.');
        }
        const merged: WorkLog = { ...cur, ...updates };
        merged.duration =
          updates.duration !== undefined ? normalizeDurationForStorage(updates.duration) : normalizeDurationForStorage(cur.duration);
        merged.count =
          updates.count !== undefined ? normalizeCountForStorage(updates.count) : normalizeCountForStorage(cur.count);
        merged.updatedAt = new Date().toISOString();
        next[idx] = merged;
      }
      for (const log of newLogs) {
        if (log.memberId !== requesterMemberId) throw new Error('추가: 다른 멤버 명의의 업무는 저장할 수 없습니다.');
        const now = new Date().toISOString();
        next.push({
          ...log,
          id: crypto.randomUUID(),
          duration: normalizeDurationForStorage(log.duration),
          count: normalizeCountForStorage(log.count),
          createdAt: now,
          updatedAt: now,
        });
      }
      this.logs = next;
    } catch (e) {
      this.logs = snapshot.map((l) => ({ ...l }));
      throw e;
    }
  }

  async deleteLogsByMemberId(memberId: string): Promise<void> {
    this.logs = this.logs.filter(l => l.memberId !== memberId);
  }

  private flattenCategories(tree: Category[]): string[] {
    const byId = new Map<number, Category>();
    tree.forEach(c => byId.set(c.id, c));
    return tree
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map(c => c.parentId == null ? c.name : `${byId.get(c.parentId)?.name ?? ''} > ${c.name}`);
  }

  async getAllCategories(): Promise<string[]> {
    return this.flattenCategories(this.categoriesTree);
  }

  async getCategoriesTree(): Promise<Category[]> {
    return [...this.categoriesTree];
  }

  async saveCategories(categories: string[]): Promise<void> {
    const tree: Category[] = [];
    const parentNames = new Map<string, number>();
    let nextId = 1;
    categories.forEach((displayName, idx) => {
      if (displayName.includes(' > ')) {
        const [parentName, childName] = displayName.split(' > ');
        let parentId = parentNames.get(parentName!);
        if (parentId == null) {
          parentId = nextId++;
          tree.push({ id: parentId, name: parentName!, parentId: null, sortOrder: tree.length + 1 });
          parentNames.set(parentName!, parentId);
        }
        tree.push({ id: nextId++, name: childName!.trim(), parentId, sortOrder: tree.length + 1 });
      } else {
        tree.push({ id: nextId++, name: displayName, parentId: null, sortOrder: idx + 1 });
      }
    });
    this.categoriesTree = tree;
  }

  async saveCategoriesTree(categories: Category[]): Promise<void> {
    this.categoriesTree = [...categories];
  }

  async getSetting(key: string): Promise<string | null> {
    return this.settings.get(key) || null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.settings.set(key, value);
  }

  async clearAllData(): Promise<void> {
    this.members = [];
    this.logs = [];
    this.teams = DEFAULT_TEAMS_SEED.map((t) => ({
      id: t.id,
      name: t.name,
      sortOrder: t.sortOrder,
      adminLoginId: null,
      hasAdminPassword: false,
    }));
    this.teamPasswordHashes.clear();
    this.categoriesTree = qaCategoriesToTree();
    this.settings.clear();
    await this.initialize();
  }

  async exportData(): Promise<{
    teams: WorkTeam[];
    members: TeamMember[];
    logs: WorkLog[];
    categories: string[];
  }> {
    return {
      teams: await this.getTeams(),
      members: [...this.members],
      logs: [...this.logs],
      categories: this.flattenCategories(this.categoriesTree),
    };
  }

  async importData(data: {
    teams?: WorkTeam[];
    members: TeamMember[];
    logs: WorkLog[];
    categories: string[];
  }): Promise<void> {
    const prevById = new Map(this.teams.map((t) => [t.id, t] as const));
    const prevHashes = new Map(this.teamPasswordHashes);
    const prevExtras = new Map(this.teamAdminExtrasJson);
    this.teamPasswordHashes.clear();
    this.teamAdminExtrasJson.clear();
    if (data.teams && data.teams.length > 0) {
      this.teams = data.teams.map((t) => {
        if (shouldPreserveImportedTeamAdmin(t)) {
          const prev = prevById.get(t.id);
          const h = prevHashes.get(t.id);
          const ex = prevExtras.get(t.id);
          if (h) this.teamPasswordHashes.set(t.id, h);
          if (ex) this.teamAdminExtrasJson.set(t.id, ex);
          return {
            id: t.id,
            name: t.name,
            sortOrder: t.sortOrder,
            adminLoginId: prev?.adminLoginId ?? null,
            hasAdminPassword: !!h,
          };
        }
        return {
          id: t.id,
          name: t.name,
          sortOrder: t.sortOrder,
          adminLoginId: t.adminLoginId ?? null,
          hasAdminPassword: t.hasAdminPassword ?? false,
        };
      });
    } else {
      this.teams = DEFAULT_TEAMS_SEED.map((t) => ({
        id: t.id,
        name: t.name,
        sortOrder: t.sortOrder,
        adminLoginId: null,
        hasAdminPassword: false,
      }));
    }
    this.members = data.members.map(m => ({
      ...m,
      teamId: m.teamId || TEAM_QG2_ID,
    }));
    this.logs = data.logs.map((l) => ({
      ...l,
      duration: clampDurationForImport(l.duration),
      count: clampCountForImport(l.count),
    }));
    await this.saveCategories(data.categories);
  }
}

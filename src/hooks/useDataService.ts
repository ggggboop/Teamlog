import { useState, useEffect, useCallback } from 'react';
import { TeamMember, WorkLog, Category, WorkTeam } from '@/types/workLog';
import type { GlobalTeamAdminPreview, GlobalTeamAdminSavePayload } from '@/constants/globalTeamAdmin';
import type { ChangeAdminPasswordSelfParams } from '@/constants/adminPasswordChange';
import { dataService, initializeDataService } from '@/services/DataService';
import { toast } from '@/hooks/use-toast';
import {
  computeDailyWorkHoursLimit,
  leaveTypeToDeductionHours,
  STANDARD_DAY_HOURS,
} from '@/utils/dailyWorkHours';
import {
  GLOBAL_WORK_RECORD_START_DATE_KEY,
  parseWorkRecordStartDate,
  isDateBeforeWorkRecordStart,
} from '@/constants/workRecordPolicy';

function dailyExtendKey(memberId: string, date: string) {
  return `daily_extend_${memberId}_${date}`;
}
function dailyLegacyTotalKey(memberId: string, date: string) {
  return `daily_total_${memberId}_${date}`;
}
function dailyLeaveKey(memberId: string, date: string) {
  return `daily_leave_${memberId}_${date}`;
}

/** 저장된 연장(h). 없으면 예전 daily_total 값에서 기본(8−휴가)을 뺀 값으로 이관 */
async function readStoredExtensionHours(
  memberId: string,
  date: string,
  leaveType: string | null
): Promise<number> {
  const ek = dailyExtendKey(memberId, date);
  const rawExt = await dataService.getSetting(ek);
  if (rawExt != null && String(rawExt).trim() !== '') {
    return Math.max(0, parseFloat(String(rawExt)) || 0);
  }
  const legacy = await dataService.getSetting(dailyLegacyTotalKey(memberId, date));
  if (legacy != null && String(legacy).trim() !== '') {
    const leg = parseFloat(String(legacy));
    if (!Number.isFinite(leg)) return 0;
    const base = Math.max(0, STANDARD_DAY_HOURS - leaveTypeToDeductionHours(leaveType));
    return Math.max(0, leg - base);
  }
  return 0;
}

/** selectedTeamId: null이면 팀 미선택(팀 선택 화면). 선택 시 해당 팀 멤버·로그만 로드 */
export function useDataService(selectedTeamId: string | null) {
  const [teams, setTeams] = useState<WorkTeam[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [logs, setLogs] = useState<WorkLog[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [categoriesTree, setCategoriesTree] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [globalTeamAdminPreview, setGlobalTeamAdminPreview] = useState<GlobalTeamAdminPreview>({
    adminLoginId: null,
    hasPassword: false,
    extraAccounts: [],
  });
  const [masterLoginPreview, setMasterLoginPreview] = useState<{ loginId: string | null }>({ loginId: null });
  const [workRecordStartDate, setWorkRecordStartDate] = useState<string | null>(null);

  const refreshData = useCallback(async () => {
    try {
      const [loadedTeams, loadedCategories, loadedTree, globalPreview, masterPrev] = await Promise.all([
        dataService.getTeams(),
        dataService.getCategories(),
        dataService.getCategoriesTree(),
        dataService.getGlobalTeamAdminPreview(),
        dataService.getMasterLoginPreview(),
      ]);
      setTeams(loadedTeams);
      setGlobalTeamAdminPreview(globalPreview);
      setMasterLoginPreview(masterPrev);
      const wrRaw = await dataService.getSetting(GLOBAL_WORK_RECORD_START_DATE_KEY);
      setWorkRecordStartDate(parseWorkRecordStartDate(wrRaw));
      setCategories(loadedCategories);
      setCategoriesTree(loadedTree);

      if (selectedTeamId) {
        const [loadedMembers, loadedLogs] = await Promise.all([
          dataService.getMembersByTeam(selectedTeamId),
          dataService.getLogsByTeam(selectedTeamId),
        ]);
        setMembers(loadedMembers);
        setLogs(loadedLogs);
      } else {
        setMembers([]);
        setLogs([]);
      }
    } catch (err) {
      console.error('데이터 로드 실패:', err);
      setError(err instanceof Error ? err : new Error('Unknown error'));
    }
  }, [selectedTeamId]);

  useEffect(() => {
    const loadData = async () => {
      try {
        await initializeDataService();
        await refreshData();
      } catch (err) {
        console.error('초기화 실패:', err);
        setError(err instanceof Error ? err : new Error('Initialization failed'));
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [refreshData]);

  useEffect(() => {
    let timeout: NodeJS.Timeout | null = null;
    const handleDbChange = (payload: string) => {
      console.log('[DB Sync] 테이블 변경 감지:', payload);
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        refreshData();
      }, 500); // 500ms 디바운스
    };

    let unsub: (() => void) | void = undefined;
    if (dataService.onDbChange) {
      unsub = dataService.onDbChange(handleDbChange);
    }
    return () => {
      if (timeout) clearTimeout(timeout);
      if (unsub) unsub();
    };
  }, [refreshData]);

  const addTeam = useCallback(async (name: string) => {
    const t = await dataService.addTeam(name);
    setTeams(prev => [...prev, t].sort((a, b) => a.sortOrder - b.sortOrder));
    return t;
  }, []);

  const addMember = useCallback(async (member: Omit<TeamMember, 'id'>) => {
    const newMember = await dataService.addMember(member);
    setMembers(prev => [...prev, newMember]);
    return newMember;
  }, []);

  const updateMember = useCallback(async (id: string, updates: Partial<TeamMember>) => {
    await dataService.updateMember(id, updates);
    setMembers(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  }, []);

  const deleteMember = useCallback(async (id: string) => {
    await dataService.deleteMember(id);
    setMembers(prev => prev.filter(m => m.id !== id));
    setLogs(prev => prev.filter(l => l.memberId !== id));
  }, []);

  const addLog = useCallback(async (log: Omit<WorkLog, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newLog = await dataService.addLog(log, log.memberId);
    setLogs(prev => [...prev, newLog]);
    return newLog;
  }, []);

  const updateLog = useCallback(async (id: string, updates: Partial<WorkLog>) => {
    const owner = logs.find((l) => l.id === id)?.memberId;
    await dataService.updateLog(id, updates, owner);
    setLogs(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  }, [logs]);

  const deleteLog = useCallback(async (id: string) => {
    const owner = logs.find((l) => l.id === id)?.memberId;
    await dataService.deleteLog(id, owner);
    setLogs(prev => prev.filter(l => l.id !== id));
  }, [logs]);

  const saveAllLogs = useCallback(async (
    newLogs: Omit<WorkLog, 'id' | 'createdAt' | 'updatedAt'>[],
    updatedLogs: { id: string; updates: Partial<WorkLog> }[],
    deletedLogIds: string[],
    requesterMemberId: string
  ) => {
    for (const log of newLogs) {
      if (log.memberId !== requesterMemberId) {
        throw new Error('본인 명의의 업무만 저장할 수 있습니다.');
      }
    }
    for (const id of deletedLogIds) {
      const lg = logs.find((l) => l.id === id);
      if (lg && lg.memberId !== requesterMemberId) {
        throw new Error('본인 소유 업무만 삭제할 수 있습니다.');
      }
    }
    for (const { id } of updatedLogs) {
      const lg = logs.find((l) => l.id === id);
      if (lg && lg.memberId !== requesterMemberId) {
        throw new Error('본인 소유 업무만 수정할 수 있습니다.');
      }
    }

    const startRaw = await dataService.getSetting(GLOBAL_WORK_RECORD_START_DATE_KEY);
    const start = parseWorkRecordStartDate(startRaw);
    if (start) {
      for (const id of deletedLogIds) {
        const lg = logs.find((l) => l.id === id);
        if (lg && isDateBeforeWorkRecordStart(lg.date, start)) {
          throw new Error('기록 시작일 이전 업무는 삭제할 수 없습니다. (연차·반차는 해당 날짜 칸에서 별도 저장)');
        }
      }
      for (const log of newLogs) {
        if (isDateBeforeWorkRecordStart(log.date, start)) {
          throw new Error(`업무 기록은 ${start}부터 저장할 수 있습니다.`);
        }
      }
      for (const { id, updates } of updatedLogs) {
        const orig = logs.find((l) => l.id === id);
        if (!orig) continue;
        if (isDateBeforeWorkRecordStart(orig.date, start)) {
          throw new Error('기록 시작일 이전에 저장된 업무는 수정할 수 없습니다.');
        }
        const targetDate = updates.date ?? orig.date;
        if (isDateBeforeWorkRecordStart(targetDate, start)) {
          throw new Error(`업무 일자는 ${start} 이전으로 옮길 수 없습니다.`);
        }
      }
    }

    /** 동일 taskCode로 이어 쓴 뒤 새 행만 완료 처리하면, 예전 날짜의 진행중 원본이 남아 목록에 진행중으로 남는 문제 보정 */
    const deletedSet = new Set(deletedLogIds);
    const mergedById = new Map<string, Partial<WorkLog>>();
    for (const { id, updates } of updatedLogs) {
      if (deletedSet.has(id)) continue;
      mergedById.set(id, { ...(mergedById.get(id) ?? {}), ...updates });
    }

    const taskCompletedKeys = new Set<string>();
    for (const nl of newLogs) {
      if (nl.status === '완료' && nl.taskCode) {
        taskCompletedKeys.add(`${nl.memberId}\t${nl.taskCode}`);
      }
    }
    for (const orig of logs) {
      if (deletedSet.has(orig.id)) continue;
      const pend = mergedById.get(orig.id);
      const status = pend?.status ?? orig.status;
      const mergedTc = pend?.taskCode !== undefined ? pend.taskCode : orig.taskCode;
      if (status === '완료' && mergedTc) {
        taskCompletedKeys.add(`${orig.memberId}\t${mergedTc}`);
      }
    }

    const autoCompletedLinked: { id: string; date: string; taskCode: string }[] = [];
    for (const orig of logs) {
      if (deletedSet.has(orig.id)) continue;
      if (orig.memberId !== requesterMemberId) continue;
      if (orig.status !== '진행중' || !orig.taskCode) continue;
      const key = `${orig.memberId}\t${orig.taskCode}`;
      if (!taskCompletedKeys.has(key)) continue;
      const pending = mergedById.get(orig.id) ?? {};
      const mergedStatus = pending.status ?? orig.status;
      if (mergedStatus !== '진행중') continue;
      mergedById.set(orig.id, { ...pending, status: '완료' });
      autoCompletedLinked.push({ id: orig.id, date: orig.date, taskCode: orig.taskCode });
    }

    const mergedUpdatedLogs = [...mergedById.entries()]
      .map(([id, updates]) => ({ id, updates }))
      .filter(({ updates }) => updates && Object.keys(updates).length > 0);

    for (const { id } of mergedUpdatedLogs) {
      const lg = logs.find((l) => l.id === id);
      if (lg && lg.memberId !== requesterMemberId) {
        throw new Error('본인 소유 업무만 수정할 수 있습니다.');
      }
    }

    await dataService.saveLogsBatch({
      requesterMemberId,
      deletedLogIds,
      updatedLogs: mergedUpdatedLogs,
      newLogs,
    });

    if (autoCompletedLinked.length > 0) {
      toast({
        title: '연관 진행중 업무 정리',
        description: `같은 과제코드로 완료 처리하면서 다른 날짜의 진행중 ${autoCompletedLinked.length}건을 자동으로 완료했습니다.`,
      });
      console.info('[Teamlog] auto-complete linked in-progress logs', { items: autoCompletedLinked });
    }

    await refreshData();
  }, [refreshData, logs]);

  const getLogsByMember = useCallback((memberId: string) => {
    return logs.filter(l => l.memberId === memberId);
  }, [logs]);

  const updateCategories = useCallback(async (newCategories: string[]) => {
    await dataService.saveCategories(newCategories);
    const tree = await dataService.getCategoriesTree();
    setCategories(newCategories);
    setCategoriesTree(tree);
  }, []);

  const updateCategoriesTree = useCallback(async (newTree: Category[]) => {
    await dataService.saveCategoriesTree(newTree);
    const flat = await dataService.getCategories();
    setCategoriesTree(newTree);
    setCategories(flat);
  }, []);

  const importData = useCallback(async (data: { teams?: WorkTeam[]; members: TeamMember[]; logs: WorkLog[]; categories: string[] }) => {
    await dataService.importData(data);
    await refreshData();
  }, [refreshData]);

  const clearAllData = useCallback(async () => {
    await dataService.clearAllData();
    setMembers([]);
    setLogs([]);
    await refreshData();
  }, [refreshData]);

  const resetData = useCallback(async (teamId?: string | null) => {
    await dataService.resetData(teamId);
    await refreshData();
  }, [refreshData]);

  const exportData = useCallback(async () => {
    return dataService.exportData();
  }, []);

  /** 일 업무시간 한도 = 8h − 휴가차감 + 연장(저장값) */
  const getDailyTotalWorkHours = useCallback(async (memberId: string, date: string): Promise<number> => {
    const leaveRaw = await dataService.getSetting(dailyLeaveKey(memberId, date));
    const leave = leaveRaw || null;
    const ext = await readStoredExtensionHours(memberId, date, leave);
    return computeDailyWorkHoursLimit(leave, ext);
  }, []);

  /** 연장 시간(h)만 저장. 일 한도는 휴가·기본 8h와 함께 계산됨 */
  const getDailyExtensionHours = useCallback(async (memberId: string, date: string): Promise<number> => {
    const leaveRaw = await dataService.getSetting(dailyLeaveKey(memberId, date));
    return readStoredExtensionHours(memberId, date, leaveRaw || null);
  }, []);

  const setDailyExtensionHours = useCallback(async (memberId: string, date: string, hours: number) => {
    const v = Math.max(0, Number(hours) || 0);
    await dataService.setSetting(dailyExtendKey(memberId, date), String(v));
  }, []);

  const getMemberMemo = useCallback(async (memberId: string): Promise<string> => {
    const val = await dataService.getSetting(`member_memo_${memberId}`);
    return val ?? '';
  }, []);

  const setMemberMemo = useCallback(async (memberId: string, content: string) => {
    await dataService.setSetting(`member_memo_${memberId}`, content);
  }, []);

  const getDailyLeaveType = useCallback(async (memberId: string, date: string): Promise<string | null> => {
    const val = await dataService.getSetting(`daily_leave_${memberId}_${date}`);
    return val || null;
  }, []);

  const setDailyLeaveType = useCallback(async (memberId: string, date: string, leaveType: string | null) => {
    if (leaveType) {
      await dataService.setSetting(`daily_leave_${memberId}_${date}`, leaveType);
    } else {
      await dataService.setSetting(`daily_leave_${memberId}_${date}`, '');
    }
  }, []);

  const verifyMasterLogin = useCallback(async (loginId: string, password: string) => {
    return dataService.verifyMasterLogin(loginId, password);
  }, []);

  const verifyTeamAdmin = useCallback(async (teamId: string, loginId: string, password: string) => {
    return dataService.verifyTeamAdmin(teamId, loginId, password);
  }, []);

  const saveAdminTeamsTransaction = useCallback(
    async (payload: {
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
    }) => {
      await dataService.saveAdminTeamsTransaction(payload);
      await refreshData();
    },
    [refreshData]
  );

  const changeAdminPasswordSelf = useCallback(async (params: ChangeAdminPasswordSelfParams) => {
    await dataService.changeAdminPasswordSelf(params);
    await refreshData();
  }, [refreshData]);

  return {
    teams,
    globalTeamAdminPreview,
    masterLoginPreview,
    workRecordStartDate,
    members,
    logs,
    categories,
    categoriesTree,
    loading,
    error,
    addTeam,
    addMember,
    updateMember,
    deleteMember,
    addLog,
    updateLog,
    deleteLog,
    saveAllLogs,
    getLogsByMember,
    updateCategories,
    updateCategoriesTree,
    importData,
    clearAllData,
    resetData,
    exportData,
    refreshData,
    getDailyTotalWorkHours,
    getDailyExtensionHours,
    setDailyExtensionHours,
    getMemberMemo,
    setMemberMemo,
    getDailyLeaveType,
    setDailyLeaveType,
    verifyMasterLogin,
    verifyTeamAdmin,
    saveAdminTeamsTransaction,
    changeAdminPasswordSelf,
  };
}

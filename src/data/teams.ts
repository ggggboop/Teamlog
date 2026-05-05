/** 기본 팀 ID (DB 시드·마이그레이션과 동일해야 함) */
export const TEAM_QG1_ID = 'team-qg-1';
export const TEAM_QG2_ID = 'team-qg-2';

export const DEFAULT_TEAMS_SEED = [
  { id: TEAM_QG1_ID, name: '품질보증1팀', sortOrder: 1 },
  { id: TEAM_QG2_ID, name: '품질보증2팀', sortOrder: 2 },
] as const;

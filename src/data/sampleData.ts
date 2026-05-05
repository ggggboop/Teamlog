/**
 * 공유 샘플 데이터 생성 (DataService, ElectronDatabaseAdapter 공통)
 * - 팀원 6명, 인원당 대분류 최대 4개만 사용(테스트 시 역할·집계 구분 용이)
 * - QA 업무분류, 2026년 2~3월 평일, 이슈 약 12% 등
 */
import type { TeamMember, WorkLog, WorkIndicatorType } from '../types/workLog';
import { GLOBAL_TEAM_ADMIN_SCOPE_ID } from '@/constants/globalTeamAdmin';
import { QA_CATEGORIES_FLAT } from './qaCategories';
import { TEAM_QG2_ID } from './teams';

/** 샘플 팀원·로그에 부여할 팀 ID (전체팀·미선택 시 품질보증2팀) */
export function sampleTeamIdForImport(selectedTeamId: string | null | undefined): string {
  if (
    selectedTeamId &&
    selectedTeamId.length > 0 &&
    selectedTeamId !== GLOBAL_TEAM_ADMIN_SCOPE_ID
  ) {
    return selectedTeamId;
  }
  return TEAM_QG2_ID;
}

/** YYYY-MM-DD 10자리 포맷 (날짜 비교/저장 표준) */
export function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface SampleDataResult {
  members: TeamMember[];
  logs: WorkLog[];
  categories: string[];
}

/** 인원별 담당 대분류(최대 4개) — QA_CATEGORIES_FLAT의 대분류명과 동일해야 함 */
const MEMBER_MAJOR_PROFILES: {
  name: string;
  role: string;
  employeeNo: string;
  majors: readonly string[];
}[] = [
  {
    name: '김민준',
    role: '팀장',
    employeeNo: '201521001',
    majors: ['허가 관리', 'GMP 문서', '변경 관리', '교육 훈련'],
  },
  {
    name: '박지훈',
    role: 'QA 담당',
    employeeNo: '201521002',
    majors: ['GMP 문서', '출하 승인', 'Audit 관리', '자율 점검'],
  },
  {
    name: '이서연',
    role: 'QC 담당',
    employeeNo: '201521003',
    majors: ['자재 관리', '제품품질평가', '일탈/OOS 관리', 'CAPA 관리'],
  },
  {
    name: '최수지',
    role: 'QA 담당',
    employeeNo: '201521004',
    majors: ['밸리데이션', '적격성 평가 (IQ,OQ,PQ)', '컴퓨터시스템 관리', '백업 및 복구 관리'],
  },
  {
    name: '오지훈',
    role: '품질검증',
    employeeNo: '201521005',
    majors: ['불만 처리', '회수', 'BOM 관리', '시계 및 시간 관리'],
  },
  {
    name: '강민서',
    role: '문서·허가',
    employeeNo: '201521006',
    majors: ['기타', '출하 승인', '교육 훈련', '허가 관리'],
  },
];

/** flat 분류 문자열 중 해당 대분류만 필터 */
function categoriesForMajors(flat: string[], majorSet: Set<string>): string[] {
  return flat.filter((c) => {
    const major = c.includes(' > ') ? c.split(' > ')[0]!.trim() : c.trim();
    return majorSet.has(major);
  });
}

/** QA 업무분류별 샘플 업무내용 (대분류 키 — 세부 문장은 테스트 다양성용) */
const QA_SAMPLE_CONTENTS: Record<string, string[]> = {
  '허가 관리': [
    'CTD 모듈3 일정 리스크 검토 및 PM 공유',
    'eCTD 제출 전 하이퍼링크·북마크 최종 점검',
    '품목갱신 대비 허가이력·변경이력 표 정리',
    '연구소 QC와 CTD 일정 합의 회의록 초안',
    '허가증 사본·번역본 대조, 변경사항 체크리스트',
  ],
  'GMP 문서': [
    '제조/포장 배치기록서 2차 리뷰·코멘트 반영',
    'SOP 개정안 교육자료용 요약본 작성',
    '제품표준서 개정 시 교차참조 표 업데이트',
    '로그북 발행번호·폐기대장 월간 대사',
    '식약처 조사지시 회신 초안·근거자료 취합',
  ],
  '출하 승인': [
    '완제품 출하 전 GMP문서·라벨 샘플 대조',
    '수탁 입고 문서 스캔본 vs 실물 수량 spot check',
    '출하 보류 건 QA·물류 공동 재검토',
    '냉장품 출하 체인 확인(온도로그 첨부)',
  ],
  'Audit 관리': [
    '수탁업체 방문평가 체크리스트 사전 점검',
    '원료업체 서면평가 응답서 검토·등급 반영',
    '식약처 수검 CAPA 진행상태 주간 점검',
    '위탁 수검 현장 동행 일정·역할 분담 확정',
  ],
  '자율 점검': [
    '자율점검 계획서 v0.9 → v1.0 반영(현장 피드백)',
    '점검 항목별 증빙사진 폴더 구조 정리',
    '미비사항 시정조치 기한·담당자 트래킹',
  ],
  '교육 훈련': [
    '연간 GMP교육 이수율·미이수자 독려 메일',
    '외부 세미나 수료 후 전달교육 자료 초안',
    '부서별 OJT 체크리스트 집계',
    '전사교육 좌석·출석 QR 테스트',
  ],
  '일탈/OOS 관리': [
    '일탈 조사 중간보고: 원인가설·추가시험 계획',
    'OOS 재시험 결과 검토·통계적 처리 여부',
    '일탈 종결 전 재발방지 조치 유효성 확인',
  ],
  '변경 관리': [
    '설비 변경 영향평가(자사) 첨부자료 목록 확정',
    '위탁 제조소 변경관리 접수·검토 의견',
    '변경 완료보고서 초안·모니터링 일정',
  ],
  '불만 처리': [
    '불만 샘플 재시험 의뢰·결과 대기',
    '고객 응대 이력 타임라인 정리',
    '회수 연계 여부 법규 검토 메모',
  ],
  'CAPA 관리': [
    'CAPA 근본원인 5Why 2차 정리',
    '모니터링 데이터 월별 추세 그래프',
    '종결 전 효과검증 샘플링 계획',
  ],
  '밸리데이션': [
    '공정 PV 3배치 데이터 취합·이상치 검토',
    '세척 밸리데이션 잔류 검증 샘플 계획',
    'CSV 리스크평가 업데이트(릴리스 노트 반영)',
    '공조/제조용수 시스템 연간 레포용 raw 데이터',
  ],
  '적격성 평가 (IQ,OQ,PQ)': [
    '신규 설비 IQ 문서 서명본 스캔',
    'OQ 프로토콜 실행 일정·인력 배치',
    '계측기 교정 불확도 반영 PQ 판정기준 검토',
    '보관소 구역 맵핑 온도맵 캡처 첨부',
  ],
  '제품품질평가': [
    '연간 PQR 초안: 트렌드·이상 트렌드 문단',
    '위탁사 품질자료 월간 수령 현황',
    '품질평가보고서 결론부 문구 조정',
  ],
  '자재 관리': [
    'LIMS 시험 대기열·SLA 초과 건 알림',
    '자재 시험 성적서 발행 전 스펙 대조',
    '불량 자재 격리구역 실물·시스템 상태 일치 확인',
    '표준자재 재시험 주기 도래 알림 처리',
  ],
  'BOM 관리': [
    '자사 품목 BOM 대 위탁 품목 BOM 차이 리포트',
    '코드 변경 시 영향받는 배치번호 목록',
  ],
  '회수': [
    '회수 계획서 약국 통지문 초안',
    '창고별 회수실적 vs 계획 수량 차이 분석',
    '폐기 증명서 템플릿 필드 검증',
  ],
  '백업 및 복구 관리': [
    '일일 증분 백업 성공 로그 아카이브',
    '분기 복구 테스트 시나리오(부분복구) 실행',
    '신규 NAS 경로 등록·권한 매트릭스',
  ],
  '시계 및 시간 관리': [
    '생산구역 시계 동기화 NTP 오프셋 기록',
    '시계 지침 오차 월간 트렌드',
  ],
  '컴퓨터시스템 관리': [
    '사용자 계정 퇴사자 일괄 잠금 처리',
    'Audit Trail 샘플링 20건 이상 쿼리 검증',
    '밸리데이션 상태 시스템 릴리스 체크리스트',
  ],
  '기타': [
    '주간 팀 운영회의 안건 정리·배포',
    '창고 방충방서 점검표 제출',
    '부서 5S 구역 사진 주간 업로드',
  ],
};

export function generateSampleData(teamId: string = TEAM_QG2_ID): SampleDataResult {
  const members: TeamMember[] = MEMBER_MAJOR_PROFILES.map((p) => ({
    id: crypto.randomUUID(),
    name: p.name,
    role: p.role,
    employeeNo: p.employeeNo,
    teamId,
  }));

  const memberMeta = MEMBER_MAJOR_PROFILES.map((p, i) => ({
    ...p,
    memberId: members[i]!.id,
    allowedCategories: categoriesForMajors(QA_CATEGORIES_FLAT, new Set(p.majors)),
  }));

  for (const m of memberMeta) {
    if (m.allowedCategories.length === 0) {
      throw new Error(`[sampleData] ${m.name} 담당 대분류에 해당하는 분류 문자열이 없습니다.`);
    }
  }

  const categories = [...QA_CATEGORIES_FLAT];
  const logs: WorkLog[] = [];
  const workIndicators: WorkIndicatorType[] = [
    'R&R/루틴업무',
    '현안대응',
    '품질고도화 과제',
    '조직운영관리',
    '기타/행정',
  ];
  const issueOptions = [
    '지연 발생',
    '리소스 부족',
    '요구사항 변경',
    '외부 의존성',
    '우선순위 조정',
    '시험기관 회신 대기',
  ];

  const getContentForCategory = (cat: string): string => {
    const major = cat.includes(' > ') ? cat.split(' > ')[0]! : cat;
    const contents = QA_SAMPLE_CONTENTS[major] ?? QA_SAMPLE_CONTENTS['기타'] ?? ['업무 수행'];
    return contents[Math.floor(Math.random() * contents.length)]!;
  };

  // 2026년 2월 1일 ~ 3월 31일 평일
  const currentDate = new Date(2026, 1, 1);
  const endDate = new Date(2026, 2, 31);

  while (currentDate.getTime() <= endDate.getTime()) {
    const dayOfWeek = currentDate.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const dateStr = toLocalDateStr(currentDate);
      memberMeta.forEach((meta) => {
        const numLogs = Math.floor(Math.random() * 4) + 2;
        for (let i = 0; i < numLogs; i++) {
          const category =
            meta.allowedCategories[Math.floor(Math.random() * meta.allowedCategories.length)]!;
          const content = getContentForCategory(category);
          const duration = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4][Math.floor(Math.random() * 8)];
          const count = Math.floor(Math.random() * 6) + 1;
          const statusRand = Math.random();
          const status: '완료' | '진행중' | '취소' =
            statusRand < 0.72 ? '완료' : statusRand < 0.9 ? '진행중' : '취소';
          const workIndicator = workIndicators[Math.floor(Math.random() * workIndicators.length)];
          const issues = Math.random() < 0.12 ? issueOptions[Math.floor(Math.random() * issueOptions.length)] : undefined;
          const now = new Date().toISOString();

          logs.push({
            id: crypto.randomUUID(),
            memberId: meta.memberId,
            date: dateStr,
            category,
            content,
            issues,
            duration,
            count,
            status,
            workIndicator,
            taskCode: crypto.randomUUID(),
            createdAt: now,
            updatedAt: now,
          });
        }
      });
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return { members, logs, categories };
}

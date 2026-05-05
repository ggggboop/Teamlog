import * as XLSX from 'xlsx';
import { TeamMember, WorkLog, normalizeWorkIndicator, type WorkStatus } from '@/types/workLog';

type ExcelRow = Record<string, unknown>;

function parseWorkStatus(raw: unknown): WorkStatus {
  const s = String(raw ?? '완료');
  if (s === '완료' || s === '진행중' || s === '취소') return s;
  return '완료';
}

interface ExportData {
  members: TeamMember[];
  logs: WorkLog[];
  categories: string[];
}

// 내보내기 함수
export function exportToExcel(data: ExportData): void {
  const workbook = XLSX.utils.book_new();

  // 1. 팀원 시트
  const membersData = data.members.map(m => ({
    'ID': m.id,
    '이름': m.name,
    '직책': m.role,
    '사번': m.employeeNo ?? '',
    '프로필이모지': m.avatar ?? '',
    '상태메시지': m.statusMessage ?? '',
  }));
  const membersSheet = XLSX.utils.json_to_sheet(membersData);
  XLSX.utils.book_append_sheet(workbook, membersSheet, '팀원목록');

  // 2. 업무기록 시트
  const logsData = data.logs.map(l => {
    const member = data.members.find(m => m.id === l.memberId);
    return {
      'ID': l.id,
      '팀원ID': l.memberId,
      '팀원명': member?.name || '',
      '날짜': l.date,
      '업무분류': l.category,
      '업무내용': l.content,
      '특이사항': l.issues || '',
      '총 소요시간(h)': l.duration,
      '건수': l.count,
      '현황': l.status || '완료',
      '업무지표': l.workIndicator || '기타/행정',
      '생성일시': l.createdAt,
      '수정일시': l.updatedAt,
    };
  });
  const logsSheet = XLSX.utils.json_to_sheet(logsData);
  XLSX.utils.book_append_sheet(workbook, logsSheet, '업무기록');

  // 3. 업무분류 시트
  const categoriesData = data.categories.map((c, idx) => ({
    '순번': idx + 1,
    '업무분류': c,
  }));
  const categoriesSheet = XLSX.utils.json_to_sheet(categoriesData);
  XLSX.utils.book_append_sheet(workbook, categoriesSheet, '업무분류');

  // 파일 다운로드
  const fileName = `업무기록_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}

export interface ExportRecordsTableOptions {
  /** 화면에서 taskCode 열을 숨긴 경우 엑셀에서도 제외 */
  omitTaskCode?: boolean;
}

/** 기록탭 테이블과 동일한 형식으로 엑셀 추출 */
export function exportRecordsTableToExcel(
  logs: WorkLog[],
  members: TeamMember[],
  fileName?: string,
  options?: ExportRecordsTableOptions
): void {
  const memberById = new Map(members.map(m => [m.id, m]));
  const rows = logs.map(log => {
    const [major, sub] = log.category.includes(' > ') ? log.category.split(' > ') : [log.category, ''];
    const member = memberById.get(log.memberId);
    const rest = {
      '팀원': member?.name ?? '-',
      '날짜': log.date,
      '대분류': major,
      '소분류': sub || '-',
      '업무내용': log.content,
      '특이사항': log.issues || '-',
      '건수': log.count,
      '소요시간': log.duration,
      '업무지표': log.workIndicator || '기타/행정',
      '현황': log.status,
    };
    if (options?.omitTaskCode) return rest;
    return { taskCode: log.taskCode || '-', ...rest };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '기록');
  const name = fileName || `업무기록_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, name);
}

// 불러오기 함수
export async function importFromExcel(file: File): Promise<ExportData | null> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });

        // 팀원 시트 파싱
        const membersSheet = workbook.Sheets['팀원목록'];
        if (!membersSheet) {
          throw new Error('팀원목록 시트를 찾을 수 없습니다.');
        }
        const membersRaw = XLSX.utils.sheet_to_json<ExcelRow>(membersSheet);
        const members: TeamMember[] = membersRaw
          .map((row) => ({
            id: String(row['ID'] || crypto.randomUUID()),
            name: String(row['이름'] || ''),
            role: String(row['직책'] || ''),
            employeeNo: row['사번'] != null && String(row['사번']).trim() !== '' ? String(row['사번']).trim() : undefined,
            avatar:
              row['프로필이모지'] != null && String(row['프로필이모지']).trim() !== ''
                ? String(row['프로필이모지']).trim()
                : undefined,
            statusMessage:
              row['상태메시지'] != null && String(row['상태메시지']).trim() !== ''
                ? String(row['상태메시지']).trim()
                : undefined,
          }))
          .filter((m) => m.name);

        // 업무기록 시트 파싱
        const logsSheet = workbook.Sheets['업무기록'];
        if (!logsSheet) {
          throw new Error('업무기록 시트를 찾을 수 없습니다.');
        }
        const logsRaw = XLSX.utils.sheet_to_json<ExcelRow>(logsSheet);
        const logs: WorkLog[] = logsRaw.map(row => ({
          id: String(row['ID'] || crypto.randomUUID()),
          memberId: String(row['팀원ID'] || ''),
          date: String(row['날짜'] || ''),
          category: String(row['업무분류'] || '기타'),
          content: String(row['업무내용'] || ''),
          issues: String(row['특이사항'] || row['이슈사항'] || '') || undefined,
          duration: Number(row['총 소요시간(h)'] ?? row['소요시간(분)']) || 0,
          count: Number(row['건수']) || 1,
          status: parseWorkStatus(row['현황']),
          workIndicator: normalizeWorkIndicator(String(row['업무지표'] || row['긴급도'] || '기타/행정')),
          createdAt: String(row['생성일시'] || new Date().toISOString()),
          updatedAt: String(row['수정일시'] || new Date().toISOString()),
        })).filter(l => l.memberId && l.date);

        // 업무분류 시트 파싱
        const categoriesSheet = workbook.Sheets['업무분류'];
        let categories: string[] = [];
        if (categoriesSheet) {
          const categoriesRaw = XLSX.utils.sheet_to_json<ExcelRow>(categoriesSheet);
          categories = categoriesRaw
            .map(row => String(row['업무분류'] || ''))
            .filter(c => c);
        }

        resolve({ members, logs, categories });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
    reader.readAsBinaryString(file);
  });
}

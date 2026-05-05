/**
 * QA 업무분류 - 업무 분류 최종(QA) 2026.02.19.xlsx 기반
 * D열: 대분류, E열: 소분류
 * 대·소분류 각 이름은 표시 너비 상한(`categoryNameLimit`)을 넘지 않게 유지함.
 */
export const QA_CATEGORIES_FLAT: string[] = [
  '허가 관리 > CTD 일정 관리(부서협업)',
  '허가 관리 > CTD 허가자료 준비, 작성 및 검토',
  '허가 관리 > 기술이전 회의&회의록 작성',
  '허가 관리 > 품목갱신 취합·작성(5년 갱신)',
  '허가 관리 > 허가증 접수 및 변경 사항 검토',
  '허가 관리 > 기타',
  '허가 관리 > 미팅 및 회의',
  '허가 관리 > 응대 업무',
  'GMP 문서 > 계획서/보고서',
  'GMP 문서 > 기준서 및 SOP',
  'GMP 문서 > 기타',
  'GMP 문서 > 미팅 및 회의',
  'GMP 문서 > 응대 업무',
  'GMP 문서 > 로그북 발행 및 관리',
  'GMP 문서 > 문서관리(폐기, 정리 등)',
  'GMP 문서 > 수출용제품 영문성적서 발행',
  'GMP 문서 > 식약처 조사지시(불순물·제품)',
  'GMP 문서 > 제조소 총람 관리',
  'GMP 문서 > 제조/포장 기록서 작성 및 결재승인',
  'GMP 문서 > 제조/포장 기록서 발행 확인',
  'GMP 문서 > 제품표준서 작성 및 관리',
  'GMP 문서 > 협약서 검토(품질·시험위탁)',
  '출하 승인 > GMP검토·입출하승인(자위수화)',
  '출하 승인 > 완제품 샘플·검체·보관(전구분)',
  '출하 승인 > 입고 제품 문서 스캔 및 발송(수탁)',
  '출하 승인 > 입고 제품 문서 스캔(자사, 위탁)',
  '출하 승인 > 기타',
  '출하 승인 > 미팅 및 회의',
  '출하 승인 > 응대 업무',
  'Audit 관리 > 기타',
  'Audit 관리 > 미팅 및 회의',
  'Audit 관리 > 응대 업무',
  'Audit 관리 > 공급업체평가_수탁업체(방문평가)',
  'Audit 관리 > 공급업체평가_수탁업체(서면평가)',
  'Audit 관리 > 공급업체평가_원료업체(방문평가)',
  'Audit 관리 > 공급업체평가_원료업체(서면평가)',
  'Audit 관리 > 공급업체평가_자재(방문평가)',
  'Audit 관리 > 공급업체평가_자재(서면평가)',
  'Audit 관리 > 국내외 규제기관 수검(식약처 등)',
  'Audit 관리 > 시험위탁/기타(서비스업체)',
  'Audit 관리 > 위탁 수검_현장(수탁·국외)',
  'Audit 관리 > 위탁 수검_서면(수탁·국외)',
  'Audit 관리 > 현황표 관리',
  '자율 점검 > 계획서/보고서 작성 및 실시',
  '자율 점검 > 기타',
  '자율 점검 > 미팅 및 회의',
  '자율 점검 > 응대 업무',
  '교육 훈련 > GMP교육 외(개인정보, 성희롱 등)',
  '교육 훈련 > 교육 준비 및 평가',
  '교육 훈련 > 부서교육',
  '교육 훈련 > 기타(신입·경력·특수작업)',
  '교육 훈련 > 미팅 및 회의',
  '교육 훈련 > 응대 업무',
  '교육 훈련 > 외부교육(전달교육 포함)',
  '교육 훈련 > 전체교육',
  '일탈/OOS 관리 > 일탈 접수',
  '일탈/OOS 관리 > 일탈 조사 및 조사 보고서 작성',
  '일탈/OOS 관리 > 일탈 결과보고서 작성',
  '일탈/OOS 관리 > OOS 접수 및 조사계획 평가',
  '일탈/OOS 관리 > OOS 결과보고서 작성',
  '일탈/OOS 관리 > 기타',
  '일탈/OOS 관리 > 미팅 및 회의',
  '일탈/OOS 관리 > 응대 업무',
  '변경 관리 > 기타',
  '변경 관리 > 미팅 및 회의',
  '변경 관리 > 응대 업무',
  '변경 관리 > 변경관리 완료보고서 작성(자사)',
  '변경 관리 > 제조소GMP 변경 접수·영향(위탁)',
  '변경 관리 > GMP 변경 접수·영향·모니터(자사)',
  '불만 처리 > 기타',
  '불만 처리 > 미팅 및 회의',
  '불만 처리 > 응대 업무',
  '불만 처리 > 불만 접수·검토·보고(위탁제조)',
  '불만 처리 > 불만 접수·조사·영향(자사제조)',
  'CAPA 관리 > CAPA 접수 및 평가, 모니터링',
  'CAPA 관리 > CAPA 종결 보고서 작성',
  'CAPA 관리 > 기타',
  'CAPA 관리 > 미팅 및 회의',
  'CAPA 관리 > 응대 업무',
  '밸리데이션 > 공정밸리데이션',
  '밸리데이션 > 기타',
  '밸리데이션 > 미팅 및 회의',
  '밸리데이션 > 응대 업무',
  '밸리데이션 > 세척밸리데이션',
  '밸리데이션 > 운송밸리데이션',
  '밸리데이션 > 공조/용수/압공 밸리데이션',
  '밸리데이션 > 컴퓨터시스템밸리데이션',
  '밸리데이션 > 현황표 관리',
  '적격성 평가 (IQ,OQ,PQ) > 기타',
  '적격성 평가 (IQ,OQ,PQ) > 미팅 및 회의',
  '적격성 평가 (IQ,OQ,PQ) > 응대 업무',
  '적격성 평가 (IQ,OQ,PQ) > 보관소 구역 맵핑',
  '적격성 평가 (IQ,OQ,PQ) > 신규기기 평가(FAT포함)',
  '적격성 평가 (IQ,OQ,PQ) > 적격성평가 실시 및 보고서 작성',
  '적격성 평가 (IQ,OQ,PQ) > 적격성평가 현황표 관리',
  '적격성 평가 (IQ,OQ,PQ) > 표준 계측기관리 사외 계측기 교정',
  '적격성 평가 (IQ,OQ,PQ) > 제조지원시스템 관리·연간레포',
  '제품품질평가 > 문서 검토(Reviewer) 및 기타',
  '제품품질평가 > 제품품질평가보고서 작성',
  '제품품질평가 > 품질평가 계획·결과 보고',
  '제품품질평가 > 위탁사 품질평가자료(현황외)',
  '제품품질평가 > 기타',
  '제품품질평가 > 미팅 및 회의',
  '제품품질평가 > 응대 업무',
  '자재 관리 > LIMS 접수·배정·검토',
  '자재 관리 > 기타',
  '자재 관리 > 미팅 및 회의',
  '자재 관리 > 응대 업무',
  '자재 관리 > 불량 자재 확대 조사 및 처리',
  '자재 관리 > 자재 샘플링',
  '자재 관리 > 자재 시험&성적서 작성',
  '자재 관리 > 자재시험규격서 작성',
  '자재 관리 > 표시자재 제, 개정 관리(디자인)',
  '자재 관리 > 표준자재 및 보관 검체 관리',
  'BOM 관리 > 기타(화장품 등)',
  'BOM 관리 > 미팅 및 회의',
  'BOM 관리 > 응대 업무',
  'BOM 관리 > 위탁 제조 제품(위탁 의약품)',
  'BOM 관리 > 자사 제조 제품(자사, 수탁 의약품)',
  '회수 > 회수 계획 수립(연장 포함)',
  '회수 > 회수 퍼트 관리 및 수량 점검',
  '회수 > 회수 대상 폐기 확인 및 종결 보고',
  '백업 및 복구 관리 > 데이터 백업 실시',
  '백업 및 복구 관리 > 복구 테스트 실시',
  '백업 및 복구 관리 > 신규 저장장치 등록 및 관리',
  '시계 및 시간 관리 > 시간 점검 및 동기화(보정) 실시',
  '시계 및 시간 관리 > 시계 관리',
  '컴퓨터시스템 관리 > 사용자 계정 등록 및 폐기',
  '컴퓨터시스템 관리 > 신규 설비, 시스템 도입 평가',
  '컴퓨터시스템 관리 > 컴퓨터시스템 Audit Trail 점검',
  '컴퓨터시스템 관리 > 컴퓨터시스템 주기 점검',
  '기타 > 기타(GMP업무 외)',
  '기타 > 청소/정리',
  '기타 > 업무보고',
  '기타 > 방충방서 관리',
];

import type { Category } from '@/types/workLog';

/** QA 업무분류 flat 배열을 Category[] 트리로 변환 */
export function qaCategoriesToTree(): Category[] {
  const majorMap = new Map<string, number>();
  const tree: Category[] = [];
  let nextId = 1;
  let majorSort = 0;
  const subSortByMajor = new Map<string, number>();

  for (const item of QA_CATEGORIES_FLAT) {
    const trimmed = item.replace(/\r\n/g, ' ').trim();
    if (trimmed.includes(' > ')) {
      const [majorName, subName] = trimmed.split(' > ');
      const major = majorName!.trim();
      const sub = subName!.trim();
      if (!major || !sub) continue;

      let majorId = majorMap.get(major);
      if (majorId == null) {
        majorId = nextId++;
        majorMap.set(major, majorId);
        tree.push({ id: majorId, name: major, parentId: null, sortOrder: ++majorSort });
        subSortByMajor.set(major, 0);
      }
      const subSort = (subSortByMajor.get(major) ?? 0) + 1;
      subSortByMajor.set(major, subSort);
      tree.push({ id: nextId++, name: sub, parentId: majorId, sortOrder: subSort });
    } else {
      const major = trimmed;
      if (!major) continue;
      if (!majorMap.has(major)) {
        majorMap.set(major, nextId);
        tree.push({ id: nextId++, name: major, parentId: null, sortOrder: ++majorSort });
      }
    }
  }
  return tree;
}

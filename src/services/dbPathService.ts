import '@/types/electronBridge';

/**
 * DbPathService - DB 경로 선택 서비스
 * 
 * ⚠️ 이 파일은 Electron 전환 시 IPC로 연결됩니다.
 * ⚠️ 웹 미리보기에서는 동작하지 않습니다.
 * 
 * ===== 아키텍처 규칙 =====
 * 
 * [웹 환경 (현재)]
 * - 더미 구현체 사용 (모든 메서드가 null/빈 값 반환)
 * - 파일 다이얼로그 동작 안 함
 * - UI에서 버튼 비활성화
 * 
 * [Electron 환경 (전환 예정)]
 * - 이 파일의 구현체만 IPC 기반으로 교체
 * - window.electron.selectDbFile() → IPC 호출
 * - window.electron.createNewDb() → IPC 호출
 * - 폴더 선택 → SQLite 연결 가능
 * 
 * ===== 사용법 =====
 * 
 * import { dbPathService } from '@/services/dbPathService';
 * 
 * // DB 경로 선택 (파일 다이얼로그)
 * const path = await dbPathService.selectDbPath();
 * 
 * // 새 DB 생성 (저장 다이얼로그)
 * const newPath = await dbPathService.createNewDb();
 * 
 * // 현재 DB 경로 조회
 * const currentPath = dbPathService.getCurrentDbPath();
 * 
 * // Electron 환경 여부 확인
 * const isElectron = dbPathService.isElectronEnvironment();
 */

/**
 * DB 경로 서비스 인터페이스
 * 
 * Electron 전환 시 이 인터페이스를 구현한 IPC 기반 구현체로 교체합니다.
 */
export interface IDbPathService {
  selectDbPath(): Promise<string | null>;
  createNewDb(): Promise<string | null>;
  getCurrentDbPath(): string | null;
  /** Electron: IPC로 비동기 조회 */
  getCurrentDbPathAsync?(): Promise<string | null>;
  isElectronEnvironment(): boolean;
}

/**
 * Electron 환경용 IPC 기반 구현체
 */
class ElectronDbPathService implements IDbPathService {
  private get api() {
    return window.electron;
  }

  async selectDbPath(): Promise<string | null> {
    return this.api?.selectDbFile() ?? null;
  }

  async createNewDb(): Promise<string | null> {
    return this.api?.createNewDb() ?? null;
  }

  getCurrentDbPath(): string | null {
    return null; // 동기 조회 불가 - SettingsDialog에서 비동기로 로드
  }

  async getCurrentDbPathAsync(): Promise<string | null> {
    return this.api?.getDbPath() ?? null;
  }

  isElectronEnvironment(): boolean {
    return typeof window !== 'undefined' && this.api !== undefined;
  }
}

/**
 * 웹 환경용 더미 구현체
 */
class WebDbPathService implements IDbPathService {
  async selectDbPath(): Promise<string | null> {
    console.warn('[DbPathService] 웹 환경에서는 DB 경로 선택이 불가능합니다.');
    return null;
  }

  async createNewDb(): Promise<string | null> {
    console.warn('[DbPathService] 웹 환경에서는 새 DB 생성이 불가능합니다.');
    return null;
  }

  getCurrentDbPath(): string | null {
    return null;
  }

  isElectronEnvironment(): boolean {
    return false;
  }
}

/**
 * ===== Electron 전환 시 구현 예시 =====
 * 
 * class ElectronDbPathService implements IDbPathService {
 *   async selectDbPath(): Promise<string | null> {
 *     return await window.electron.selectDbFile();
 *   }
 * 
 *   async createNewDb(): Promise<string | null> {
 *     return await window.electron.createNewDb();
 *   }
 * 
 *   getCurrentDbPath(): string | null {
 *     return window.electron.getDbPath();
 *   }
 * 
 *   isElectronEnvironment(): boolean {
 *     return true;
 *   }
 * }
 */

// 환경에 따라 서비스 선택
export const dbPathService: IDbPathService =
  typeof window !== 'undefined' && window.electron ? new ElectronDbPathService() : new WebDbPathService();

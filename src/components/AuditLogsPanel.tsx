import { useState, useEffect } from 'react';
import { RefreshCw, FileText } from 'lucide-react';
import { AuditLog } from '@/types/workLog';
import { useDataService } from '@/hooks/useDataService';

export function AuditLogsPanel() {
  const { dataService } = useDataService();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      if (dataService.getAuditLogs) {
        const fetched = await dataService.getAuditLogs(50);
        setLogs(fetched);
      }
    } catch (e) {
      console.error('Failed to fetch audit logs:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [dataService]);

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] text-[#1e293b] p-6 max-w-7xl mx-auto w-full">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2 mb-1.5">
            <FileText className="w-5 h-5 text-primary" />
            감사 로그 (Audit Trail)
          </h2>
          <p className="text-sm text-muted-foreground">최근 데이터베이스 변경 이력을 확인합니다. (최대 50건)</p>
        </div>
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-white border border-black/10 rounded-md shadow-sm hover:bg-black/5 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          새로고침
        </button>
      </div>

      <div className="flex-1 bg-white border border-black/[0.08] rounded-xl overflow-hidden shadow-sm flex flex-col min-h-0">
        <div className="overflow-auto flex-1 p-0 custom-scrollbar">
          <table className="w-full text-sm text-left">
            <thead className="bg-[#f8fafc] sticky top-0 z-10 shadow-sm border-b border-black/[0.08]">
              <tr>
                <th className="px-4 py-3 font-semibold text-[#475569] w-36">변경 일시</th>
                <th className="px-4 py-3 font-semibold text-[#475569] w-24">작업</th>
                <th className="px-4 py-3 font-semibold text-[#475569] w-32">테이블</th>
                <th className="px-4 py-3 font-semibold text-[#475569]">상세 내용</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    {loading ? '로그를 불러오는 중입니다...' : '기록된 감사 로그가 없습니다.'}
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-primary/[0.02] transition-colors">
                    <td className="px-4 py-3 text-[#64748b] whitespace-nowrap">
                      {new Date(log.changedAt).toLocaleString('ko-KR')}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${
                        log.operation === 'INSERT' ? 'bg-blue-100 text-blue-700' :
                        log.operation === 'UPDATE' ? 'bg-orange-100 text-orange-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {log.operation}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{log.tableName}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 max-w-xl">
                        <div className="text-xs text-[#64748b]">ID: {log.recordId}</div>
                        {log.oldData && (
                          <div className="bg-red-50 text-red-800 p-2 rounded text-xs overflow-x-auto custom-scrollbar">
                            <span className="font-semibold block mb-1">Old Data:</span>
                            {JSON.stringify(log.oldData)}
                          </div>
                        )}
                        {log.newData && (
                          <div className="bg-blue-50 text-blue-800 p-2 rounded text-xs overflow-x-auto custom-scrollbar">
                            <span className="font-semibold block mb-1">New Data:</span>
                            {JSON.stringify(log.newData)}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

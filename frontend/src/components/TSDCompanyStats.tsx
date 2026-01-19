import { useState, useEffect } from 'react';
import axios from 'axios';

interface TSDCompanyStatsProps {
  companyName: string;
}

interface CompanyTSDStats {
  issued_count: number;
  returned_count: number;
  issued_tsd_numbers: string | null;
  company_issued_count: number;
}

export default function TSDCompanyStats({ companyName }: TSDCompanyStatsProps) {
  const [stats, setStats] = useState<CompanyTSDStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadStats();
    // Обновляем статистику каждые 30 секунд
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, [companyName]);

  const loadStats = async () => {
    if (!companyName) return;
    
    setLoading(true);
    try {
      const response = await axios.get('/api/tsd/stats');
      const companyStats = response.data.find((s: any) => s.company === companyName);
      
      if (companyStats) {
        setStats({
          issued_count: companyStats.issued_count || 0,
          returned_count: companyStats.returned_count || 0,
          issued_tsd_numbers: companyStats.issued_tsd_numbers || null,
          company_issued_count: companyStats.company_issued_count || 0
        });
      } else {
        setStats({
          issued_count: 0,
          returned_count: 0,
          issued_tsd_numbers: null,
          company_issued_count: 0
        });
      }
    } catch (error) {
      console.error('Error loading TSD stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !stats) {
    return (
      <div className="mt-4 p-4 bg-white rounded-lg border border-gray-200">
        <h3 className="text-sm font-semibold mb-2">ТСД</h3>
        <div className="text-xs text-gray-500">Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="mt-4 p-4 bg-white rounded-lg border border-gray-200">
      <h3 className="text-sm font-semibold mb-2">ТСД</h3>
      {stats ? (
        <>
          <div className="text-xs text-gray-600 mb-1">
            Выдано: <span className="font-semibold text-blue-600">{stats.issued_count}</span>
          </div>
          {stats.issued_tsd_numbers && (
            <div className="text-xs text-gray-500 mb-2 break-words">
              ТСД: {stats.issued_tsd_numbers.split(',').join(', ')}
            </div>
          )}
          {!stats.issued_tsd_numbers && stats.issued_count === 0 && (
            <div className="text-xs text-gray-500 mb-2">Нет выданных ТСД</div>
          )}
        </>
      ) : (
        <div className="text-xs text-gray-500 mb-2">Нет данных</div>
      )}
    </div>
  );
}



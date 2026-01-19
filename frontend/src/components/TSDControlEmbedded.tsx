import { useState } from 'react';
import TSDIssueForm from './TSDIssueForm';
import TSDReturnForm from './TSDReturnForm';
import TSDLogTable from './TSDLogTable';

type TabType = 'issue' | 'return' | 'log';

export default function TSDControlEmbedded() {
  const [activeTab, setActiveTab] = useState<TabType>('issue');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSuccess = () => {
    // Обновляем журнал после успешной операции
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="w-full">
      {/* Вкладки */}
      <div className="mb-4 border-b border-gray-200">
        <nav className="flex space-x-4">
          <button
            onClick={() => setActiveTab('issue')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'issue'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Выдать ТСД
          </button>
          <button
            onClick={() => setActiveTab('return')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'return'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Принять ТСД
          </button>
          <button
            onClick={() => setActiveTab('log')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'log'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Журнал операций
          </button>
        </nav>
      </div>

      {/* Контент вкладок */}
      <div className="mt-4">
        {activeTab === 'issue' && (
          <TSDIssueForm key={refreshKey} onSuccess={handleSuccess} />
        )}
        {activeTab === 'return' && (
          <TSDReturnForm key={refreshKey} onSuccess={handleSuccess} />
        )}
        {activeTab === 'log' && (
          <TSDLogTable key={refreshKey} />
        )}
      </div>
    </div>
  );
}



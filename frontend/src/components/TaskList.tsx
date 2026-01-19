import { useState, useEffect } from 'react';
import axios from 'axios';
import TaskModal from './TaskModal';
import PhotoModal from './PhotoModal';
import { useAuth } from '../contexts/AuthContext';

interface Task {
  id: number;
  title: string;
  duration_minutes: number;
  created_at: string;
  status: 'pending' | 'completed' | 'expired';
  photo_url: string | null;
  company_name?: string;
  require_photo?: number;
}

interface TaskListProps {
  companyId: number | null;
  canCreate?: boolean;
}

export default function TaskList({ companyId, canCreate = false }: TaskListProps) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Загрузка задач и обновление времени
  useEffect(() => {
    loadTasks();
    const taskInterval = setInterval(loadTasks, 300000); // Обновление задач каждые 5 минут
    
    // Таймер для обновления текущего времени
    const timeTimer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Обновление времени каждую минуту для точного отсчета

    return () => {
      clearInterval(taskInterval);
      clearInterval(timeTimer);
    };
  }, [companyId]);

  const loadTasks = async () => {
    try {
      const response = await axios.get('/api/tasks');
      let filteredTasks = response.data;

      if (companyId) {
        filteredTasks = filteredTasks.filter((t: any) => t.assigned_company_id === companyId);
      }

      // Проверка просроченных задач
      const now = new Date();
      filteredTasks = filteredTasks.map((task: any) => {
        const createdAt = new Date(task.created_at);
        const expiresAt = new Date(createdAt.getTime() + task.duration_minutes * 60 * 1000);
        
        if (task.status === 'pending' && now > expiresAt) {
          return { ...task, status: 'expired' };
        }
        return task;
      });

      setTasks(filteredTasks);
    } catch (error) {
      console.error('Error loading tasks:', error);
    }
  };

  const handleStatusChange = async (taskId: number, status: 'pending' | 'completed' | 'expired') => {
    const task = tasks.find(t => t.id === taskId);
    if (status === 'completed' && task?.require_photo && !task.photo_url) {
      alert('Нельзя завершить задачу без фото. Сначала загрузите фото.');
      return;
    }
    
    try {
      await axios.patch(`/api/tasks/${taskId}/status`, { status });
      loadTasks();
    } catch (error: any) {
      console.error('Error updating task status:', error);
      if (error.response?.data?.error) {
        alert(error.response.data.error);
      }
    }
  };

  const getRemainingTime = (task: Task) => {
    if (task.status === 'completed' || task.status === 'expired') return null;
    
    const createdAt = new Date(task.created_at);
    const expiresAt = new Date(createdAt.getTime() + task.duration_minutes * 60 * 1000);
    const remaining = expiresAt.getTime() - currentTime.getTime();
    
    if (remaining <= 0) return 'Истекло';
    
    const minutes = Math.floor(remaining / 60000);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours > 0) {
      return `${hours}ч ${mins}м`;
    }
    return `${mins}м`;
  };

  const handleTaskCreated = () => {
    setShowCreateModal(false);
    loadTasks();
  };

  const getStatusIcon = (task: Task) => {
    if (task.status === 'expired') return '❌';
    return '—';
  };

  const handleUploadPhoto = (task: Task) => {
    setSelectedTask(task);
    setPhotoUrl(null);
    setShowPhotoModal(true);
  };

  const handleViewPhoto = (task: Task) => {
    setSelectedTask(null);
    setPhotoUrl(task.photo_url);
    setShowPhotoModal(true);
  };

  const handlePhotoUploaded = () => {
    setShowPhotoModal(false);
    setSelectedTask(null);
    setPhotoUrl(null);
    loadTasks();
  };

  // Фильтрация задач: для админа, оператора и менеджера в основном списке показываем только активные
  const isAdminOrOperator = user?.role === 'admin' || user?.role === 'operator';
  const isManager = user?.role === 'manager';
  const showOnlyActive = isAdminOrOperator || isManager;
  const activeTasks = showOnlyActive
    ? tasks.filter(t => t.status === 'pending')
    : tasks;

  // История задач: завершённые и просроченные
  const historyTasks = tasks
    .filter(t => t.status === 'completed' || t.status === 'expired')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const handleCancelTask = async (taskId: number) => {
    try {
      await axios.patch(`/api/tasks/${taskId}/status`, { status: 'expired' });
      loadTasks();
    } catch (error: any) {
      console.error('Error cancelling task:', error);
      alert(error.response?.data?.error || 'Ошибка при отмене задачи');
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    if (!confirm('Вы уверены, что хотите удалить эту задачу без возможности восстановления?')) return;
    try {
      await axios.delete(`/api/tasks/${taskId}`);
      loadTasks();
    } catch (error: any) {
      console.error('Error deleting task:', error);
      alert(error.response?.data?.error || 'Ошибка при удалении задачи');
    }
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Блокнот задач</h2>
      {(canCreate || isManager || isAdminOrOperator) && (
        <div className="flex items-center justify-between gap-2 mb-4">
          {canCreate ? (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex-1 bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600"
            >
              Создать задание
            </button>
          ) : (
            <div className="flex-1" />
          )}
          {(isAdminOrOperator || isManager) && (
            <button
              onClick={() => setShowHistoryModal(true)}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 text-sm whitespace-nowrap"
            >
              История
            </button>
          )}
        </div>
      )}
      <div className="space-y-2">
        {activeTasks.map((task, index) => (
          <div key={task.id} className={`border rounded p-3 ${
            task.status === 'completed' ? 'bg-green-50 border-green-200' :
            task.status === 'expired' ? 'bg-red-50 border-red-200' :
            'bg-white border-gray-200'
          }`}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{index + 1}.</span>
                  <span className="font-medium">{task.title}</span>
                  <span className={`text-sm ${
                    task.status === 'expired' ? 'text-red-600' : 'text-gray-500'
                  }`}>
                    ({getRemainingTime(task) || `${task.duration_minutes}м`})
                  </span>
                  <span className="text-sm text-gray-400">
                    {getStatusIcon(task)}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {task.require_photo && (
                    <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded" title="Требуется фото">
                      📷
                    </span>
                  )}
                  {task.company_name && (
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                      {task.company_name}
                    </span>
                  )}
                  <span className="text-xs text-gray-500">
                    Создано: {new Date(task.created_at).toLocaleTimeString()}
                  </span>
                </div>
              </div>
              <div className="flex gap-2 ml-2">
                {task.status !== 'completed' && task.status !== 'expired' && (
                  <>
                    {!task.photo_url && (
                      <button
                        onClick={() => handleUploadPhoto(task)}
                        className="text-blue-500 hover:text-blue-700 p-1"
                        title="Загрузить фото"
                      >
                        📷
                      </button>
                    )}
                    {task.photo_url && (
                      <button
                        onClick={() => handleViewPhoto(task)}
                        className="text-green-500 hover:text-green-700 p-1"
                        title="Просмотреть фото"
                      >
                        🖼️
                      </button>
                    )}
                  </>
                )}
                {task.status === 'pending' && (
                  <button
                    onClick={() => handleStatusChange(task.id, 'completed')}
                    className="text-green-500 hover:text-green-700 p-1"
                    title="Отметить выполненным"
                  >
                    ✓
                  </button>
                )}
                {task.status === 'completed' && task.photo_url && (
                  <button
                    onClick={() => handleViewPhoto(task)}
                    className="text-green-500 hover:text-green-700 p-1"
                    title="Просмотреть фото"
                  >
                    ✅
                  </button>
                )}
                {task.status === 'expired' && (
                  <span className="text-red-500 p-1" title="Просрочено">
                    ❌
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        {activeTasks.length === 0 && (
          <div className="text-gray-500 text-center py-4">Нет задач</div>
        )}
      </div>
      {showCreateModal && (
        <TaskModal
          onClose={() => setShowCreateModal(false)}
          onTaskCreated={handleTaskCreated}
        />
      )}
      {showPhotoModal && (
        <PhotoModal
          task={selectedTask}
          photoUrl={photoUrl}
          onClose={() => {
            setShowPhotoModal(false);
            setSelectedTask(null);
            setPhotoUrl(null);
          }}
          onPhotoUploaded={handlePhotoUploaded}
        />
      )}
      {showHistoryModal && (isAdminOrOperator || isManager) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">История задач</h3>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="text-gray-500 hover:text-gray-700 text-sm"
              >
                Закрыть
              </button>
            </div>
            {historyTasks.length === 0 ? (
              <div className="text-gray-500 text-center py-4">Пока нет выполненных или просроченных задач</div>
            ) : (
              <div className="space-y-2">
                {historyTasks.map((task, index) => (
                  <div
                    key={task.id}
                    className={`border rounded p-3 text-sm ${
                      task.status === 'completed' ? 'bg-green-50 border-green-200' :
                      'bg-red-50 border-red-200'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{index + 1}.</span>
                          <span className="font-medium">{task.title}</span>
                          <span className={`text-xs ${
                            task.status === 'expired' ? 'text-red-600' : 'text-green-600'
                          }`}>
                            {task.status === 'completed' ? 'Выполнено' : 'Просрочено'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2 items-center">
                          {task.company_name && (
                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                              {task.company_name}
                            </span>
                          )}
                          <span className="text-xs text-gray-500">
                            Создано: {new Date(task.created_at).toLocaleString()}
                          </span>
                          <span className="text-xs text-gray-500">
                            Длительность: {task.duration_minutes}м
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {task.photo_url && (
                          <button
                            onClick={() => {
                              setShowHistoryModal(false);
                              handleViewPhoto(task);
                            }}
                            className="text-green-500 hover:text-green-700 text-lg"
                            title="Просмотреть фото"
                          >
                            🖼️
                          </button>
                        )}
                        {(isAdminOrOperator || isManager) && task.status !== 'expired' && (
                          <button
                            onClick={() => handleCancelTask(task.id)}
                            className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
                          >
                            Отменить
                          </button>
                        )}
                        {isAdminOrOperator && user?.role === 'admin' && (
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                          >
                            Удалить
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
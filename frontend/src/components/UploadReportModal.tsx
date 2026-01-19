import React, { useState } from 'react';
import axios from 'axios';
import html2canvas from 'html2canvas';

interface UploadReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess?: () => void;
}

export default function UploadReportModal({ isOpen, onClose, onUploadSuccess }: UploadReportModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [autoDetectDate, setAutoDetectDate] = useState(true);
  const [detectingDate, setDetectingDate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState<string>('');
  const [uploadTime, setUploadTime] = useState<string>('');
  const uploadStartTimeRef = React.useRef<number | null>(null);
  const isClosingRef = React.useRef<boolean>(false);
  const processingIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const fileArray = Array.from(e.target.files);
      setFiles(fileArray);
      setError(null);
      
      // Автоматически определяем дату работы, если включена опция
      if (autoDetectDate && fileArray.length > 0) {
        detectWorkDateFromFiles(fileArray);
      }
    }
  };

  const detectWorkDateFromFiles = async (filesToDetect: File[]) => {
    if (filesToDetect.length === 0) return;
    
    setDetectingDate(true);
    try {
      const formData = new FormData();
      filesToDetect.forEach(file => {
        formData.append('files', file);
      });
      
      const response = await axios.post('/integrations/analyz/detect_work_date', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      if (response.data?.success && response.data?.work_date) {
        setDate(response.data.work_date);
        console.log('Определена дата работы:', response.data.work_date, 'из', response.data.total_files, 'файлов');
      }
    } catch (err: any) {
      console.warn('Не удалось определить дату автоматически:', err.response?.data?.error || err.message);
      // Не показываем ошибку пользователю, просто оставляем текущую дату
    } finally {
      setDetectingDate(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) {
      setError('Выберите файлы');
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(false);
    setUploadProgress(0);
    setUploadSpeed('');
    setUploadTime('');
    uploadStartTimeRef.current = Date.now();
    isClosingRef.current = false;
    
    // Объявляем переменные для отслеживания прогресса
    let lastProgressUpdate = Date.now();
    let progressFallbackInterval: ReturnType<typeof setInterval> | null = null;
    
    // Запускаем fallback прогресс, если он застрял
    const startProgressFallback = () => {
      if (progressFallbackInterval) return;
      progressFallbackInterval = setInterval(() => {
        const timeSinceLastUpdate = Date.now() - lastProgressUpdate;
        // Если прогресс не обновлялся больше 2 секунд, увеличиваем немного
        if (timeSinceLastUpdate > 2000 && uploadProgress < 95) {
          setUploadProgress(prev => Math.min(prev + 1, 95));
        }
      }, 1000);
    };
    
    // Устанавливаем начальный прогресс, чтобы показать, что загрузка началась
    setTimeout(() => {
      if (uploadProgress === 0 && uploading) {
        setUploadProgress(1);
      }
    }, 100);

    try {
      const formData = new FormData();
      // Добавляем все файлы
      files.forEach(file => {
        formData.append('files', file);
      });
      // Если автоопределение даты включено, НЕ отправляем дату - пусть бэкенд определит для каждого файла отдельно
      // Если автоопределение выключено, отправляем дату из поля ввода
      if (!autoDetectDate) {
        formData.append('date', date);
      }

      let loadedBytes = 0;
      const startTime = Date.now();

      const response = await axios.post('/integrations/analyz/analyze', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        timeout: 300000, // 5 минут таймаут для больших файлов
        onUploadProgress: (progressEvent) => {
          lastProgressUpdate = Date.now(); // Обновляем время последнего обновления
          
          // Логируем для отладки
          console.log('Upload progress:', {
            loaded: progressEvent.loaded,
            total: progressEvent.total,
            percent: progressEvent.total ? Math.round((progressEvent.loaded * 100) / progressEvent.total) : 'unknown'
          });
          
          // Останавливаем fallback, так как прогресс обновляется
          if (progressFallbackInterval) {
            clearInterval(progressFallbackInterval);
            progressFallbackInterval = null;
          }
          
          // Всегда обновляем прогресс, даже если total неизвестен
          if (progressEvent.total && progressEvent.total > 0) {
            loadedBytes = progressEvent.loaded;
            const uploadPercent = Math.min(Math.round((progressEvent.loaded * 100) / progressEvent.total), 100);
            setUploadProgress(uploadPercent);
            
            // Рассчитываем скорость загрузки
            const elapsed = (Date.now() - startTime) / 1000; // секунды
            if (elapsed > 0 && uploadPercent < 100) {
              const speedBps = loadedBytes / elapsed; // байт/сек
              const speedKbps = speedBps / 1024; // КБ/сек
              const speedMbps = speedKbps / 1024; // МБ/сек
              
              if (speedMbps >= 1) {
                setUploadSpeed(`${speedMbps.toFixed(2)} МБ/с`);
              } else {
                setUploadSpeed(`${speedKbps.toFixed(2)} КБ/с`);
              }
            }
            
            // Файл полностью отправлен - закрываем модалку сразу
            if (uploadPercent >= 100 && uploadStartTimeRef.current && !isClosingRef.current) {
              const uploadTime_elapsed = (Date.now() - uploadStartTimeRef.current) / 1000; // секунды
              if (uploadTime_elapsed < 1) {
                setUploadTime(`${Math.round(uploadTime_elapsed * 1000)} мс`);
              } else {
                setUploadTime(`${uploadTime_elapsed.toFixed(2)} сек`);
              }
              setUploadSpeed(''); // Очищаем скорость, файл отправлен
              
              // Файлы отправлены - сразу показываем успех и закрываем модалку
              setUploadComplete(true);
              setSuccess(true);
              setFiles([]);
              
              // Reset file input
              const fileInput = document.getElementById('file') as HTMLInputElement;
              if (fileInput) fileInput.value = '';
              
              // Закрываем модалку через небольшую задержку, чтобы пользователь увидел успех
              isClosingRef.current = true;
              setTimeout(() => {
                if (onUploadSuccess) onUploadSuccess();
                handleClose();
              }, 800);
            }
          } else if (progressEvent.loaded > 0) {
            // Если total неизвестен, показываем прогресс на основе размера файлов
            const totalSize = files.reduce((sum, f) => sum + f.size, 0);
            if (files.length > 0 && totalSize > 0) {
              const estimatedPercent = Math.min(Math.round((progressEvent.loaded * 100) / totalSize), 95);
              setUploadProgress(estimatedPercent);
              
              // Рассчитываем скорость загрузки
              const elapsed = (Date.now() - startTime) / 1000;
              if (elapsed > 0) {
                const speedBps = progressEvent.loaded / elapsed;
                const speedKbps = speedBps / 1024;
                const speedMbps = speedKbps / 1024;
                
                if (speedMbps >= 1) {
                  setUploadSpeed(`${speedMbps.toFixed(2)} МБ/с`);
                } else {
                  setUploadSpeed(`${speedKbps.toFixed(2)} КБ/с`);
                }
              }
            } else {
              // Если и файл неизвестен, показываем постепенный прогресс
              setUploadProgress(prev => Math.min(prev + 1, 95));
            }
          }
        },
      });
      
      // Запускаем fallback прогресс через 2 секунды, если onUploadProgress не срабатывает
      startProgressFallback();

      // Файл отправлен, модалка уже закрыта (закрылась в onUploadProgress при 100%)
      // Обрабатываем ответ от сервера в фоне - обработка данных происходит асинхронно на сервере
      // Если модалка еще не закрыта (если onUploadProgress не сработал), закрываем здесь
      if (!isClosingRef.current) {
        // Рассчитываем время отправки файла (если еще не рассчитано)
        if (uploadStartTimeRef.current && !uploadTime) {
          const uploadTime_elapsed = (Date.now() - uploadStartTimeRef.current) / 1000; // секунды
          if (uploadTime_elapsed < 1) {
            setUploadTime(`${Math.round(uploadTime_elapsed * 1000)} мс`);
          } else {
            setUploadTime(`${uploadTime_elapsed.toFixed(2)} сек`);
          }
        }
        
        // Показываем успех и закрываем модалку
        setUploadComplete(true);
        setSuccess(true);
        setUploadProgress(100);
        setFiles([]);
        setUploadSpeed('');
        
        // Reset file input
        const fileInput = document.getElementById('file') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
        
        // Закрываем модалку
        isClosingRef.current = true;
        setTimeout(() => {
          if (onUploadSuccess) onUploadSuccess();
          handleClose();
        }, 800);
      }
      
      // Обрабатываем ответ от сервера в фоне (обработка данных уже идет асинхронно на сервере)
      // Запускаем обработку скриншотов в фоне (если есть дата и успешный ответ)
      if (response.data && (response.data.success || !response.data.error)) {
        if (date) {
          processScreenshotsAsync(date).catch(err => {
            console.error('Ошибка при обработке скриншотов:', err);
          });
        }
      } else {
        // Ошибка на сервере - логируем в консоль
        console.error('Ошибка при обработке файла на сервере:', response.data?.error || 'Неизвестная ошибка');
      }
    } catch (err: any) {
      // Если модалка еще открыта (не закрылась при отправке), показываем ошибку
      // Останавливаем любые интервалы при ошибке
      if (progressFallbackInterval) {
        clearInterval(progressFallbackInterval);
        progressFallbackInterval = null;
      }
      if (processingIntervalRef.current) {
        clearInterval(processingIntervalRef.current);
        processingIntervalRef.current = null;
      }
      // Проверяем, закрыта ли уже модалка (если uploadProgress === 100, она закрыта)
      if (uploadProgress < 100) {
        setUploadProgress(0);
        setUploadSpeed('');
        setUploading(false);
        setError(err.response?.data?.error || err.message || 'Ошибка при загрузке файла');
      } else {
        // Модалка уже закрыта, просто логируем ошибку
        console.error('Ошибка при обработке файла (модалка уже закрыта):', err.response?.data?.error || err.message);
      }
    }
  };

  const handleClear = async () => {
    const target = date ? `данные за ${date}` : 'общие накопленные данные';
    if (!window.confirm(`Очистить ${target}?`)) {
      return;
    }

    setClearing(true);
    setError(null);
    setSuccess(false);

    try {
      const formData = new FormData();
      if (date) {
        formData.append('date', date);
      }

      const response = await axios.post('/integrations/analyz/clear_accumulator', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      // Flask возвращает редирект, но мы можем проверить статус
      if (response.status === 200 || response.status === 302) {
        setSuccess(true);
        setTimeout(() => {
          if (onUploadSuccess) onUploadSuccess();
          handleClose();
        }, 1500);
      }
    } catch (err: any) {
      // Flask может вернуть редирект, что вызывает ошибку в axios
      // Но если запрос прошел, это нормально
      if (err.response?.status === 302 || err.response?.status === 200) {
        setSuccess(true);
        setTimeout(() => {
          if (onUploadSuccess) onUploadSuccess();
          handleClose();
        }, 1500);
      } else {
        setError(err.response?.data?.error || err.message || 'Ошибка при очистке данных');
      }
    } finally {
      setClearing(false);
    }
  };

  // Асинхронная обработка скриншотов в фоне
  const processScreenshotsAsync = async (dateStr: string) => {
    try {
      // Даем время на сохранение данных на сервере
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Получаем список компаний для этой даты
      const companiesResponse = await axios.post(`/integrations/analyz/trigger_screenshots/${dateStr}`);
      if (companiesResponse.data?.success && companiesResponse.data?.companies?.length > 0) {
        // Создаем и отправляем скриншоты
        await sendScreenshotsForCompanies(dateStr, companiesResponse.data.companies);
      }
      
      // Отправляем скриншоты простоев после основных скриншотов
      await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        const idleResponse = await axios.post(`/integrations/analyz/send_idle_screenshots/${dateStr}`);
        if (idleResponse.data?.success) {
          console.log(`Скриншоты простоев отправлены: ${idleResponse.data.sent_count || 0} компаний`);
        }
      } catch (err) {
        console.error('Ошибка при отправке скриншотов простоев:', err);
      }
    } catch (err) {
      console.error('Ошибка при обработке скриншотов:', err);
      // Не показываем ошибку пользователю, так как это фоновый процесс
    }
  };

  const handleClose = () => {
    setFiles([]);
    setError(null);
    setSuccess(false);
    setUploadComplete(false);
    setProcessing(false);
    setClearing(false);
    setUploadProgress(0);
    setUploadSpeed('');
    setUploadTime('');
    setDetectingDate(false);
    uploadStartTimeRef.current = null;
    isClosingRef.current = false;
    if (processingIntervalRef.current) {
      clearInterval(processingIntervalRef.current);
      processingIntervalRef.current = null;
    }
    setDate(new Date().toISOString().split('T')[0]);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h5 className="text-lg font-semibold">Загрузить отчет</h5>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 text-xl"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="p-4 space-y-4">
            <div>
              <label htmlFor="file" className="block text-sm font-medium text-gray-700 mb-1">
                Выберите файлы (CSV или XLSX) {files.length > 0 && `(${files.length})`}
              </label>
              <input
                type="file"
                id="file"
                name="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                multiple
                required
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">
                Поддерживаются CSV и Excel файлы с нужными полями. Можно выбрать несколько файлов.
              </p>
              {files.length > 0 && (
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {files.map((file, index) => (
                    <div key={index} className="text-xs text-gray-600 bg-gray-50 p-2 rounded">
                      📄 {file.name} ({(file.size / 1024).toFixed(1)} КБ)
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  id="autoDetectDate"
                  checked={autoDetectDate}
                  onChange={(e) => {
                    setAutoDetectDate(e.target.checked);
                    if (e.target.checked && files.length > 0) {
                      detectWorkDateFromFiles(files);
                    }
                  }}
                  className="rounded"
                />
                <label htmlFor="autoDetectDate" className="text-sm font-medium text-gray-700">
                  Определить дату работы автоматически по пикам в файлах
                </label>
              </div>
              <label htmlFor="date" className="block text-sm font-medium text-gray-700 mb-1">
                Дата (для помесячной статистики)
                {detectingDate && <span className="ml-2 text-blue-600 text-xs">🔍 Определение...</span>}
              </label>
              <input
                type="date"
                id="date"
                name="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={detectingDate}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm disabled:bg-gray-100"
              />
              <p className="mt-1 text-xs text-gray-500">
                {autoDetectDate 
                  ? 'Дата будет определена автоматически по столбцу "дата подтверждения" в загруженных файлах.'
                  : 'Если указать дату, файлы добавятся к этой дате и будут анализироваться только она.'}
              </p>
            </div>
            {/* Прогресс-бар загрузки */}
            {uploading && (
              <div className="space-y-2">
                <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden shadow-inner">
                  <div 
                    className="bg-gradient-to-r from-blue-500 to-blue-600 h-4 rounded-full transition-all duration-300 ease-out flex items-center justify-center shadow-sm"
                    style={{ width: `${uploadProgress}%` }}
                  >
                    {uploadProgress > 20 && (
                      <span className="text-xs font-bold text-white drop-shadow-md">{uploadProgress}%</span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-700 font-medium">
                      {uploadProgress < 100 
                        ? `📤 Отправка файла: ${uploadProgress}%`
                        : '✅ Файл отправлен'}
                    </span>
                    {files.length > 0 && uploadProgress < 100 && (
                      <span className="text-gray-500">
                        ({files.length} файл{files.length > 1 ? 'ов' : ''}, {(files.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024).toFixed(2)} МБ)
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3 items-center">
                    {uploadSpeed && uploadProgress < 100 && (
                      <span className="text-blue-600 font-semibold">⚡ {uploadSpeed}</span>
                    )}
                    {uploadTime && uploadProgress === 100 && (
                      <span className="text-green-600 font-semibold">⏱️ {uploadTime}</span>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {error}
              </div>
            )}
            {success && (
              <div className="space-y-2">
                <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
                  {clearing ? 'Данные успешно очищены!' : uploadComplete ? 'Файл успешно загружен!' : 'Загрузка...'}
                  {uploadTime && uploadComplete && (
                    <div className="mt-1 text-xs text-green-600">
                      ⏱️ Время загрузки: {uploadTime}
                    </div>
                  )}
                </div>
                {processing && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
                    ⏳ Обработка скриншотов в фоне... (это может занять некоторое время)
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="p-4 border-t border-gray-200 flex justify-between items-center">
            <button
              type="button"
              onClick={handleClear}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
              disabled={uploading || clearing}
            >
              {clearing ? 'Очистка...' : 'Очистить накопленные'}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                disabled={uploading || clearing}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                disabled={uploading || clearing || processing || files.length === 0}
              >
                {uploading ? 'Загрузка...' : processing ? 'Обработка...' : 'Загрузить отчет'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// Функция для автоматической отправки скриншотов компаний в Telegram
async function sendScreenshotsForCompanies(dateStr: string, companies: string[]) {
  console.log(`Начинаем создание скриншотов для ${companies.length} компаний за ${dateStr}`);
  
  try {
    // Загружаем данные для даты
    const dataResponse = await axios.get(`/integrations/analyz/faststat_data/${dateStr}`);
    if (!dataResponse.data?.tasks || dataResponse.data.tasks.length === 0) {
      console.log('Нет данных для создания скриншотов');
      return;
    }

    const tasks = dataResponse.data.tasks;
    console.log(`Загружено ${tasks.length} задач для обработки`);
    
    // Группируем задачи по компаниям
    const companiesData: Record<string, any[]> = {};
    companies.forEach(company => {
      companiesData[company] = tasks.filter((t: any) => t.company === company);
      console.log(`Компания ${company}: ${companiesData[company].length} задач`);
    });

    // ЭТАП 1: Создаем ВСЕ скриншоты сначала
    console.log('\n=== ЭТАП 1: Создание всех скриншотов ===');
    const screenshots: Array<{company: string, blob: Blob}> = [];
    const creationErrors: string[] = [];

    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      const companyTasks = companiesData[company];
      
      if (!companyTasks || companyTasks.length === 0) {
        console.warn(`Пропускаем компанию ${company}: нет задач`);
        continue;
      }

      try {
        console.log(`[${i + 1}/${companies.length}] Создание скриншота для компании: ${company}`);
        
        // Создаем скриншот
        const screenshot = await createCompanyScreenshot(company, companyTasks, dateStr);
        if (!screenshot) {
          console.error(`✗ Не удалось создать скриншот для компании ${company}`);
          creationErrors.push(`${company}: ошибка создания скриншота`);
          continue;
        }

        screenshots.push({ company, blob: screenshot });
        console.log(`✓ Скриншот для компании ${company} создан успешно`);
        
        // Небольшая задержка между созданием скриншотов, чтобы не перегружать браузер
        if (i < companies.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (err: any) {
        console.error(`✗ Ошибка при создании скриншота для компании ${company}:`, err);
        creationErrors.push(`${company}: ${err.message || 'Неизвестная ошибка'}`);
        // Продолжаем создание скриншотов для остальных компаний
      }
    }

    console.log(`\n=== Создание скриншотов завершено ===`);
    console.log(`Успешно создано: ${screenshots.length}/${companies.length}`);
    if (creationErrors.length > 0) {
      console.warn('Ошибки при создании:', creationErrors);
    }

    // ЭТАП 2: Отправляем ВСЕ готовые скриншоты в Telegram
    if (screenshots.length === 0) {
      console.log('Нет скриншотов для отправки');
      return;
    }

    console.log(`\n=== ЭТАП 2: Отправка ${screenshots.length} скриншотов в Telegram ===`);
    let successCount = 0;
    let errorCount = 0;
    const sendErrors: string[] = [];

    for (let i = 0; i < screenshots.length; i++) {
      const { company, blob } = screenshots[i];
      
      try {
        console.log(`[${i + 1}/${screenshots.length}] Отправка скриншота для компании: ${company}`);
        
        // Отправляем скриншот на сервер с retry
        let sent = false;
        for (let retry = 0; retry < 3; retry++) {
          try {
            const formData = new FormData();
            formData.append('file', blob, `${company}_${dateStr}.png`);
            formData.append('company', company);
            formData.append('date', dateStr);

            await axios.post('/integrations/analyz/send_screenshot', formData, {
              headers: {
                'Content-Type': 'multipart/form-data',
              },
              timeout: 120000, // 2 минуты таймаут
            });
            
            console.log(`✓ Скриншот для компании ${company} успешно отправлен в Telegram`);
            successCount++;
            sent = true;
            break;
          } catch (sendErr: any) {
            if (retry < 2) {
              console.warn(`Попытка ${retry + 1}/3 не удалась для ${company}, повтор через 2 секунды...`);
              await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
              throw sendErr;
            }
          }
        }

        if (!sent) {
          errorCount++;
          sendErrors.push(`${company}: не удалось отправить после 3 попыток`);
        }

        // Задержка между отправками, чтобы не перегружать сервер и Telegram API
        if (i < screenshots.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 секунды между отправками
        }
      } catch (err: any) {
        console.error(`✗ Ошибка при отправке скриншота для компании ${company}:`, err);
        errorCount++;
        sendErrors.push(`${company}: ${err.message || 'Неизвестная ошибка'}`);
        // Продолжаем отправку остальных скриншотов
      }
    }

    // Итоговая статистика
    console.log(`\n=== ИТОГИ ОТПРАВКИ СКРИНШОТОВ ===`);
    console.log(`Всего компаний: ${companies.length}`);
    console.log(`Скриншотов создано: ${screenshots.length}`);
    console.log(`Успешно отправлено: ${successCount}/${screenshots.length}`);
    console.log(`Ошибок при отправке: ${errorCount}`);
    if (creationErrors.length > 0) {
      console.warn('Ошибки при создании скриншотов:', creationErrors);
    }
    if (sendErrors.length > 0) {
      console.error('Ошибки при отправке скриншотов:', sendErrors);
    }
  } catch (err) {
    console.error('Критическая ошибка при обработке скриншотов:', err);
  }
}

// Функция для создания скриншота таблицы компании
async function createCompanyScreenshot(company: string, tasks: any[], dateStr: string): Promise<Blob | null> {
  try {
    // Создаем временный контейнер с таблицей
    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-9999px';
    tempContainer.style.top = '0';
    tempContainer.style.width = '1200px';
    tempContainer.style.backgroundColor = '#ffffff';
    tempContainer.style.padding = '20px';
    tempContainer.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    tempContainer.style.fontSize = '14px';
    tempContainer.style.lineHeight = '1.5';

    // Группируем задачи по сотрудникам
    const employeesMap: Record<string, any> = {};
    tasks.forEach((task: any) => {
      const emp = task.employee;
      if (!employeesMap[emp]) {
        employeesMap[emp] = {
          employee: emp,
          tasks2021: [],
          tasks2060: [],
          taskCount: 0,
          totalWeight: 0,
          uniqueEO2021Count: 0,
          uniqueEO2060Count: 0,
          lastTime: '00:00:00',
          idleCount: 0,
        };
      }
      employeesMap[emp].taskCount++;
      employeesMap[emp].totalWeight += task.weight || 0;
      if (task.processType === '2021') {
        employeesMap[emp].tasks2021.push(task);
        if (task.sourceEO) {
          if (!employeesMap[emp].uniqueEO2021) {
            employeesMap[emp].uniqueEO2021 = new Set();
          }
          employeesMap[emp].uniqueEO2021.add(task.sourceEO);
        }
      } else if (task.processType === '2060') {
        employeesMap[emp].tasks2060.push(task);
        if (task.eo) {
          if (!employeesMap[emp].uniqueEO2060) {
            employeesMap[emp].uniqueEO2060 = new Set();
          }
          employeesMap[emp].uniqueEO2060.add(task.eo);
        }
      }
      if (task.time > employeesMap[emp].lastTime) {
        employeesMap[emp].lastTime = task.time;
      }
    });

    // Подсчитываем уникальные ЕО
    Object.values(employeesMap).forEach((emp: any) => {
      emp.uniqueEO2021Count = emp.uniqueEO2021?.size || 0;
      emp.uniqueEO2060Count = emp.uniqueEO2060?.size || 0;
    });

    // Сортируем по количеству задач
    const employees = Object.values(employeesMap).sort((a: any, b: any) => b.taskCount - a.taskCount);

    // Вычисляем топ-3 лидеров по количеству задач для кубков
    const topLeadersForScreenshot = employees
      .sort((a: any, b: any) => b.taskCount - a.taskCount)
      .slice(0, 3)
      .map((emp: any) => emp.employee);
    
    // Создаем заголовок таблицы с датой
    const tableHeader = document.createElement('thead');
    const headerRow = document.createElement('tr');
    // Добавляем заголовок с датой
    const dateHeader = document.createElement('th');
    dateHeader.colSpan = 11; // Увеличено на 1 для колонки №
    dateHeader.style.padding = '8px';
    dateHeader.style.backgroundColor = '#3b82f6';
    dateHeader.style.color = '#ffffff';
    dateHeader.style.fontWeight = 'bold';
    dateHeader.style.textAlign = 'center';
    dateHeader.style.fontSize = '14px';
    dateHeader.textContent = `📊 Отчет за ${dateStr} - Компания: ${company}`;
    headerRow.appendChild(dateHeader);
    const headerRow2 = document.createElement('tr');
    const headerTitles = ['№', 'Компания', 'Сотрудник', 'Последнее время', 'Задачи', 'КДК', 'ХР', 'Вес (кг)', 'ЕО КДК', 'ЕО ХР', 'Простои >10 мин'];
    headerTitles.forEach((title) => {
      const th = document.createElement('th');
      th.style.verticalAlign = 'middle';
      th.style.padding = '6px 8px';
      th.style.backgroundColor = '#3b82f6';
      th.style.color = '#ffffff';
      th.style.fontWeight = 'bold';
      th.style.textAlign = 'left';
      th.style.borderBottom = '1px solid #2563eb';
      th.style.borderRight = '1px solid #2563eb';
      th.style.fontSize = '12px';
      th.textContent = title;
      headerRow2.appendChild(th);
    });
    tableHeader.appendChild(headerRow);
    tableHeader.appendChild(headerRow2);

    // Создаем тело таблицы
    const tableBody = document.createElement('tbody');
    employees.forEach((emp: any, index: number) => {
      const row = document.createElement('tr');
      row.style.borderBottom = '1px solid #e5e7eb';

      // Определяем позицию в топ-3 для кубка
      const globalIndex = topLeadersForScreenshot.indexOf(emp.employee);
      const trophyPosition = globalIndex === 0 ? 'gold' : globalIndex === 1 ? 'silver' : globalIndex === 2 ? 'bronze' : null;
      const trophy = trophyPosition === 'gold' ? '🥇' : trophyPosition === 'silver' ? '🥈' : trophyPosition === 'bronze' ? '🥉' : '';
      const rowNumber = index + 1;

      // № (с кубком если топ-3)
      const cell0 = document.createElement('td');
      cell0.style.verticalAlign = 'middle';
      cell0.style.textAlign = 'center';
      cell0.style.padding = '6px 8px';
      cell0.style.borderBottom = '1px solid #e5e7eb';
      cell0.style.borderRight = '1px solid #e5e7eb';
      cell0.style.fontSize = '12px';
      cell0.style.position = 'relative';
      cell0.style.width = '100px';
      if (trophy) {
        cell0.innerHTML = `<span style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); z-index: 10; font-size: 20px;">${trophy}</span><span style="display: inline-block; padding: 2px 6px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; border-radius: 4px; font-size: 11px; font-weight: bold; border: 2px solid #60a5fa;">#${rowNumber}</span>`;
      } else {
        cell0.innerHTML = `<span style="display: inline-block; padding: 2px 6px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; border-radius: 4px; font-size: 11px; font-weight: bold; border: 2px solid #60a5fa;">#${rowNumber}</span>`;
      }
      row.appendChild(cell0);

      // Компания
      const cell1 = document.createElement('td');
      cell1.style.verticalAlign = 'middle';
      cell1.style.textAlign = 'center';
      cell1.style.padding = '6px 8px';
      cell1.style.borderBottom = '1px solid #e5e7eb';
      cell1.style.borderRight = '1px solid #e5e7eb';
      cell1.style.fontSize = '12px';
      cell1.innerHTML = `<span style="display: inline-block; padding: 2px 6px; background-color: #f3f4f6; color: #374151; border-radius: 4px; font-size: 11px;">${company}</span>`;
      row.appendChild(cell1);

      // Сотрудник
      const cell2 = document.createElement('td');
      cell2.style.verticalAlign = 'middle';
      cell2.style.padding = '6px 8px';
      cell2.style.borderBottom = '1px solid #e5e7eb';
      cell2.style.borderRight = '1px solid #e5e7eb';
      cell2.style.fontSize = '12px';
      cell2.style.fontWeight = 'bold';
      cell2.textContent = emp.employee;
      row.appendChild(cell2);

      // Последнее время
      const cell3 = document.createElement('td');
      cell3.style.verticalAlign = 'middle';
      cell3.style.padding = '6px 8px';
      cell3.style.borderBottom = '1px solid #e5e7eb';
      cell3.style.borderRight = '1px solid #e5e7eb';
      cell3.style.textAlign = 'left';
      cell3.style.fontSize = '12px';
      cell3.textContent = emp.lastTime;
      row.appendChild(cell3);

      // Задачи
      const cell4 = document.createElement('td');
      cell4.style.verticalAlign = 'middle';
      cell4.style.padding = '6px 8px';
      cell4.style.borderBottom = '1px solid #e5e7eb';
      cell4.style.borderRight = '1px solid #e5e7eb';
      cell4.style.textAlign = 'left';
      cell4.style.fontSize = '12px';
      cell4.textContent = emp.taskCount.toString();
      row.appendChild(cell4);

      // КДК
      const cell5 = document.createElement('td');
      cell5.style.verticalAlign = 'middle';
      cell5.style.textAlign = 'center';
      cell5.style.padding = '6px 8px';
      cell5.style.borderBottom = '1px solid #e5e7eb';
      cell5.style.borderRight = '1px solid #e5e7eb';
      cell5.style.fontSize = '12px';
      cell5.innerHTML = `<span style="display: inline-block; padding: 2px 6px; background-color: #dbeafe; color: #1e40af; border-radius: 4px; font-size: 11px; font-weight: bold;">${emp.tasks2021.length}</span>`;
      row.appendChild(cell5);

      // ХР
      const cell6 = document.createElement('td');
      cell6.style.verticalAlign = 'middle';
      cell6.style.textAlign = 'center';
      cell6.style.padding = '6px 8px';
      cell6.style.borderBottom = '1px solid #e5e7eb';
      cell6.style.borderRight = '1px solid #e5e7eb';
      cell6.style.fontSize = '12px';
      cell6.innerHTML = `<span style="display: inline-block; padding: 2px 6px; background-color: #fed7aa; color: #9a3412; border-radius: 4px; font-size: 11px; font-weight: bold;">${emp.tasks2060.length}</span>`;
      row.appendChild(cell6);

      // Вес
      const cell7 = document.createElement('td');
      cell7.style.verticalAlign = 'middle';
      cell7.style.padding = '6px 8px';
      cell7.style.borderBottom = '1px solid #e5e7eb';
      cell7.style.borderRight = '1px solid #e5e7eb';
      cell7.style.textAlign = 'left';
      cell7.style.fontSize = '12px';
      cell7.textContent = `${emp.totalWeight.toFixed(2)} кг`;
      row.appendChild(cell7);

      // ЕО КДК
      const cell8 = document.createElement('td');
      cell8.style.verticalAlign = 'middle';
      cell8.style.textAlign = 'center';
      cell8.style.padding = '6px 8px';
      cell8.style.borderBottom = '1px solid #e5e7eb';
      cell8.style.borderRight = '1px solid #e5e7eb';
      cell8.style.fontSize = '12px';
      cell8.innerHTML = `<span style="display: inline-block; padding: 2px 6px; background-color: #dbeafe; color: #1e40af; border-radius: 4px; font-size: 11px; font-weight: bold;">${emp.uniqueEO2021Count}</span>`;
      row.appendChild(cell8);

      // ЕО ХР
      const cell9 = document.createElement('td');
      cell9.style.verticalAlign = 'middle';
      cell9.style.textAlign = 'center';
      cell9.style.padding = '6px 8px';
      cell9.style.borderBottom = '1px solid #e5e7eb';
      cell9.style.borderRight = '1px solid #e5e7eb';
      cell9.style.fontSize = '12px';
      cell9.innerHTML = `<span style="display: inline-block; padding: 2px 6px; background-color: #fed7aa; color: #9a3412; border-radius: 4px; font-size: 11px; font-weight: bold;">${emp.uniqueEO2060Count}</span>`;
      row.appendChild(cell9);

      // Простои
      const cell10 = document.createElement('td');
      cell10.style.verticalAlign = 'middle';
      cell10.style.textAlign = 'center';
      cell10.style.padding = '6px 8px';
      cell10.style.borderBottom = '1px solid #e5e7eb';
      cell10.style.fontSize = '12px';
      cell10.textContent = emp.idleCount.toString();
      row.appendChild(cell10);

      tableBody.appendChild(row);
    });

    // Создаем таблицу
    const fullTable = document.createElement('table');
    fullTable.style.width = '100%';
    fullTable.style.borderCollapse = 'collapse';
    fullTable.style.borderSpacing = '0';
    fullTable.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)';
    fullTable.appendChild(tableHeader);
    fullTable.appendChild(tableBody);

    tempContainer.appendChild(fullTable);
    document.body.appendChild(tempContainer);

    // Делаем скриншот
    const canvas = await html2canvas(tempContainer, {
      backgroundColor: '#ffffff',
      scale: 2,
      logging: false,
      useCORS: true,
      width: tempContainer.offsetWidth,
      height: tempContainer.scrollHeight,
    });

    // Удаляем временный контейнер
    document.body.removeChild(tempContainer);

    // Конвертируем canvas в blob
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/png');
    });
  } catch (err) {
    console.error('Ошибка при создании скриншота:', err);
    return null;
  }
}


import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

// Конфигурация retry для разных типов запросов
const RETRY_CONFIG = {
  default: {
    retries: 3,
    retryDelay: 1000, // 1 секунда
    retryableStatuses: [502, 503, 504, 408, 429],
    retryableErrors: ['ECONNABORTED', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND']
  },
  analyz: {
    retries: 2,
    retryDelay: 2000, // 2 секунды для Analyz (может быть медленнее)
    retryableStatuses: [502, 503, 504],
    retryableErrors: ['ECONNABORTED', 'ETIMEDOUT', 'ECONNREFUSED']
  }
};

// Функция для определения, нужно ли повторять запрос
function shouldRetry(error: AxiosError, config: InternalAxiosRequestConfig): boolean {
  const retryConfig = config.url?.includes('/integrations/analyz') 
    ? RETRY_CONFIG.analyz 
    : RETRY_CONFIG.default;

  // Проверяем статус ответа
  if (error.response) {
    return retryConfig.retryableStatuses.includes(error.response.status);
  }

  // Проверяем код ошибки сети
  if (error.code && retryConfig.retryableErrors.includes(error.code)) {
    return true;
  }

  // Проверяем, есть ли у запроса флаг retry
  const retryCount = (config as any).__retryCount || 0;
  return retryCount < retryConfig.retries;
}

// Функция для задержки перед повтором
function getRetryDelay(retryCount: number, config: InternalAxiosRequestConfig): number {
  const retryConfig = config.url?.includes('/integrations/analyz') 
    ? RETRY_CONFIG.analyz 
    : RETRY_CONFIG.default;
  
  // Экспоненциальная задержка: 1s, 2s, 4s...
  return retryConfig.retryDelay * Math.pow(2, retryCount);
}

// Interceptor для обработки ошибок и retry
axios.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as InternalAxiosRequestConfig & { __retryCount?: number };

    // Если это не наш запрос или retry не нужен, возвращаем ошибку
    if (!config || !shouldRetry(error, config)) {
      return Promise.reject(error);
    }

    // Увеличиваем счетчик попыток
    config.__retryCount = (config.__retryCount || 0) + 1;
    const retryCount = config.__retryCount;

    const retryConfig = config.url?.includes('/integrations/analyz') 
      ? RETRY_CONFIG.analyz 
      : RETRY_CONFIG.default;

    // Если превышено количество попыток
    if (retryCount > retryConfig.retries) {
      console.error(`[Axios] Max retries (${retryConfig.retries}) exceeded for ${config.url}`);
      return Promise.reject(error);
    }

    // Задержка перед повтором
    const delay = getRetryDelay(retryCount - 1, config);
    console.log(`[Axios] Retrying request to ${config.url} (attempt ${retryCount}/${retryConfig.retries}) after ${delay}ms`);

    // Ждем перед повтором
    await new Promise(resolve => setTimeout(resolve, delay));

    // Повторяем запрос
    return axios(config);
  }
);

// Interceptor для логирования запросов (только в development)
if (import.meta.env.DEV) {
  axios.interceptors.request.use(
    (config) => {
      console.log(`[Axios Request] ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    },
    (error) => {
      console.error('[Axios Request Error]', error);
      return Promise.reject(error);
    }
  );
}

export default axios;


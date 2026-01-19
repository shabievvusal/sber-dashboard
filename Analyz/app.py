import os
import warnings
from datetime import timedelta, datetime
from typing import Dict, List, Optional, Tuple, Any
import threading
import time

from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from flask_cors import CORS
import pandas as pd
import json
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix
from modules.barcode_generator import barcode_bp

# Telegram Bot API
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "8467241470:AAHgY7NHZM9MDLu7we1xqqISOIxAH6jINGU")
# Список получателей Telegram (можно указать через переменную окружения через запятую)
_telegram_chat_ids_str = os.environ.get("TELEGRAM_CHAT_ID", "544569923,613051042")
TELEGRAM_CHAT_ID = [chat_id.strip() for chat_id in _telegram_chat_ids_str.split(",") if chat_id.strip()]

# Подавляем предупреждения pandas о создании атрибутов через setattr
warnings.filterwarnings('ignore', category=UserWarning, message='.*Pandas doesn\'t allow columns to be created via a new attribute name.*')


# -------------------------------
# Flask приложение
# -------------------------------
app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-key")

# CORS для прямого доступа из frontend (через nginx)
CORS(app, 
     origins=os.environ.get("CORS_ORIGINS", "*").split(","),
     supports_credentials=True,
     allow_headers=["Content-Type", "Authorization"],
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
# Ограничение размера загружаемого файла (по умолчанию 30 МБ для серверов с ограниченной памятью)
try:
    _max_mb = int(os.environ.get("MAX_UPLOAD_MB", "30"))
except Exception:
    _max_mb = 30
app.config["MAX_CONTENT_LENGTH"] = _max_mb * 1024 * 1024

# Ограничения для обработки файлов (настраиваются через переменные окружения)
MAX_FILE_SIZE_MB = int(os.environ.get("MAX_FILE_SIZE_MB", "30"))  # Максимальный размер файла: 30 МБ
MAX_ROWS = int(os.environ.get("MAX_ROWS", "85000"))  # Максимальное количество строк: 85,000
MAX_COLS = int(os.environ.get("MAX_COLS", "75"))  # Максимальное количество столбцов: 75

# Honor reverse-proxy headers (X-Forwarded-*) so url_for keeps mounted prefix
# x_prefix=1 позволяет использовать X-Forwarded-Prefix для определения базового пути
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

# Регистрируем Blueprint для генератора штрих-кодов
app.register_blueprint(barcode_bp)

# Пути для хранения файла сотрудников (утверждающий -> компания)
# В Docker используем /app/analyz-data, локально - относительный путь
_default_employees_path = os.path.join(os.path.dirname(__file__), "employees.csv")
_default_employees_xlsx_path = os.path.join(os.path.dirname(__file__), "employees.xlsx")
EMPLOYEES_FILE_PATH = os.environ.get("EMPLOYEES_FILE_PATH", _default_employees_path)
EMPLOYEES_XLSX_PATH = os.environ.get("EMPLOYEES_XLSX_PATH", _default_employees_xlsx_path)
# Если путь относительный, делаем его абсолютным
if not os.path.isabs(EMPLOYEES_FILE_PATH):
    EMPLOYEES_FILE_PATH = os.path.abspath(EMPLOYEES_FILE_PATH)
if not os.path.isabs(EMPLOYEES_XLSX_PATH):
    EMPLOYEES_XLSX_PATH = os.path.abspath(EMPLOYEES_XLSX_PATH)

# Кэш маппинга сотрудников по mtime
_EMPLOYEES_CACHE: Dict[str, object] = {
    "mtime": None,   # тип: Optional[float]
    "mapping": None, # тип: Optional[pd.DataFrame]
}

# Путь к накопительному файлу исходных строк (инкрементальные загрузки)
ACCUMULATED_FILE_PATH = os.path.join(os.path.dirname(__file__), "accumulated.csv")
# Дневные накопители
DATA_DIR = os.path.join(os.path.dirname(__file__), "data_days")
os.makedirs(DATA_DIR, exist_ok=True)

def _day_dir(date_str: str) -> str:
    safe = str(date_str).strip()
    return os.path.join(DATA_DIR, safe)

def _ensure_day_dir(date_str: str) -> None:
    try:
        os.makedirs(_day_dir(date_str), exist_ok=True)
    except Exception:
        pass

def _day_path(date_str: str) -> str:
    return os.path.join(_day_dir(date_str), f"{date_str}.csv")

def _day_summary_cache_path(date_str: str) -> str:
    return os.path.join(_day_dir(date_str), "IT.json")

def _day_analysis_cache_paths(date_str: str) -> Tuple[str, str, str]:
    """Пути кэш-файлов полного отчёта за день: CSV результатов и JSON для перерывов/по-часам."""
    base = _day_dir(date_str)
    csv_path = os.path.join(base, "ANL.csv")
    breaks_path = os.path.join(base, "ANL_breaks.json")
    hourly_path = os.path.join(base, "ANL_hourly.json")
    return csv_path, breaks_path, hourly_path

def _day_breaks_sum_cache_path(date_str: str) -> str:
    """Небольшой кэш: сумма перерывов (в секундах) по сотруднику за день."""
    base = _day_dir(date_str)
    return os.path.join(base, "ANL_breaks_sum.json")

def _day_faststat_cache_path(date_str: str) -> str:
    """Кэш для faststat: детальные данные по задачам за день в JSON формате."""
    base = _day_dir(date_str)
    return os.path.join(base, "FASTSTAT_DATA.json")

def _day_faststat_processing_flag(date_str: str) -> str:
    """Флаг обработки faststat: указывает, что обработка в процессе."""
    base = _day_dir(date_str)
    return os.path.join(base, "FASTSTAT_PROCESSING.flag")

def _duration_to_seconds(v: object) -> int:
    """Преобразует timedelta/строку 'HH:MM:SS' в секунды."""
    if v is None:
        return 0
    try:
        # timedelta
        if hasattr(v, "total_seconds"):
            return int(getattr(v, "total_seconds")())
    except Exception:
        pass
    try:
        td = pd.to_timedelta(str(v))
        return int(td.total_seconds())
    except Exception:
        return 0

def _format_hhmm_from_seconds(total_seconds: int) -> str:
    mins = max(0, int(round(total_seconds / 60)))
    hh = mins // 60
    mm = mins % 60
    return f"{hh:02d}:{mm:02d}"

def _load_day_df(date_str: str) -> Optional[pd.DataFrame]:
    """Читает CSV за день, если существует.
    
    Ограничивает размер данных для серверов с малой памятью.
    """
    os.makedirs(_day_dir(date_str), exist_ok=True)
    path = _day_path(date_str)
    if not os.path.exists(path):
        return None
    try:
        # Проверяем размер файла перед чтением
        file_size = os.path.getsize(path)
        # Для итогов нам важно прочитать файл даже если он немного превышает лимит,
        # поэтому при превышении выводим предупреждение и продолжаем.
        if file_size > MAX_FILE_SIZE_MB * 1024 * 1024:
            warnings.warn(
                f"Размер файла дня {date_str} = {file_size / 1024 / 1024:.1f} МБ превышает лимит {MAX_FILE_SIZE_MB} МБ. Чтение продолжается.",
                RuntimeWarning,
            )
        # Читаем с ограничением количества строк
        # Указываем na_values, чтобы pandas правильно обрабатывал "nan" как NaN
        df = pd.read_csv(
            path,
            dtype=str,
            nrows=MAX_ROWS,
            low_memory=True,
            engine="python",
            na_values=['nan', 'NaN', 'NAN', 'None', 'none', 'NULL', 'null', '']
        )
        if df is not None and not df.empty:
            # Дополнительная проверка размера
            if len(df) > MAX_ROWS:
                df = df.head(MAX_ROWS)  # Берем только первые MAX_ROWS строк
        return df
    except MemoryError:
        raise ValueError("Недостаточно памяти для загрузки данных за день. Очистите данные за этот день.")
    except Exception:
        return None


def _build_day_summary(
    date_str: str,
    company_name: Optional[str] = None,
    preloaded_df: Optional[pd.DataFrame] = None,
    write_cache: bool = True,
) -> Dict[str, object]:
    """Собирает краткую сводку дня и при необходимости кэширует в IT.json."""
    df = preloaded_df if preloaded_df is not None else _load_day_df(date_str)
    if df is None or df.empty:
        raise ValueError("no_data")

    approver_col, task_col, weight_col, qty_col, time_col, start_time_col, end_time_col, event_time_col = _match_columns(df)

    cols = [approver_col, task_col, weight_col]
    if start_time_col:
        cols.append(start_time_col)
    if end_time_col:
        cols.append(end_time_col)
    if event_time_col:
        cols.append(event_time_col)

    work = df[cols].copy()
    work.rename(columns={
        approver_col: "approver",
        task_col: "task",
        weight_col: "weight",
        **({start_time_col: "start_time"} if start_time_col else {}),
        **({end_time_col: "end_time"} if end_time_col else {}),
        **({event_time_col: "event_time"} if event_time_col else {}),
    }, inplace=True)

    work["weight"] = _to_weight_kg(work["weight"]).astype(float)
    if "start_time" in work.columns:
        work["start_dt"] = _parse_datetime(work["start_time"])
    if "end_time" in work.columns:
        work["end_dt"] = _parse_datetime(work["end_time"])
    if "event_time" in work.columns:
        work["event_dt"] = _parse_datetime(work["event_time"])

    confirm_as_dt = _parse_datetime(df[time_col]) if time_col in df.columns else None
    if confirm_as_dt is not None:
        if "end_dt" in work.columns:
            mask = work["end_dt"].isna() & confirm_as_dt.notna()
            work.loc[mask, "end_dt"] = confirm_as_dt[mask]
        else:
            work["end_dt"] = confirm_as_dt

    latest_dt = None
    for col in ["event_dt", "end_dt", "start_dt"]:
        if col in work.columns:
            cand = work[col].dropna().max()
            if pd.notna(cand):
                latest_dt = cand if latest_dt is None or cand > latest_dt else latest_dt

    aggr = analyze_dataframe(df)

    emp_df = None
    candidate_path = _get_employees_file_path()
    if candidate_path:
        try:
            emp_df = _try_read_employees(candidate_path)
        except Exception as e:
            app.logger.warning(f"Не удалось прочитать файл сотрудников {candidate_path}: {e}")
            emp_df = None
    if emp_df is not None:
        mapping = _extract_employees_mapping(emp_df)
        if mapping is not None and not mapping.empty:
            mapping["Утвердил"] = mapping["Утвердил"].astype(str).str.strip()
            mapping = mapping.dropna(subset=["Утвердил"]).drop_duplicates(subset=["Утвердил"], keep="first")
            aggr["Утвердил"] = aggr["Утвердил"].astype(str).str.strip()
            aggr = aggr.merge(mapping, on="Утвердил", how="left")

    if company_name and "Компания" in aggr.columns:
        aggr = aggr[aggr["Компания"].fillna("").astype(str).str.strip() == company_name.strip()]

    total_tasks = int(aggr["СЗ"].sum()) if "СЗ" in aggr.columns else 0
    total_weight = float(aggr["Вес"].sum()) if "Вес" in aggr.columns else 0.0

    def sum_by_company(name: str) -> int:
        if "Компания" not in aggr.columns:
            return 0
        return int(aggr.loc[aggr["Компания"].fillna("").astype(str).str.strip().str.lower() == name.strip().lower(), "СЗ"].sum() or 0)

    tasks_shtat = sum_by_company("Штат")
    tasks_moving = sum_by_company("Мувинг")
    tasks_gradusy = sum_by_company("Градус")
    tasks_two_wheels = sum_by_company("Два Колеса")
    tasks_no_company = int(aggr.loc[(aggr["Компания"].isna()) | (aggr["Компания"].fillna("").astype(str).str.strip() == ""), "СЗ"].sum() or 0) if "Компания" in aggr.columns else 0

    latest_time = None
    if latest_dt is not None and pd.notna(latest_dt):
        try:
            latest_time = latest_dt.strftime("%H:%M")
        except Exception:
            latest_time = None

    result = {
        "date": date_str,
        "total_tasks": total_tasks,
        "total_weight": round(total_weight, 2),
        "by_company": {
            "Штат": tasks_shtat,
            "Мувинг": tasks_moving,
            "Градус": tasks_gradusy,
            "Два Колеса": tasks_two_wheels,
            "без компании": tasks_no_company,
        },
        "latest_finish": latest_time,
    }

    if write_cache:
        try:
            _ensure_day_dir(date_str)
            _atomic_write_json(_day_summary_cache_path(date_str), result)
        except Exception:
            pass

    return result

def _append_to_day(date_str: str, new_df: pd.DataFrame) -> None:
    if new_df is None or new_df.empty:
        return
    # Ограничиваем размер добавляемых данных
    if len(new_df) > MAX_ROWS:
        raise ValueError(f"Слишком много строк для добавления ({len(new_df)}). Максимально допустимо: {MAX_ROWS} строк")
    # Ensure per-day directory exists before saving
    try:
        os.makedirs(_day_dir(date_str), exist_ok=True)
    except Exception:
        pass
    path = _day_path(date_str)
    mode = "a" if os.path.exists(path) else "w"
    header = (mode == "w")
    # Проверяем размер существующего файла перед добавлением
    if mode == "a" and os.path.exists(path):
        try:
            existing_df = pd.read_csv(path, nrows=1)  # Читаем только заголовок для проверки
            # Проверяем общий размер файла
            file_size = os.path.getsize(path)
            if file_size > MAX_FILE_SIZE_MB * 1024 * 1024:
                raise ValueError(f"Файл за день уже слишком большой ({file_size / 1024 / 1024:.1f} МБ). Очистите старые данные.")
        except Exception:
            pass  # Игнорируем ошибки проверки
    to_save = new_df.copy()
    for c in to_save.columns:
        to_save[c] = to_save[c].astype(str)
    to_save.to_csv(path, index=False, mode=mode, header=header, encoding="utf-8-sig")
    # Очищаем память
    del to_save
    # Инвалидация кэша итогов дня
    try:
        cache_path = _day_summary_cache_path(date_str)
        if os.path.exists(cache_path):
            os.remove(cache_path)
    except Exception:
        pass
    # Инвалидация кэша анализа дня
    try:
        csv_cache, br_cache, hr_cache = _day_analysis_cache_paths(date_str)
        for p in (csv_cache, br_cache, hr_cache):
            if os.path.exists(p):
                os.remove(p)
    except Exception:
        pass
    # Инвалидация кэша faststat
    try:
        faststat_cache = _day_faststat_cache_path(date_str)
        if os.path.exists(faststat_cache):
            os.remove(faststat_cache)
    except Exception:
        pass

# --------------------------------
# Вспомогательные сериализаторы/безопасная запись
# --------------------------------
def _stringify_record_for_json(rec: Dict[str, object]) -> Dict[str, str]:
    return {k: ("" if v is None else str(v)) for k, v in rec.items()}

def _serialize_breaks_map(breaks_map: Dict[str, List[Dict[str, object]]]) -> Dict[str, List[Dict[str, object]]]:
    out: Dict[str, List[Dict[str, object]]] = {}
    for approver, brs in (breaks_map or {}).items():
        ser_list: List[Dict[str, object]] = []
        for b in (brs or []):
            ser_list.append({
                "duration": str(b.get("duration")),
                "bucket": b.get("bucket"),
                "before": _stringify_record_for_json(b.get("before", {})),
                "after": _stringify_record_for_json(b.get("after", {})),
            })
        out[str(approver)] = ser_list
    return out

def _atomic_write_json(path: str, data: object) -> None:
    tmp_path = f"{path}.tmp"
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp_path, path)
def _load_accumulated_df() -> Optional[pd.DataFrame]:
    """Читает накопительный CSV, если существует.

    Возвращает pd.DataFrame или None, если файла нет или он пустой/битый.
    Ограничивает размер данных для серверов с малой памятью.
    """
    if not os.path.exists(ACCUMULATED_FILE_PATH):
        return None
    try:
        # Проверяем размер файла перед чтением
        file_size = os.path.getsize(ACCUMULATED_FILE_PATH)
        if file_size > MAX_FILE_SIZE_MB * 1024 * 1024:
            raise ValueError(f"Накопительный файл слишком большой ({file_size / 1024 / 1024:.1f} МБ). Очистите накопленные данные.")
        # Пытаемся робастно прочитать как сотрудников CSV (с разными разделителями/кодировками)
        # но без особых требований по колонкам
        # Ограничиваем количество строк при чтении
        df = pd.read_csv(
            ACCUMULATED_FILE_PATH,
            nrows=MAX_ROWS,
            low_memory=True,
            engine="python",
            dtype=str
        )
        if df is not None and not df.empty:
            # Дополнительная проверка размера
            if len(df) > MAX_ROWS:
                df = df.head(MAX_ROWS)  # Берем только первые MAX_ROWS строк
            return df
        return None
    except MemoryError:
        raise ValueError("Недостаточно памяти для загрузки накопленных данных. Очистите накопленные данные.")
    except Exception:
        return None

def _append_to_accumulated(new_df: pd.DataFrame) -> None:
    """Добавляет строки к накопительному CSV.

    Если файла нет — создаёт. Пишем в UTF-8 с BOM для совместимости.
    Ограничивает размер данных для серверов с малой памятью.
    """
    if new_df is None or new_df.empty:
        return
    # Ограничиваем размер добавляемых данных
    if len(new_df) > MAX_ROWS:
        raise ValueError(f"Слишком много строк для добавления ({len(new_df)}). Максимально допустимо: {MAX_ROWS} строк")
    mode = "a" if os.path.exists(ACCUMULATED_FILE_PATH) else "w"
    header = (mode == "w")
    # Проверяем размер существующего файла перед добавлением
    if mode == "a" and os.path.exists(ACCUMULATED_FILE_PATH):
        file_size = os.path.getsize(ACCUMULATED_FILE_PATH)
        if file_size > MAX_FILE_SIZE_MB * 1024 * 1024:
            raise ValueError(f"Накопительный файл уже слишком большой ({file_size / 1024 / 1024:.1f} МБ). Очистите накопленные данные.")
    # Приводим все к строкам для единообразия хранения
    to_save = new_df.copy()
    for c in to_save.columns:
        to_save[c] = to_save[c].astype(str)
    to_save.to_csv(ACCUMULATED_FILE_PATH, index=False, mode=mode, header=header, encoding="utf-8-sig")
    # Очищаем память
    del to_save


# -------------------------------
# Конфигурация и константы
# -------------------------------
# Возможные кодировки входных CSV
POSSIBLE_ENCODINGS: List[str] = [
	"utf-8",
	"utf-8-sig",
	"cp1251",
	"windows-1251",
	"cp866",
]

# Возможные разделители
POSSIBLE_SEPARATORS: List[str] = [",", ";", "\t", "|"]


def _normalize_column_name(name: str) -> str:
	"""Приводит имя столбца к унифицированному виду (для нестрогого сопоставления).

	- Нижний регистр
	- Удаление пробелов и двоеточий/точек/дефисов/подчеркиваний
	"""
	if not isinstance(name, str):
		return ""
	n = name.strip().lower()
	for ch in [":", ".", "-", "_", " ", "\u00A0"]:
		n = n.replace(ch, "")
	return n


def _candidate_columns() -> Dict[str, List[str]]:
	"""Словарь с вариациями названий столбцов.

	Ключи: логические имена полей.
	Значения: возможные варианты (нормализованные) названий столбцов во входных CSV.
	"""
	return {
		"approver": [
			"Утвердил:",
		],
		"task": [
			"Складская задача",
		],
		"weight": [
			"Вес груза",
		],
		"qty": [
			"ИсходЦелКолич в БЕИ",
		],
		"confirm_time": [
			"времяподтверждения",
			"время подтверждения",
			"подтвержденовремя",
			"длитработы",
			"вработевремя",
		],
		# Дополнительные временные столбцы для расчёта активного времени
		"start_time": [
			"временачала",
			"время начала",
			"начало",
			"датавремянч",
			"датаначала",
			"start",
			"starttime",
		],
		"end_time": [
			"времязавершения",
			"завершение",
			"датавремяокончания",
			"датаокончания",
			"end",
			"endtime",
		],
		"event_time": [
			"время",
			"датавремя",
			"подтверждено",
			"timestamp",
			"datetime",
		],
		# Для файла сотрудников
		"company": [
			"компания",
			"company",
		],
	}


def _match_columns(df: pd.DataFrame) -> Tuple[str, str, str, str, str, Optional[str], Optional[str], Optional[str]]:
	"""Пытается сопоставить реальные имена столбцов датафрейма с требуемыми полями.

	Возвращает кортеж: (approver_col, task_col, weight_col, qty_col, confirm_time_col, start_time_col, end_time_col, event_time_col)
	Выбрасывает ValueError, если какой-либо обязательный столбец не найден.
	"""
	candidates = _candidate_columns()
	# Отображение нормализованное имя -> оригинальное имя
	normalized_to_original: Dict[str, str] = {}
	for col in df.columns:
		normalized_to_original[_normalize_column_name(col)] = col

	resolved: Dict[str, Optional[str]] = {
		"approver": None,
		"task": None,
		"weight": None,
		"qty": None,
		"confirm_time": None,
		"start_time": None,
		"end_time": None,
		"event_time": None,
	}

	for logical_name, variants in candidates.items():
		for variant in variants:
			vn = _normalize_column_name(variant)
			if vn in normalized_to_original:
				resolved[logical_name] = normalized_to_original[vn]
				break

	# Требуемые колонки: approver, task, weight, qty, confirm_time
	required_keys = ["approver", "task", "weight", "qty", "confirm_time"]
	missing = [k for k in required_keys if resolved.get(k) is None]
	if missing:
		raise ValueError(
			"Не найдены обязательные столбцы: " + ", ".join(missing) +
			". Проверьте названия колонок."
		)

	return (
		resolved["approver"],
		resolved["task"],
		resolved["weight"],
		resolved["qty"],
		resolved["confirm_time"],
		resolved["start_time"],
		resolved["end_time"],
		resolved["event_time"],
	)


def _try_read_csv(file_storage) -> pd.DataFrame:
	"""Пытается прочитать CSV, перебирая кодировки и разделители.

	Также учитывает возможный разделитель десятичной части и тысячи через параметры pandas.
	"""
	last_err: Optional[Exception] = None
	# Проверяем размер файла перед чтением
	file_storage.seek(0, 2)  # Переходим в конец файла
	file_size = file_storage.tell()
	file_storage.seek(0)  # Возвращаемся в начало
	
	# Ограничение размера файла (настраивается через переменную окружения)
	max_file_size = MAX_FILE_SIZE_MB * 1024 * 1024
	if file_size > max_file_size:
		raise ValueError(f"Файл слишком большой ({file_size / 1024 / 1024:.1f} МБ). Максимальный размер: {MAX_FILE_SIZE_MB} МБ. Для сервера с ограниченной памятью рекомендуется разделить файл на части.")
	
	# Читаем байты один раз, потом повторно создаём буфер
	try:
		data = file_storage.read()
		if len(data) == 0:
			raise ValueError("Файл пуст")
	except MemoryError:
		raise ValueError(f"Недостаточно памяти для чтения файла. Размер файла: {file_size / 1024 / 1024:.1f} МБ")
	except Exception as e:
		raise ValueError(f"Ошибка при чтении файла: {e}")
	
	for enc in POSSIBLE_ENCODINGS:
		for sep in POSSIBLE_SEPARATORS:
			try:
				# Параметры для pandas (оптимизированы для малой памяти)
				read_params = {
					"filepath_or_buffer": pd.io.common.BytesIO(data),
					"encoding": enc,
					"sep": sep,
					"engine": "python",
					"dtype": str,  # читаем как строки, далее приведём типы вручную
					"low_memory": True,  # Используем меньше памяти (важно для серверов с 1GB RAM)
					"nrows": MAX_ROWS,  # Ограничиваем количество строк
				}
				# on_bad_lines доступен только в pandas 1.3+
				try:
					read_params["on_bad_lines"] = "skip"  # Пропускаем некорректные строки
				except TypeError:
					# Для старых версий pandas используем error_bad_lines
					try:
						read_params["error_bad_lines"] = False
					except TypeError:
						pass  # Если и это не поддерживается, просто пропускаем
				
				df = pd.read_csv(**read_params)
				if df.shape[1] == 1 and sep != ",":
					# Возможно, не сработал разделитель — пробуем стандартную запятую
					continue
				# Проверяем, что файл не пустой
				if df.empty:
					raise ValueError("Файл не содержит данных")
				# Проверяем минимальное количество столбцов
				if df.shape[1] < 3:
					raise ValueError(f"Файл содержит слишком мало столбцов ({df.shape[1]}). Ожидается минимум 3 столбца")
				# Проверяем максимальное количество столбцов
				if df.shape[1] > MAX_COLS:
					raise ValueError(f"Файл содержит слишком много столбцов ({df.shape[1]}). Максимально допустимо: {MAX_COLS} столбцов")
				# Проверяем максимальное количество строк
				if len(df) > MAX_ROWS:
					raise ValueError(f"Файл содержит слишком много строк ({len(df)}). Максимально допустимо: {MAX_ROWS} строк. Разделите файл на части.")
				# Очищаем память от исходных данных после успешного чтения
				del data
				return df
			except MemoryError:
				raise ValueError(f"Недостаточно памяти для обработки файла. Попробуйте уменьшить размер файла или разделить его на части.")
			except pd.errors.EmptyDataError:
				raise ValueError("Файл не содержит данных")
			except Exception as e:
				last_err = e
	# Если не удалось прочитать
	raise ValueError(f"Не удалось прочитать CSV: {last_err}")


def _try_read_xlsx(file_storage) -> pd.DataFrame:
	"""Пытается прочитать XLSX файл.

	Читает первый лист Excel файла.
	"""
	# Проверяем размер файла перед чтением
	file_storage.seek(0, 2)  # Переходим в конец файла
	file_size = file_storage.tell()
	file_storage.seek(0)  # Возвращаемся в начало
	
	# Ограничение размера файла (настраивается через переменную окружения)
	max_file_size = MAX_FILE_SIZE_MB * 1024 * 1024
	if file_size > max_file_size:
		raise ValueError(f"Файл слишком большой ({file_size / 1024 / 1024:.1f} МБ). Максимальный размер: {MAX_FILE_SIZE_MB} МБ. Для сервера с ограниченной памятью рекомендуется разделить файл на части.")
	
	try:
		# Читаем байты и создаём буфер
		data = file_storage.read()
		if len(data) == 0:
			raise ValueError("Файл пуст")
	except MemoryError:
		raise ValueError(f"Недостаточно памяти для чтения файла. Размер файла: {file_size / 1024 / 1024:.1f} МБ")
	except Exception as e:
		raise ValueError(f"Ошибка при чтении файла: {e}")
	
	try:
		df = pd.read_excel(
			pd.io.common.BytesIO(data),
			engine="openpyxl",
			dtype=str,  # читаем как строки, далее приведём типы вручную
			nrows=MAX_ROWS,  # Ограничиваем количество строк
		)
		# Проверяем, что файл не пустой
		if df.empty:
			raise ValueError("Файл не содержит данных")
		# Проверяем минимальное количество столбцов
		if df.shape[1] < 3:
			raise ValueError(f"Файл содержит слишком мало столбцов ({df.shape[1]}). Ожидается минимум 3 столбца")
		# Проверяем максимальное количество столбцов
		if df.shape[1] > MAX_COLS:
			raise ValueError(f"Файл содержит слишком много столбцов ({df.shape[1]}). Максимально допустимо: {MAX_COLS} столбцов")
		# Проверяем максимальное количество строк
		if len(df) > MAX_ROWS:
			raise ValueError(f"Файл содержит слишком много строк ({len(df)}). Максимально допустимо: {MAX_ROWS} строк. Разделите файл на части.")
		# Очищаем память от исходных данных после успешного чтения
		del data
		return df
	except MemoryError:
		raise ValueError(f"Недостаточно памяти для обработки файла. Попробуйте уменьшить размер файла или разделить его на части.")
	except pd.errors.EmptyDataError:
		raise ValueError("Файл не содержит данных")
	except Exception as e:
		raise ValueError(f"Не удалось прочитать XLSX: {e}")


def _try_read_file(file_storage) -> pd.DataFrame:
	"""Универсальная функция для чтения файлов CSV и XLSX.

	Определяет тип файла по расширению и вызывает соответствующую функцию чтения.
	"""
	filename = file_storage.filename.lower()
	
	if filename.endswith('.xlsx') or filename.endswith('.xls'):
		return _try_read_xlsx(file_storage)
	elif filename.endswith('.csv'):
		return _try_read_csv(file_storage)
	else:
		raise ValueError(f"Неподдерживаемый формат файла: {filename}. Поддерживаются только CSV и XLSX файлы.")


def _try_read_employees_csv(path: str) -> pd.DataFrame:
	"""Робастное чтение файла сотрудников с разными разделителями/кодировками.

	- Пробуем engine="python" и on_bad_lines="skip" для устойчивости
	- Пробуем sep=None (sniff), затем стандартные разделители
	"""
	last_err: Optional[Exception] = None
	for enc in POSSIBLE_ENCODINGS:
		# Сначала пробуем авто-определение разделителя
		try:
			df = pd.read_csv(
				path,
				encoding=enc,
				engine="python",
				sep=None,
				dtype=str,
				on_bad_lines="skip",
				skipinitialspace=True,
			)
			return df
		except Exception as e:
			last_err = e
		for sep in POSSIBLE_SEPARATORS:
			try:
				df = pd.read_csv(
					path,
					encoding=enc,
					engine="python",
					sep=sep,
					dtype=str,
					on_bad_lines="skip",
					skipinitialspace=True,
				)
				return df
			except Exception as e:
				last_err = e
	raise ValueError(f"Не удалось прочитать файл сотрудников: {last_err}")


def _get_employees_file_path() -> Optional[str]:
    """Безопасно получает путь к файлу сотрудников, исключая директории."""
    if os.path.exists(EMPLOYEES_XLSX_PATH) and not os.path.isdir(EMPLOYEES_XLSX_PATH):
        return EMPLOYEES_XLSX_PATH
    elif os.path.exists(EMPLOYEES_FILE_PATH) and not os.path.isdir(EMPLOYEES_FILE_PATH):
        return EMPLOYEES_FILE_PATH
    return None

def _try_read_employees(path: str) -> pd.DataFrame:
    """Читает файл сотрудников как CSV или Excel по расширению."""
    # Проверяем, что путь не является директорией
    if os.path.exists(path) and os.path.isdir(path):
        raise ValueError(f"Путь к файлу сотрудников является директорией, а не файлом: {path}")
    
    ext = os.path.splitext(path)[1].lower()
    if ext in {".xlsx", ".xls"}:
        # Excel: читаем как есть, все в строки
        df = pd.read_excel(path, dtype=str)
        return df
    # По умолчанию читаем как CSV
    return _try_read_employees_csv(path)


def _extract_employees_mapping(emp_df: pd.DataFrame) -> Optional[pd.DataFrame]:
	"""Извлекает маппинг Утвердил -> Компания (+ Занятость, если есть) из датафрейма.

	Пытается найти столбцы по нормализованным названиям. Если явного столбца
	занятости нет, но в файле >= 4 колонок, берём 4-ю как "Занятость".
	Возвращает датафрейм как минимум с колонками ["Утвердил", "Компания"],
	а при наличии – добавляет колонку "Занятость".
	"""
	if emp_df is None or emp_df.empty:
		return None
	# Карта нормализованных имён к оригиналу
	norm_to_orig: Dict[str, str] = {}
	for col in emp_df.columns:
		norm_to_orig[_normalize_column_name(col)] = col
	approver_col = None
	company_col = None
	assignment_col = None
	# Варианты названий
	for variant in ["утвердил", "утвердил:", "approver", "сотрудник", "фио", "логин"]:
		vn = _normalize_column_name(variant)
		if vn in norm_to_orig:
			approver_col = norm_to_orig[vn]
			break
	for variant in ["компания", "company", "фирма", "организация"]:
		vn = _normalize_column_name(variant)
		if vn in norm_to_orig:
			company_col = norm_to_orig[vn]
			break
	# Ищем колонку занятости по названию
	for variant in ["занятость", "операция", "assignment", "operation", "закрепление"]:
		vn = _normalize_column_name(variant)
		if vn in norm_to_orig:
			assignment_col = norm_to_orig[vn]
			break
	if approver_col is None:
		# Если нет явного столбца, но первая колонка выглядит как Утвердил - используем её
		approver_col = emp_df.columns[0]
	if company_col is None and len(emp_df.columns) > 1:
		company_col = emp_df.columns[1]
	if approver_col is None or company_col is None:
		return None
	cols = [approver_col, company_col]
	# Если явной колонки занятости нет, но есть хотя бы 4 столбца – берём 4-й
	if assignment_col is None and len(emp_df.columns) >= 4:
		assignment_col = emp_df.columns[3]
		if assignment_col in cols:
			assignment_col = None
	if assignment_col is not None:
		cols.append(assignment_col)

	res = emp_df[cols].copy()
	# Переименовываем базовые колонки
	out_cols = ["Утвердил", "Компания"] + (["Занятость"] if assignment_col is not None else [])
	res.columns = out_cols
	return res


def _parse_timedelta(value: str) -> timedelta:
	"""Парсер времени подтверждения в timedelta.

	Поддерживаемые форматы:
	- HH:MM:SS (или H:MM:SS)
	- MM:SS
	- Число секунд (целое или с плавающей точкой)
	- Число миллисекунд (если очень большие значения)
	"""
	if value is None:
		return timedelta(0)
	s = str(value).strip()
	if not s:
		return timedelta(0)
	# Формат с двоеточиями
	if ":" in s:
		parts = s.split(":")
		try:
			if len(parts) == 3:
				h, m, sec = parts
				return timedelta(hours=float(h), minutes=float(m), seconds=float(sec))
			elif len(parts) == 2:
				m, sec = parts
				return timedelta(minutes=float(m), seconds=float(sec))
		except Exception:
			return timedelta(0)
	# Числовые форматы
	try:
		num = float(s.replace(",", "."))
		# Эвристика: если значение выглядит очень большим — считаем, что это миллисекунды
		if num > 24 * 3600 * 10:  # больше 10 суток в секундах
			return timedelta(milliseconds=num)
		return timedelta(seconds=num)
	except Exception:
		return timedelta(0)


def _format_timedelta(td: timedelta) -> str:
	"""Форматирует timedelta в строку ЧЧ:ММ."""
	if td.total_seconds() < 0:
		return "00:00"
	seconds = int(td.total_seconds())
	hours = seconds // 3600
	minutes = (seconds % 3600) // 60
	return f"{hours:02d}:{minutes:02d}"


def _to_python_timedelta(value: object) -> timedelta:
    """Преобразует pandas/NumPy timedelta в стандартный Python timedelta."""
    if isinstance(value, timedelta):
        return value
    try:
        td = pd.Timedelta(value)
        # Для NaT возвращаем 0
        if pd.isna(td):
            return timedelta(0)
        return td.to_pytimedelta()
    except Exception:
        return timedelta(0)


def _to_float(series: pd.Series) -> pd.Series:
	"""Приведение числовых столбцов с учётом тысячных разделителей и разных форматов.

	Стратегия:
	- удаляем пробелы и NBSP
	- если есть и точка, и запятая -> считаем, что точка = тысячи, запятая = десятичная
	- если много точек -> точки = тысячи
	- если одна запятая и хвост после неё = 3 цифры -> запятая = тысячи
	- иначе запятую считаем десятичной
	"""

	def _normalize_num(s: str) -> Optional[float]:
		if s is None:
			return None
		st = str(s).strip()
		if st == "" or st.lower() in {"nan", "none"}:
			return None
		st = st.replace("\u00A0", "").replace(" ", "").replace("'", "")
		if "," in st and "." in st:
			# смешанный формат -> убираем точки как тысячи, запятую -> точку
			st = st.replace(".", "")
			st = st.replace(",", ".")
		elif st.count(".") > 1:
			# много точек -> считаем точки тысячами
			st = st.replace(".", "")
		elif "," in st and "." not in st:
			parts = st.split(",")
			if len(parts) == 2 and len(parts[1]) == 3 and parts[1].isdigit():
				# 1,234 -> тысячный разделитель
				st = parts[0] + parts[1]
			else:
				# десятичная запятая
				st = st.replace(",", ".")
		try:
			return float(st)
		except Exception:
			return None

	result = series.apply(_normalize_num)
	return result.infer_objects(copy=False).fillna(0.0)


def _to_weight_kg(series: pd.Series) -> pd.Series:
	"""Специальный парсер веса в КГ.

	Для веса требуется всегда трактовать запятую как десятичный разделитель,
	даже если после запятой ровно 3 цифры (пример: 2,304 -> 2.304 кг).

	Также удаляем пробелы/неразрывные пробелы и апострофы, точки трактуем
	как разделители тысяч (удаляем), если они встречаются.
	"""

	def _normalize_weight(s: str) -> Optional[float]:
		if s is None:
			return None
		st = str(s).strip()
		if st == "" or st.lower() in {"nan", "none"}:
			return None
		# Удаляем пробелы, NBSP, апострофы
		st = st.replace("\u00A0", "").replace(" ", "").replace("'", "")
		# Если присутствуют обе точки и запятые, считаем точки тысячами
		if "," in st and "." in st:
			st = st.replace(".", "")
		# Для веса всегда считаем запятую десятичной
		st = st.replace(",", ".")
		try:
			return float(st)
		except Exception:
			return None

	result = series.apply(_normalize_weight)
	return result.infer_objects(copy=False).fillna(0.0)


def _parse_datetime(series: pd.Series) -> pd.Series:
	"""Приведение серии со временем к datetime (naive, локальное время)."""
	# Пытаемся определить формат автоматически, если не получается - используем dateutil
	try:
		# Пробуем стандартные форматы
		formats = ['%d.%m.%Y %H:%M:%S', '%d/%m/%Y %H:%M:%S', '%Y-%m-%d %H:%M:%S', '%d.%m.%Y', '%Y-%m-%d']
		for fmt in formats:
			try:
				result = pd.to_datetime(series, format=fmt, errors="coerce", dayfirst=True, utc=False)
				if result.notna().sum() > len(series) * 0.8:  # Если большинство дат распарсилось
					return result
			except:
				continue
		# Если не подошел ни один формат, используем dateutil (подавляем предупреждение)
		with warnings.catch_warnings():
			warnings.filterwarnings('ignore', message='.*Could not infer format.*')
			return pd.to_datetime(series, errors="coerce", dayfirst=True, utc=False)
	except:
		# Подавляем предупреждение при использовании dateutil в fallback
		with warnings.catch_warnings():
			warnings.filterwarnings('ignore', message='.*Could not infer format.*')
			return pd.to_datetime(series, errors="coerce", dayfirst=True, utc=False)


def _compute_active_time_per_approver(df: pd.DataFrame) -> pd.Series:
    """Считает активное время по подтверждениям: сумма min(интервал, 15 минут) между первым и последним.

    Используются подтверждения как datetime: приоритет `confirm_dt`, затем `end_dt`, затем `event_dt`.
    """
    max_gap = timedelta(minutes=15)
    results: Dict[str, timedelta] = {}
    for approver, grp in df.groupby("approver", dropna=False):
        if "confirm_dt" in grp.columns:
            times = grp["confirm_dt"].dropna().sort_values().tolist()
        elif "end_dt" in grp.columns:
            times = grp["end_dt"].dropna().sort_values().tolist()
        elif "event_dt" in grp.columns:
            times = grp["event_dt"].dropna().sort_values().tolist()
        else:
            results[approver] = timedelta(0)
            continue
        if len(times) < 2:
            results[approver] = timedelta(0)
            continue
        total = timedelta(0)
        prev = times[0]
        for cur in times[1:]:
            gap = cur - prev
            if isinstance(gap, pd.Timedelta):
                gap_td = gap.to_pytimedelta()
            else:
                gap_td = gap if isinstance(gap, timedelta) else timedelta(0)
            if gap_td > timedelta(0):
                total += min(gap_td, max_gap)
            prev = cur
        results[approver] = total
    return pd.Series(results)


def _compute_breaks_and_active_time(df: pd.DataFrame) -> Tuple[pd.Series, Dict[str, List[Dict[str, object]]]]:
    """Векторизованный расчёт активного времени и перерывов >10 минут по сотруднику.

    Возвращает Series approver->Timedelta и подробные перерывы для отображения.
    Приоритет времени: event_dt, затем end_dt, затем start_dt.
    """
    min_break = pd.Timedelta(minutes=10)

    # Единая временная метка
    primary_dt = None
    if "event_dt" in df.columns:
        primary_dt = df["event_dt"].copy()
    if "end_dt" in df.columns:
        primary_dt = primary_dt.fillna(df["end_dt"]) if primary_dt is not None else df["end_dt"].copy()
    if "start_dt" in df.columns:
        primary_dt = primary_dt.fillna(df["start_dt"]) if primary_dt is not None else df["start_dt"].copy()

    if primary_dt is None:
        # Нет валидных временных меток
        empty = pd.Series(dtype="timedelta64[ns]")
        return empty, {}

    tmp = pd.DataFrame({
        "approver": df["approver"],
        "t": primary_dt,
    })
    tmp = tmp.dropna(subset=["t"])  # оставляем только строки с временем
    if tmp.empty:
        empty = pd.Series(dtype="timedelta64[ns]")
        return empty, {}

    # Сортировка по сотруднику и времени
    tmp = tmp.sort_values(["approver", "t"])  # сохраняет исходные индексы

    # Разницы между соседними событиями внутри сотрудника
    gap = tmp.groupby("approver")["t"].diff()
    long_gaps = gap.where(gap > min_break).fillna(pd.Timedelta(0))

    # Окно работы: последняя - первая по сотруднику
    first_t = tmp.groupby("approver")["t"].transform("first")
    last_t = tmp.groupby("approver")["t"].transform("last")
    window = (last_t - first_t)

    # Сумма длинных перерывов по сотруднику
    sum_long_gaps = long_gaps.groupby(tmp["approver"]).sum()

    # Активное время
    window_by_approver = (tmp.groupby("approver")["t"].last() - tmp.groupby("approver")["t"].first())
    active_td = (window_by_approver - sum_long_gaps).clip(lower=pd.Timedelta(0))

    # Формирование подробного списка перерывов для UI (точечно по точкам, где gap>10)
    breaks_by_approver: Dict[str, List[Dict[str, object]]] = {}
    # Подготовим быстрый доступ к исходным строкам
    df_local = df
    idx_series = tmp.index
    approver_vals = tmp["approver"].to_numpy()
    t_vals = tmp["t"].to_numpy()
    gap_vals = gap.to_numpy()
    for i in range(1, len(tmp)):
        g = gap_vals[i]
        if pd.isna(g) or g <= min_break:
            continue
        appr = approver_vals[i]
        before_idx = idx_series[i - 1]
        after_idx = idx_series[i]
        # Категория корзины
        if g >= pd.Timedelta(minutes=45):
            bucket = 45
        elif g >= pd.Timedelta(minutes=30):
            bucket = 30
        elif g >= pd.Timedelta(minutes=15):
            bucket = 15
        else:
            bucket = 0
        lst = breaks_by_approver.setdefault(appr, [])
        lst.append({
            "duration": _to_python_timedelta(g),
            "bucket": bucket,
            "before": df_local.loc[before_idx].to_dict() if before_idx in df_local.index else {},
            "after": df_local.loc[after_idx].to_dict() if after_idx in df_local.index else {},
        })

    return active_td, breaks_by_approver


def analyze_dataframe(df: pd.DataFrame) -> pd.DataFrame:
	"""Основная логика анализа данных.

	Возвращает агрегированный датафрейм со столбцами:
	- approver (Утвердил)
	- tasks_count (Количество уникальных СЗ)
	- weight_sum (Сумма веса)
	- qty_sum (Сумма штук)
	- speed (скорость = СЗ / часы_работы)
	- total_time (timedelta, общее время работы)
	"""
	# Проверка на пустой DataFrame
	if df is None or df.empty:
		raise ValueError("DataFrame пуст или не определен")
	
	# Проверка размера данных
	if len(df) > MAX_ROWS:
		raise ValueError(f"Файл содержит слишком много строк ({len(df)}). Максимально допустимо: {MAX_ROWS} строк. Разделите файл на части.")
	
	# Проверка количества столбцов
	if df.shape[1] > MAX_COLS:
		raise ValueError(f"Файл содержит слишком много столбцов ({df.shape[1]}). Максимально допустимо: {MAX_COLS} столбцов")
	
	try:
		approver_col, task_col, weight_col, qty_col, time_col, start_time_col, end_time_col, event_time_col = _match_columns(df)
	except ValueError as ve:
		raise ValueError(f"Ошибка при сопоставлении столбцов: {str(ve)}")

	# Разрешаем конфликт дублирующихся колонок "Вес груза" (число vs единица измерения)
	# Ищем все колонки с таким же нормализованным именем и выбираем ту, где значения выглядят числовыми
	n_weight_key = _normalize_column_name("Вес груза")
	weight_candidates = [col for col in df.columns if _normalize_column_name(col) == n_weight_key]
	if len(weight_candidates) > 1:
		best_col = None
		best_score = -1
		for col in weight_candidates:
			series = df[col].astype(str)
			parsed = _to_weight_kg(series)
			# Оцениваем как число тех строк, которые успешно распарсились > 0
			score = (parsed > 0).sum()
			if score > best_score:
				best_score = score
				best_col = col
		if best_col is not None:
			weight_col = best_col

	# Копируем только необходимые столбцы
	cols = [approver_col, task_col, weight_col, qty_col, time_col]
	if start_time_col is not None:
		cols.append(start_time_col)
	if end_time_col is not None:
		cols.append(end_time_col)
	if event_time_col is not None:
		cols.append(event_time_col)
	work_df = df[cols].copy()
	work_df.rename(columns={
		approver_col: "approver",
		task_col: "task",
		weight_col: "weight",
		qty_col: "qty",
		time_col: "confirm_time",
		**({start_time_col: "start_time"} if start_time_col else {}),
		**({end_time_col: "end_time"} if end_time_col else {}),
		**({event_time_col: "event_time"} if event_time_col else {}),
	}, inplace=True)

	# Фильтрация строк-итогов (Итого/Итог/Всего), чтобы не удваивать суммы
	def _looks_like_total(value: object) -> bool:
		if value is None:
			return False
		s = str(value).strip().lower()
		if not s:
			return False
		# Проверяем ключевые слова в начале ячейки
		return s.startswith("итого") or s.startswith("итог") or s.startswith("всего")

	# Считаем строку итоговой, если в колонках 'approver' или 'task' встречается маркер
	mask_total = work_df[[c for c in ["approver", "task"] if c in work_df.columns]] \
		.map(_looks_like_total).any(axis=1)
	if mask_total.any():
		work_df = work_df.loc[~mask_total].copy()

	# Доп. фильтрация итоговых строк по структуре: присутствует только вес, остальные поля пустые
	def _is_blank(v: object) -> bool:
		if v is None:
			return True
		s = str(v).strip().lower()
		return s == "" or s == "nan" or s == "none"

	non_weight_cols = [c for c in ["approver", "task", "qty", "confirm_time", "start_time", "end_time", "event_time"] if c in work_df.columns]
	if non_weight_cols:
		# weight заполнен (не пустая строка), а все остальные пусты
		weight_filled = ~work_df["weight"].apply(_is_blank)
		others_blank = work_df[non_weight_cols].map(_is_blank).all(axis=1)
		mask_weight_only = weight_filled & others_blank
		if mask_weight_only.any():
			work_df = work_df.loc[~mask_weight_only].copy()

	# Приведение типов
	work_df["weight"] = _to_weight_kg(work_df["weight"]).astype(float)
	work_df["qty"] = _to_float(work_df["qty"]).astype(float)
	work_df["confirm_td"] = work_df["confirm_time"].apply(_parse_timedelta)
	# Преобразуем временные метки если есть
	if "start_time" in work_df.columns:
		work_df["start_dt"] = _parse_datetime(work_df["start_time"])
	if "end_time" in work_df.columns:
		work_df["end_dt"] = _parse_datetime(work_df["end_time"])
	if "event_time" in work_df.columns:
		work_df["event_dt"] = _parse_datetime(work_df["event_time"])

	# Если колонка подтверждения содержит дату/время (конец), используем её как end_dt
	confirm_as_dt = _parse_datetime(work_df["confirm_time"]) if "confirm_time" in work_df.columns else None
	if confirm_as_dt is not None:
		if "end_dt" in work_df.columns:
			# Заполняем только там, где end_dt отсутствует
			mask = work_df["end_dt"].isna() & confirm_as_dt.notna()
			work_df.loc[mask, "end_dt"] = confirm_as_dt[mask]
		else:
			work_df["end_dt"] = confirm_as_dt

	# Пересчёт confirm_td: если есть пара start_dt/end_dt, то длительность = разница
	if "start_dt" in work_df.columns and "end_dt" in work_df.columns:
		delta = (work_df["end_dt"] - work_df["start_dt"]).where(~(work_df["end_dt"].isna() | work_df["start_dt"].isna()))
		# Где delta валидна, используем её; иначе оставляем ранее распарсенную confirm_td
		work_df["confirm_td"] = work_df["confirm_td"].where(delta.isna(), other=delta.dt.to_pytimedelta())

	# Устранение дублей задач при повторных/расширенных выгрузках.
	# Логика: одна и та же складская задача для одного "Утвердил" должна учитываться один раз
	# (по последней известной записи), чтобы вес/шт не суммировались при загрузке нескольких выгрузок за день.
	if "approver" in work_df.columns and "task" in work_df.columns:
		# Сортируем так, чтобы "последняя" запись (по времени завершения / событию / началу) шла последней
		sort_cols = ["approver", "task"]
		time_priority = [c for c in ["end_dt", "event_dt", "start_dt"] if c in work_df.columns]
		sort_cols.extend(time_priority)
		work_df = work_df.sort_values(sort_cols)
		# Оставляем по одной записи на пару (approver, task) — последнюю по времени
		work_df = work_df.drop_duplicates(subset=["approver", "task"], keep="last")

	# Агрегации по сотруднику
	grouped = work_df.groupby("approver", dropna=False).agg({
		"task": pd.Series.nunique,  # уникальные СЗ
		"weight": "sum",
		"qty": "sum",
		"confirm_td": "sum",
	}).reset_index()

	# Новая логика (векторная): активное время = (последнее - первое) - сумма перерывов >10 минут
	active_time_map, breaks_by_approver = _compute_breaks_and_active_time(work_df)
	grouped = grouped.merge(active_time_map.rename("active_td"), left_on="approver", right_index=True, how="left")

	# Подсчёт количества перерывов по корзинам 15/30/45 минут
	def _count_bucket(approver: str, bucket: int) -> int:
		brs = breaks_by_approver.get(approver, [])
		return sum(1 for b in brs if b.get("bucket") == bucket)

	grouped["b15"] = grouped["approver"].apply(lambda a: _count_bucket(a, 15))
	grouped["b30"] = grouped["approver"].apply(lambda a: _count_bucket(a, 30))
	grouped["b45"] = grouped["approver"].apply(lambda a: _count_bucket(a, 45))

	grouped.rename(columns={
		"approver": "Утвердил",
		"task": "СЗ",
		"weight": "Вес",
		"qty": "Шт",
		"confirm_td": "Сумма длительностей (td)",
	}, inplace=True)

	# Векторная скорость: СЗ / минуты активной работы
	minutes = grouped["active_td"].dt.total_seconds().div(60)
	minutes = minutes.replace(0, pd.NA)
	speed = (grouped["СЗ"] / minutes)
	grouped["скорость"] = speed.infer_objects(copy=False).fillna(0.0)
	grouped["Время"] = grouped["active_td"].apply(lambda v: _format_timedelta(_to_python_timedelta(v)))

	# Округление и сортировка
	grouped["Вес"] = grouped["Вес"].round(2)
	grouped["Шт"] = grouped["Шт"].round(0).astype(int)
	grouped["скорость"] = grouped["скорость"].round(2)

	# Сортируем по СЗ убыванию
	grouped.sort_values(by=["СЗ", "скорость"], ascending=[False, False], inplace=True)

	# Финальные столбцы в нужном порядке
	final_df = grouped[[
		"Утвердил",
		"СЗ",
		"Вес",
		"Шт",
		"скорость",
		"Время",
		"b15",
		"b30",
		"b45",
	]].reset_index(drop=True)

	# Прикладываем карту перерывов как атрибут для последующей передачи в шаблон
	# Используем setattr для избежания предупреждения pandas
	setattr(final_df, 'breaks_by_approver', breaks_by_approver)

	# Подсчёт количества задач по часам (09..20) на основе первого доступного времени
	hours = list(range(9, 21))
	hourly_counts: Dict[str, Dict[int, int]] = {}

	def _extract_hour_from_text(value: object) -> Optional[int]:
		if value is None:
			return None
		s = str(value)
		# Ищем шаблон HH:MM
		if ":" in s:
			parts = s.split(":")
			try:
				h = int(parts[0].strip())
				return h if 0 <= h <= 23 else None
			except Exception:
				return None
		return None

	for r in work_df.itertuples(index=False):
		# Достаём время подтверждения задачи
		hour_val: Optional[int] = None
		# Предпочитаем event_dt, затем end_dt, затем start_dt
		if hasattr(r, "event_dt") and getattr(r, "event_dt") is not None:
			try:
				hour_val = int(getattr(r, "event_dt").hour)
			except Exception:
				hour_val = None
		elif hasattr(r, "end_dt") and getattr(r, "end_dt") is not None:
			try:
				hour_val = int(getattr(r, "end_dt").hour)
			except Exception:
				hour_val = None
		elif hasattr(r, "start_dt") and getattr(r, "start_dt") is not None:
			try:
				hour_val = int(getattr(r, "start_dt").hour)
			except Exception:
				hour_val = None
		# Фоллбек: парсим из текстового confirm_time вида HH:MM
		if hour_val is None and hasattr(r, "confirm_time"):
			hour_val = _extract_hour_from_text(getattr(r, "confirm_time"))

		if hour_val is None or hour_val not in hours:
			continue

		approver_raw = getattr(r, "approver", "")
		approver = str(approver_raw).strip()
		if approver not in hourly_counts:
			hourly_counts[approver] = {hh: 0 for hh in hours}
		hourly_counts[approver][hour_val] += 1

	# Используем setattr для избежания предупреждения pandas
	setattr(final_df, 'hourly_by_approver', hourly_counts)
	return final_df


# -------------------------------
# Маршруты Flask
# -------------------------------
@app.route("/", methods=["GET"]) 
def index():
	"""Стартовая страница с формой загрузки файлов."""
	current_date = datetime.now().strftime("%Y-%m-%d")
	return render_template("index.html", current_date=current_date)


@app.route("/favicon.ico")
def favicon():
	"""Обработка favicon."""
	from flask import send_from_directory
	return send_from_directory(".", "favicon.ico", mimetype="image/vnd.microsoft.icon")


@app.route("/detect_work_date", methods=["POST"])
def detect_work_date():
	"""Определяет дату работы по пикам в столбце 'дата подтверждения' из загруженных файлов."""
	try:
		files = request.files.getlist("files")
		if not files or all(f.filename == '' for f in files):
			return jsonify({"error": "Файлы не были отправлены."}), 400
		
		all_dates = []
		
		for file in files:
			if file.filename == '':
				continue
			try:
				file.stream.seek(0)
				df = _try_read_file(file)
				if df is None or df.empty:
					continue
				
				# Находим столбец с датой подтверждения
				_, _, _, _, time_col, _, _, _ = _match_columns(df)
				if time_col and time_col in df.columns:
					# Пытаемся распарсить дату из столбца
					dt_series = _parse_datetime(df[time_col])
					# Извлекаем только даты (без времени)
					dates = dt_series.dropna().dt.date.unique()
					all_dates.extend([d for d in dates if d is not None])
			except Exception as e:
				app.logger.warning(f"Ошибка при чтении файла {file.filename} для определения даты: {e}")
				continue
		
		if not all_dates:
			return jsonify({"error": "Не удалось определить дату работы из файлов."}), 400
		
		# Подсчитываем частоту каждой даты (пики)
		from collections import Counter
		date_counts = Counter(all_dates)
		
		# Находим дату с максимальной частотой (пик)
		most_common_date, count = date_counts.most_common(1)[0]
		work_date = most_common_date.strftime('%Y-%m-%d')
		
		return jsonify({
			"success": True,
			"work_date": work_date,
			"date_counts": {str(d): c for d, c in date_counts.items()},
			"detected_count": count,
			"total_files": len([f for f in files if f.filename != ''])
		})
	except Exception as e:
		app.logger.error(f"Ошибка при определении даты работы: {e}")
		return jsonify({"error": str(e)}), 500


@app.route("/analyze", methods=["POST"]) 
def analyze():
	"""Маршрут для приёма файла/файлов и выдачи результатов анализа."""
	# Поддерживаем как одиночный файл (file), так и множественные файлы (files)
	files_list = request.files.getlist("files")
	single_file = request.files.get("file")
	
	# Если есть множественные файлы, используем их, иначе проверяем одиночный файл
	if files_list and any(f.filename for f in files_list):
		files_to_process = [f for f in files_list if f.filename]
	elif single_file and single_file.filename:
		files_to_process = [single_file]
	else:
		if request.headers.get('Content-Type', '').startswith('multipart/form-data'):
			return jsonify({"error": "Файл не был отправлен."}), 400
		flash("Файл не был отправлен.", "danger")
		return redirect(url_for("index"))

	# Определяем, это API запрос (от фронтенда) или HTML форма
	is_api_request = request.headers.get('Accept', '').find('application/json') != -1 or \
	                 request.headers.get('X-Requested-With') == 'XMLHttpRequest' or \
	                 request.form.get('api') == 'true'
	app.logger.info(f"is_api_request = {is_api_request}, Accept = {request.headers.get('Accept')}, X-Requested-With = {request.headers.get('X-Requested-With')}")

	try:
		# Обрабатываем все файлы и объединяем в один DataFrame
		dataframes = []
		for file in files_to_process:
			try:
				# Важно: перематываем файловый дескриптор перед чтением
				file.stream.seek(0)
				
				# Валидация файла перед чтением
				try:
					file_df = _try_read_file(file)
				except ValueError as ve:
					if is_api_request:
						return jsonify({"error": f"Ошибка при чтении файла {file.filename}: {str(ve)}"}), 400
					flash(f"Ошибка при чтении файла {file.filename}: {str(ve)}", "danger")
					return redirect(url_for("index"))
				except MemoryError:
					if is_api_request:
						return jsonify({"error": f"Недостаточно памяти для обработки файла {file.filename}. Файл слишком большой."}), 400
					flash(f"Недостаточно памяти для обработки файла {file.filename}. Файл слишком большой.", "danger")
					return redirect(url_for("index"))
				except Exception as e:
					if is_api_request:
						return jsonify({"error": f"Неожиданная ошибка при чтении файла {file.filename}: {str(e)}"}), 400
					flash(f"Неожиданная ошибка при чтении файла {file.filename}: {str(e)}", "danger")
					return redirect(url_for("index"))
				
				# Валидация структуры данных после чтения
				if file_df is None or file_df.empty:
					app.logger.warning(f"Файл {file.filename} пуст или не может быть прочитан, пропускаем.")
					continue
				
				# Проверяем наличие обязательных столбцов
				try:
					_match_columns(file_df)
				except ValueError as ve:
					if is_api_request:
						return jsonify({"error": f"Ошибка структуры файла {file.filename}: {str(ve)}. Убедитесь, что файл содержит необходимые столбцы."}), 400
					flash(f"Ошибка структуры файла {file.filename}: {str(ve)}. Убедитесь, что файл содержит необходимые столбцы.", "danger")
					return redirect(url_for("index"))
				
				dataframes.append(file_df)
			except Exception as e:
				app.logger.error(f"Ошибка при обработке файла {file.filename}: {e}")
				if is_api_request:
					return jsonify({"error": f"Ошибка при обработке файла {file.filename}: {str(e)}"}), 400
				flash(f"Ошибка при обработке файла {file.filename}: {str(e)}", "danger")
				return redirect(url_for("index"))
		
		if not dataframes:
			if is_api_request:
				return jsonify({"error": "Не удалось прочитать ни один файл."}), 400
			flash("Не удалось прочитать ни один файл.", "danger")
			return redirect(url_for("index"))
		
		# Если пришла дата (YYYY-MM-DD), копим по дням, иначе — в общий накопитель
		date_str = request.form.get("date")
		
		# Если дата не указана, определяем дату для каждого файла отдельно и группируем по датам
		if not date_str:
			# Определяем дату работы для каждого файла отдельно
			from collections import defaultdict
			from datetime import date as date_type
			
			date_to_dataframes = defaultdict(list)
			
			for file_idx, file_df in enumerate(dataframes):
				try:
					# Логируем информацию о файле для диагностики
					app.logger.info(f"=== Файл {file_idx + 1}: анализ столбцов ===")
					app.logger.info(f"Доступные столбцы: {list(file_df.columns)[:10]}")  # Первые 10 столбцов
					
					# Находим столбец с датой подтверждения
					_, _, _, _, time_col, start_time_col, end_time_col, event_time_col = _match_columns(file_df)
					app.logger.info(f"Определены столбцы: confirm_time={time_col}, start_time={start_time_col}, end_time={end_time_col}, event_time={event_time_col}")
					
					# Ищем столбец "Дата подтверждения" (не "Время подтверждения"!)
					# Это ключевой столбец для определения даты работы
					date_confirm_col = None
					normalized_cols = {_normalize_column_name(col): col for col in file_df.columns}
					for variant in ["датаподтверждения", "дата подтверждения", "подтверждениядата"]:
						if variant in normalized_cols:
							date_confirm_col = normalized_cols[variant]
							app.logger.info(f"Файл {file_idx + 1}: найден столбец 'Дата подтверждения': {date_confirm_col}")
							break
					
					# Пробуем определить дату из разных столбцов (приоритет: date_confirm > event_time > end_time > start_time > confirm_time)
					date_series = None
					date_source = None
					
					# ПРИОРИТЕТ 1: Сначала пробуем "Дата подтверждения" - это основной столбец для определения даты работы
					if date_confirm_col and date_confirm_col in file_df.columns:
						try:
							test_series = _parse_datetime(file_df[date_confirm_col])
							test_dates = test_series.dropna().dt.date.unique()
							if len(test_dates) > 0:
								date_series = test_series
								date_source = "date_confirm"
								app.logger.info(f"Файл {file_idx + 1}: дата найдена в столбце 'Дата подтверждения' ({date_confirm_col})")
						except Exception as e:
							app.logger.debug(f"Файл {file_idx + 1}: не удалось распарсить 'Дата подтверждения': {e}")
					
					# ПРИОРИТЕТ 2: Если не нашли в "Дата подтверждения", пробуем event_time, end_time, start_time (там обычно есть полная дата+время)
					if date_series is None:
						for col_name, col in [("event_time", event_time_col), ("end_time", end_time_col), ("start_time", start_time_col)]:
							if col and col in file_df.columns:
								try:
									test_series = _parse_datetime(file_df[col])
									# Проверяем, есть ли дата (не только время)
									test_dates = test_series.dropna().dt.date.unique()
									if len(test_dates) > 0:
										date_series = test_series
										date_source = col_name
										app.logger.info(f"Файл {file_idx + 1}: дата найдена в столбце {col_name} ({col})")
										break
								except Exception as e:
									app.logger.debug(f"Файл {file_idx + 1}: не удалось распарсить {col_name}: {e}")
									continue
					
					# Если не нашли в других столбцах, пробуем confirm_time
					if date_series is None and time_col and time_col in file_df.columns:
						try:
							# Логируем примеры значений для диагностики
							sample_values = file_df[time_col].dropna().head(3).tolist()
							app.logger.info(f"Файл {file_idx + 1}: примеры значений из столбца {time_col}: {sample_values}")
							
							dt_series = _parse_datetime(file_df[time_col])
							# Проверяем, есть ли дата (не только время)
							test_dates = dt_series.dropna().dt.date.unique()
							
							# Логируем примеры распарсенных дат
							sample_parsed = dt_series.dropna().head(3).tolist()
							app.logger.info(f"Файл {file_idx + 1}: примеры распарсенных значений: {[str(d) for d in sample_parsed]}")
							app.logger.info(f"Файл {file_idx + 1}: уникальные даты (первые 5): {list(test_dates)[:5] if len(test_dates) > 0 else 'НЕТ ДАТ'}")
							
							if len(test_dates) > 0:
								date_series = dt_series
								date_source = "confirm_time"
								app.logger.info(f"Файл {file_idx + 1}: дата найдена в confirm_time ({time_col})")
							else:
								# Если в confirm_time только время без даты, используем сегодняшнюю дату + время из confirm_time
								app.logger.warning(f"Файл {file_idx + 1}: в столбце {time_col} только время без даты, используем системную дату")
								# Используем первую строку файла или пытаемся найти дату в других местах
								from datetime import datetime
								today = datetime.now().date()
								# Пробуем парсить время и комбинировать с сегодняшней датой
								# Но это не правильно для файлов за другие даты!
								# Вместо этого используем дату из event_time/end_time, если есть
								if event_time_col and event_time_col in file_df.columns:
									try:
										date_series = _parse_datetime(file_df[event_time_col])
										date_source = "event_time_fallback"
									except:
										pass
								if date_series is None and end_time_col and end_time_col in file_df.columns:
									try:
										date_series = _parse_datetime(file_df[end_time_col])
										date_source = "end_time_fallback"
									except:
										pass
						except Exception as e:
							app.logger.warning(f"Файл {file_idx + 1}: ошибка при парсинге confirm_time: {e}")
					
					if date_series is not None:
						# Извлекаем только даты (без времени)
						dates = date_series.dropna().dt.date.unique()
						app.logger.info(f"Файл {file_idx + 1}: найдены даты: {list(dates)[:5]}")  # Показываем первые 5 дат
						if len(dates) > 0:
							# Находим дату с максимальной частотой для этого файла
							from collections import Counter
							date_counts = Counter(date_series.dropna().dt.date)
							if date_counts:
								file_date, count = date_counts.most_common(1)[0]
								app.logger.info(f"Файл {file_idx + 1}: определена дата {file_date} (найдено {count} записей из {len(date_series.dropna())}, источник: {date_source})")
								date_to_dataframes[file_date].append(file_df)
							else:
								app.logger.warning(f"Не удалось определить дату для файла {file_idx + 1} (date_counts пуст)")
						else:
							app.logger.warning(f"Файл {file_idx + 1}: не содержит валидных дат (dates пуст)")
					else:
						app.logger.warning(f"Файл {file_idx + 1}: не найден столбец с датой для определения даты работы")
				except Exception as e:
					app.logger.error(f"Ошибка при определении даты для файла {file_idx + 1}: {e}")
			
			if not date_to_dataframes:
				if is_api_request:
					return jsonify({"error": "Не удалось определить дату работы ни для одного файла."}), 400
				flash("Не удалось определить дату работы ни для одного файла.", "danger")
				return redirect(url_for("index"))
			
			# Обрабатываем каждую дату отдельно
			processed_count = 0
			for work_date, date_dfs in date_to_dataframes.items():
				date_str = work_date.strftime('%Y-%m-%d')
				
				# Объединяем файлы для этой даты
				if len(date_dfs) > 1:
					# Приводим все DataFrame к одному набору столбцов
					all_columns = set()
					for df_item in date_dfs:
						all_columns.update(df_item.columns)
					all_columns = list(all_columns)
					
					for i, df_item in enumerate(date_dfs):
						missing_cols = [col for col in all_columns if col not in df_item.columns]
						if missing_cols:
							for col in missing_cols:
								date_dfs[i][col] = ""
						date_dfs[i] = date_dfs[i][all_columns]
					
					df = pd.concat(date_dfs, ignore_index=True)
				else:
					df = date_dfs[0]
				
				app.logger.info(f"Обработка {len(date_dfs)} файл(ов) для даты {date_str}, всего строк: {len(df)}")
				
				# Проверяем наличие обязательных столбцов
				try:
					_match_columns(df)
				except ValueError as ve:
					app.logger.error(f"Ошибка структуры файлов для даты {date_str}: {str(ve)}")
					continue
				
				# Сохраняем данные для этой даты
				_append_to_day(date_str, df)
				processed_count += 1
				
				# Запускаем асинхронную обработку для этой даты
				if is_api_request:
					def process_async_for_date(d_str):
						def process():
							try:
								try:
									app.logger.info(f"Начата асинхронная обработка данных за {d_str}")
								except Exception:
									pass
								time.sleep(0.5)
								# Далее тот же код обработки, что и ниже
								csv_cache, br_cache, hr_cache = _day_analysis_cache_paths(d_str)
								result_df = None
								if os.path.exists(csv_cache):
									try:
										import json as _json
										result_df = pd.read_csv(csv_cache)
										with open(br_cache, 'r', encoding='utf-8') as f:
											breaks_map = _json.load(f)
										with open(hr_cache, 'r', encoding='utf-8') as f:
											hourly_map = _json.load(f)
										try:
											app.logger.info(f"Использован кэш для {d_str}")
										except Exception:
											pass
									except Exception:
										result_df = None
								if result_df is None:
									try:
										app.logger.info(f"Загрузка данных за {d_str} для обработки")
									except Exception:
										pass
									day_df = _load_day_df(d_str)
									if day_df is None or day_df.empty:
										try:
											app.logger.error(f"Не удалось загрузить данные за {d_str}")
										except Exception:
											pass
										return
									try:
										app.logger.info(f"Обработка {len(day_df)} строк для {d_str}")
									except Exception:
										pass
									result_df = analyze_dataframe(day_df)
									breaks_map = getattr(result_df, "breaks_by_approver", {})
									hourly_map = getattr(result_df, "hourly_by_approver", {})
									# Сохраняем кэш (код ниже)
									try:
										import json as _json
										_ensure_day_dir(d_str)
										result_df.to_csv(csv_cache, index=False, encoding='utf-8-sig')
										serializable_breaks = {}
										for approver, brs in (breaks_map or {}).items():
											serializable_breaks[approver] = [{
												"duration": str(b.get("duration")),
												"bucket": b.get("bucket"),
												"before": {k: ("" if v is None else str(v)) for k, v in b.get("before", {}).items()},
												"after": {k: ("" if v is None else str(v)) for k, v in b.get("after", {}).items()},
											} for b in brs]
										breaks_sum = {ap: sum(_duration_to_seconds(x.get("duration")) for x in (brs or [])) for ap, brs in (breaks_map or {}).items()}
										tmp_sum = f"{_day_breaks_sum_cache_path(d_str)}.tmp"
										with open(tmp_sum, 'w', encoding='utf-8') as f:
											_json.dump(breaks_sum, f, ensure_ascii=False)
										os.replace(tmp_sum, _day_breaks_sum_cache_path(d_str))
										tmp_path = f"{br_cache}.tmp"
										with open(tmp_path, 'w', encoding='utf-8') as f:
											_json.dump(serializable_breaks, f, ensure_ascii=False)
										os.replace(tmp_path, br_cache)
										with open(hr_cache, 'w', encoding='utf-8') as f:
											_json.dump(hourly_map or {}, f, ensure_ascii=False)
									except Exception as e:
										try:
											app.logger.error(f"Ошибка при сохранении кэша для {d_str}: {e}")
										except Exception:
											pass
								try:
									try:
										app.logger.info(f"Построение сводки дня для {d_str}")
									except Exception:
										pass
									_build_day_summary(d_str, preloaded_df=_load_day_df(d_str), write_cache=True)
									try:
										app.logger.info(f"Асинхронная обработка данных за {d_str} завершена успешно")
									except Exception:
										pass
								except Exception as e:
									try:
										app.logger.error(f"Ошибка при построении сводки дня {d_str}: {e}")
										import traceback
										app.logger.error(traceback.format_exc())
									except Exception:
										pass
							except Exception as e:
								try:
									app.logger.error(f"Ошибка при асинхронной обработке файла для {d_str}: {e}")
									import traceback
									app.logger.error(traceback.format_exc())
								except Exception:
									pass  # Игнорируем ошибки логирования при завершении
						return process
					
					thread = threading.Thread(target=process_async_for_date(date_str), daemon=True)
					thread.start()
			
			if is_api_request:
				return jsonify({"success": True, "message": f"Обработано {processed_count} дат. Обработка продолжается в фоне."})
			return redirect(url_for("analyze_day", date_str=date_str))
		
		# Если дата указана явно, обрабатываем все файлы вместе для этой даты
		if date_str:
			# Объединяем все DataFrame в один для указанной даты
			# Убеждаемся, что все DataFrame имеют одинаковые столбцы
			if len(dataframes) > 1:
				# Приводим все DataFrame к одному набору столбцов (объединение)
				all_columns = set()
				for df_item in dataframes:
					all_columns.update(df_item.columns)
				all_columns = list(all_columns)
				
				# Добавляем недостающие столбцы в каждый DataFrame
				for i, df_item in enumerate(dataframes):
					missing_cols = [col for col in all_columns if col not in df_item.columns]
					if missing_cols:
						for col in missing_cols:
							dataframes[i][col] = ""
				
				# Переупорядочиваем столбцы для единообразия
				for i in range(len(dataframes)):
					dataframes[i] = dataframes[i][all_columns]
				
				df = pd.concat(dataframes, ignore_index=True)
			else:
				df = dataframes[0]
			
			app.logger.info(f"Объединено {len(dataframes)} файлов для даты {date_str}, всего строк: {len(df)}")
			
			# Проверяем наличие обязательных столбцов в объединенном DataFrame
			try:
				_match_columns(df)
			except ValueError as ve:
				if is_api_request:
					return jsonify({"error": f"Ошибка структуры файла: {str(ve)}. Убедитесь, что файл содержит необходимые столбцы."}), 400
				flash(f"Ошибка структуры файла: {str(ve)}. Убедитесь, что файл содержит необходимые столбцы.", "danger")
				return redirect(url_for("index"))
			
			# Сохраняем исходные данные для FastStat ПЕРЕД обработкой
			app.logger.info(f"Получена дата для сохранения: {date_str}")
			_append_to_day(date_str, df)
			app.logger.info(f"Данные сохранены для даты {date_str}")
			
			# Для API запросов: сразу возвращаем успех, обработку делаем в фоне
			if is_api_request:
				# Запускаем обработку в фоновом потоке
				def process_async():
					try:
						try:
							app.logger.info(f"Начата асинхронная обработка данных за {date_str}")
						except Exception:
							pass  # Игнорируем ошибки логирования при завершении
						# Ждем немного, чтобы файл точно сохранился
						time.sleep(0.5)
						# Обрабатываем данные
						csv_cache, br_cache, hr_cache = _day_analysis_cache_paths(date_str)
						result_df = None
						# Если есть кэш, используем его
						if os.path.exists(csv_cache):
							try:
								import json as _json
								result_df = pd.read_csv(csv_cache)
								with open(br_cache, 'r', encoding='utf-8') as f:
									breaks_map = _json.load(f)
								with open(hr_cache, 'r', encoding='utf-8') as f:
									hourly_map = _json.load(f)
								app.logger.info(f"Использован кэш для {date_str}")
							except Exception as e:
								app.logger.warning(f"Не удалось использовать кэш для {date_str}: {e}")
								result_df = None
						if result_df is None:
							app.logger.info(f"Загрузка данных за {date_str} для обработки")
							day_df = _load_day_df(date_str)
							if day_df is None or day_df.empty:
								app.logger.error(f"Не удалось загрузить данные за {date_str}")
								return
							app.logger.info(f"Обработка {len(day_df)} строк для {date_str}")
							result_df = analyze_dataframe(day_df)
							breaks_map = getattr(result_df, "breaks_by_approver", {})
							hourly_map = getattr(result_df, "hourly_by_approver", {})
							# Сохраняем кэш
							try:
								import json as _json
								_ensure_day_dir(date_str)
								result_df.to_csv(csv_cache, index=False, encoding='utf-8-sig')
								serializable_breaks = {}
								for approver, brs in (breaks_map or {}).items():
									serializable_breaks[approver] = [{
										"duration": str(b.get("duration")),
										"bucket": b.get("bucket"),
										"before": {k: ("" if v is None else str(v)) for k, v in b.get("before", {}).items()},
										"after": {k: ("" if v is None else str(v)) for k, v in b.get("after", {}).items()},
									} for b in brs]
								breaks_sum = {ap: sum(_duration_to_seconds(x.get("duration")) for x in (brs or [])) for ap, brs in (breaks_map or {}).items()}
								tmp_sum = f"{_day_breaks_sum_cache_path(date_str)}.tmp"
								with open(tmp_sum, 'w', encoding='utf-8') as f:
									_json.dump(breaks_sum, f, ensure_ascii=False)
								os.replace(tmp_sum, _day_breaks_sum_cache_path(date_str))
								tmp_path = f"{br_cache}.tmp"
								with open(tmp_path, 'w', encoding='utf-8') as f:
									_json.dump(serializable_breaks, f, ensure_ascii=False)
								os.replace(tmp_path, br_cache)
								with open(hr_cache, 'w', encoding='utf-8') as f:
									_json.dump(hourly_map or {}, f, ensure_ascii=False)
							except Exception as e:
								app.logger.error(f"Ошибка при сохранении кэша: {e}")
						# Генерируем и сохраняем кэш для faststat (приоритетная обработка)
						# Это делается в первую очередь, чтобы /faststat_data мог сразу получить данные
						try:
							try:
								app.logger.info(f"Генерация кэша faststat для {date_str} (приоритет)")
							except Exception:
								pass
							faststat_result = _generate_faststat_tasks(date_str)
							if "error" not in faststat_result:
								faststat_cache_path = _day_faststat_cache_path(date_str)
								_ensure_day_dir(date_str)
								tmp_path = f"{faststat_cache_path}.tmp"
								import json as _json
								with open(tmp_path, 'w', encoding='utf-8') as f:
									_json.dump(faststat_result, f, ensure_ascii=False, indent=2)
								os.replace(tmp_path, faststat_cache_path)
								# Удаляем флаг обработки, если он был создан
								processing_flag = _day_faststat_processing_flag(date_str)
								try:
									if os.path.exists(processing_flag):
										os.remove(processing_flag)
								except Exception:
									pass
								try:
									app.logger.info(f"Кэш faststat для {date_str} сохранен")
								except Exception:
									pass
							else:
								try:
									app.logger.warning(f"Не удалось сгенерировать кэш faststat для {date_str}: {faststat_result.get('error')}")
								except Exception:
									pass
						except Exception as e:
							try:
								app.logger.error(f"Ошибка при генерации кэша faststat для {date_str}: {e}")
								import traceback
								app.logger.error(traceback.format_exc())
							except Exception:
								pass
						
						# Обновляем сводку дня
						try:
							try:
								app.logger.info(f"Построение сводки дня для {date_str}")
							except Exception:
								pass
							_build_day_summary(date_str, preloaded_df=_load_day_df(date_str), write_cache=True)
							try:
								app.logger.info(f"Асинхронная обработка данных за {date_str} завершена успешно")
							except Exception:
								pass
						except Exception as e:
							try:
								app.logger.error(f"Ошибка при построении сводки дня {date_str}: {e}")
								import traceback
								app.logger.error(traceback.format_exc())
							except Exception:
								pass
					except Exception as e:
						try:
							app.logger.error(f"Ошибка при асинхронной обработке файла для {date_str}: {e}")
							import traceback
							app.logger.error(traceback.format_exc())
						except Exception:
							pass  # Игнорируем ошибки логирования при завершении
				
				thread = threading.Thread(target=process_async, daemon=True)
				thread.start()
				# Сразу возвращаем успешный ответ
				return jsonify({"success": True, "message": "Файл успешно загружен. Обработка продолжается в фоне."})
		
		# Для API запросов без даты - тоже возвращаем быстро, обработку в фоне
		if is_api_request and not date_str:
			def process_accumulated_async():
				try:
					time.sleep(0.5)
					_append_to_accumulated(df)
					acc_df = _load_accumulated_df()
					analyze_dataframe(acc_df if acc_df is not None else df)
				except Exception as e:
					try:
						app.logger.error(f"Ошибка при асинхронной обработке накопленных данных: {e}")
					except Exception:
						pass  # Игнорируем ошибки логирования при завершении
			thread = threading.Thread(target=process_accumulated_async, daemon=True)
			thread.start()
			return jsonify({"success": True, "message": "Файл успешно загружен. Обработка продолжается в фоне."})
		
		# Старая логика для HTML форм (сохраняем для обратной совместимости)
		if date_str:
			# Пытаемся использовать кэш анализа
			csv_cache, br_cache, hr_cache = _day_analysis_cache_paths(date_str)
			day_path = _day_path(date_str)
			result_df = None
			# Если есть кэш, используем его (пересчёт не нужен)
			if os.path.exists(csv_cache):
				try:
					import json as _json
					result_df = pd.read_csv(csv_cache)
					with open(br_cache, 'r', encoding='utf-8') as f:
						breaks_map = _json.load(f)
					with open(hr_cache, 'r', encoding='utf-8') as f:
						hourly_map = _json.load(f)
				except Exception:
					result_df = None
			if result_df is None:
				try:
					day_df = _load_day_df(date_str)
					result_df = analyze_dataframe(day_df if day_df is not None else df)
				except MemoryError:
					flash("Недостаточно памяти для анализа данных. Файл слишком большой.", "danger")
					return redirect(url_for("index"))
				except Exception as e:
					flash(f"Ошибка при анализе данных: {str(e)}", "danger")
					return redirect(url_for("index"))
			breaks_map = getattr(result_df, "breaks_by_approver", {})
			hourly_map = getattr(result_df, "hourly_by_approver", {})
			# Сохраняем кэш
			try:
				import json as _json
				_ensure_day_dir(date_str)
				result_df.to_csv(csv_cache, index=False, encoding='utf-8-sig')
				serializable_breaks = {}
				for approver, brs in (breaks_map or {}).items():
					serializable_breaks[approver] = [{
						"duration": str(b.get("duration")),
						"bucket": b.get("bucket"),
						"before": {k: ("" if v is None else str(v)) for k, v in b.get("before", {}).items()},
						"after": {k: ("" if v is None else str(v)) for k, v in b.get("after", {}).items()},
					} for b in brs]
				# Кэш суммы перерывов (маленький файл, нужен для страницы /showstats)
				breaks_sum = {ap: sum(_duration_to_seconds(x.get("duration")) for x in (brs or [])) for ap, brs in (breaks_map or {}).items()}
				tmp_sum = f"{_day_breaks_sum_cache_path(date_str)}.tmp"
				with open(tmp_sum, 'w', encoding='utf-8') as f:
					_json.dump(breaks_sum, f, ensure_ascii=False)
				os.replace(tmp_sum, _day_breaks_sum_cache_path(date_str))
				tmp_path = f"{br_cache}.tmp"
				with open(tmp_path, 'w', encoding='utf-8') as f:
					_json.dump(serializable_breaks, f, ensure_ascii=False)
				os.replace(tmp_path, br_cache)
				with open(hr_cache, 'w', encoding='utf-8') as f:
					_json.dump(hourly_map or {}, f, ensure_ascii=False)
			except Exception:
				pass
		else:
			try:
				_append_to_accumulated(df)
				acc_df = _load_accumulated_df()
				result_df = analyze_dataframe(acc_df if acc_df is not None else df)
			except MemoryError:
				flash("Недостаточно памяти для анализа данных. Файл слишком большой.", "danger")
				return redirect(url_for("index"))
			except Exception as e:
				flash(f"Ошибка при анализе накопленных данных: {str(e)}", "danger")
				return redirect(url_for("index"))
		# Сохраним карты (перерывы и почасовая) ДО любых merge, чтобы не потерять атрибуты (могут быть из кэша)
		breaks_map = locals().get('breaks_map', getattr(result_df, "breaks_by_approver", {}))
		hourly_map = locals().get('hourly_map', getattr(result_df, "hourly_by_approver", {}))
		# Сразу обновляем краткую сводку дня, чтобы IT.json появлялся после загрузки
		if date_str:
			try:
				_build_day_summary(date_str, preloaded_df=_load_day_df(date_str), write_cache=True)
			except Exception:
				pass
			# Запускаем отправку скриншотов в фоновом потоке (не блокируем ответ)
			try:
				def send_screenshots_async():
					try:
						# Небольшая задержка, чтобы данные успели сохраниться
						time.sleep(2)
						# Триггер для фронтенда - он сам сгенерирует и отправит скриншоты
						# Здесь мы просто логируем, что отчет загружен
						try:
							app.logger.info(f"Отчет за {date_str} загружен. Скриншоты будут отправлены фронтендом.")
						except Exception:
							pass  # Игнорируем ошибки логирования при завершении
					except Exception:
						pass  # Игнорируем все ошибки в daemon потоке при завершении
				thread = threading.Thread(target=send_screenshots_async, daemon=True)
				thread.start()
			except Exception as e:
				app.logger.error(f"Ошибка при запуске отправки скриншотов: {e}")
		# Если есть файл сотрудников, присоединим компании (робастно)
		emp_df = None
		# Попытка взять из кэша; инвалидация по времени модификации
		candidate_path = _get_employees_file_path()

		if candidate_path is not None:
			try:
				mtime = os.path.getmtime(candidate_path)
				cached_mtime = _EMPLOYEES_CACHE.get("mtime")
				cached_mapping = _EMPLOYEES_CACHE.get("mapping")
				if cached_mapping is not None and cached_mtime == mtime:
					# Уже загружено
					emp_df = cached_mapping  # type: ignore[assignment]
				else:
					# Читаем и кладём в кэш
					emp_df = _try_read_employees(candidate_path)
					_EMPLOYEES_CACHE["mtime"] = mtime
					_EMPLOYEES_CACHE["mapping"] = emp_df
			except MemoryError:
				# Пропускаем загрузку сотрудников при нехватке памяти
				pass
			except Exception:
				# Если не удалось, пробуем прочитать без кэша, но не падаем
				try:
					emp_df = _try_read_employees(candidate_path)
				except:
					pass  # Игнорируем ошибки загрузки сотрудников

		if emp_df is not None:
			mapping = _extract_employees_mapping(emp_df)
			if mapping is not None and not mapping.empty:
				# Нормализуем ключи и устраняем дубликаты в маппинге
				mapping["Утвердил"] = mapping["Утвердил"].astype(str).str.strip()
				mapping = mapping.dropna(subset=["Утвердил"]).drop_duplicates(subset=["Утвердил"], keep="first")
				# Нормализуем ключи и в результатах
				result_df["Утвердил"] = result_df["Утвердил"].astype(str).str.strip()
				result_df = result_df.merge(mapping, on="Утвердил", how="left")
				# Перенесём столбец Компания в начало
				cols = ["Компания"] + [c for c in result_df.columns if c != "Компания"]
				result_df = result_df[cols]
				# Значение занятости по умолчанию — "ТСД"
				if "Занятость" not in result_df.columns:
					result_df["Занятость"] = "ТСД"
				else:
					result_df["Занятость"] = result_df["Занятость"].fillna("ТСД").replace({"": "ТСД"})
		# Преобразуем в список словарей для удобной отрисовки в шаблоне
		records = result_df.to_dict(orient="records")
		
		# Вычисляем топ-3 лидеров по количеству задач (СЗ) для кубков
		# Сортируем по СЗ (задачам), при равенстве - по скорости
		sorted_for_top = sorted(records, key=lambda r: (
			-float(r.get('СЗ', 0) or 0),
			-float(r.get('скорость', 0) or 0)
		))
		top_leaders = [r.get('Утвердил', '') for r in sorted_for_top[:3] if r.get('Утвердил')]
		
		# Санитизация значений для корректного JSON (NaN/Inf -> None)
		def _sanitize_value(v):
			try:
				# pandas NaT/NaN
				if v != v:  # NaN
					return None
			except Exception:
				pass
			return v
		def _sanitize_records(recs: List[Dict[str, object]]) -> List[Dict[str, object]]:
			out = []
			for r in recs:
				out.append({k: _sanitize_value(v) for k, v in r.items()})
			return out
		records_json = json.dumps(_sanitize_records(records), ensure_ascii=False, allow_nan=False)
		# Подготовим JSON со сведениями о перерывах, значения сериализуем в строки
		def _stringify_record(rec: Dict[str, object]) -> Dict[str, str]:
			return {k: ("" if v is None else str(v)) for k, v in rec.items()}
		serializable_breaks = {}
		for approver, brs in (breaks_map or {}).items():
			serializable_breaks[approver] = [{
				"duration": str(b.get("duration")),
				"bucket": b.get("bucket"),
				"before": _stringify_record(b.get("before", {})),
				"after": _stringify_record(b.get("after", {})),
			} for b in brs]
		# JSON по часам (используем сохранённую карту до merge)
		hourly_json = json.dumps(hourly_map or {}, ensure_ascii=False)
		return render_template(
			"results.html",
			records=records,
			records_json=records_json,
			breaks_json=json.dumps(serializable_breaks, ensure_ascii=False),
			hourly_json=hourly_json,
			top_leaders=top_leaders,
			top_leaders_json=json.dumps(top_leaders, ensure_ascii=False),
		)
	except MemoryError:
		flash("Недостаточно памяти для обработки файла. Файл слишком большой или сервер перегружен. Попробуйте разделить файл на части.", "danger")
		return redirect(url_for("index"))
	except ValueError as ve:
		flash(f"Ошибка валидации данных: {str(ve)}", "danger")
		return redirect(url_for("index"))
	except Exception as e:
		# Логируем полную ошибку для отладки, но показываем пользователю упрощенное сообщение
		import traceback
		error_msg = str(e)
		# Не показываем полный traceback пользователю, только основную ошибку
		if len(error_msg) > 200:
			error_msg = error_msg[:200] + "..."
		flash(f"Ошибка при обработке файла: {error_msg}", "danger")
		# В продакшене здесь можно добавить логирование
		print(f"Ошибка при обработке файла: {traceback.format_exc()}")
		return redirect(url_for("index"))



@app.route("/clear_accumulator", methods=["POST"]) 
def clear_accumulator():
    """Очищает накопленные данные: либо конкретный день, либо общий накопитель.

    Если в форме передан параметр 'date' (YYYY-MM-DD), удаляется файл дня в data_days.
    Иначе очищается общий накопительный файл accumulated.csv.
    """
    try:
        date_str = request.form.get("date")
        if date_str:
            # Удаляем целиком папку дня (новая структура), иначе — старые файлы
            day_dir = _day_dir(date_str)
            if os.path.isdir(day_dir):
                import shutil as _sh
                _sh.rmtree(day_dir, ignore_errors=True)
            else:
                # Backward compat
                for p in (
                    _day_path(date_str),
                    _day_summary_cache_path(date_str),
                    *_day_analysis_cache_paths(date_str),
                    _day_faststat_cache_path(date_str),
                ):
                    if os.path.exists(p):
                        try:
                            os.remove(p)
                        except Exception:
                            pass
            flash(f"Данные и кэши за {date_str} очищены.", "success")
        else:
            if os.path.exists(ACCUMULATED_FILE_PATH):
                os.remove(ACCUMULATED_FILE_PATH)
            flash("Накопленные данные очищены.", "success")
    except Exception as e:
        flash(f"Не удалось очистить накопитель: {e}", "danger")
    return redirect(url_for("index"))


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint для мониторинга состояния сервиса."""
    try:
        # Проверяем доступность базы данных
        db_path = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "database.sqlite3"))
        db_ok = os.path.exists(db_path) or os.path.exists(os.path.dirname(db_path))
        
        # Проверяем доступность базы данных для штрихкодов
        barcode_db_ok = False
        barcode_db_error = None
        try:
            use_postgres = os.environ.get("BARCODE_USE_POSTGRES", "false").lower() == "true"
            if use_postgres:
                # PostgreSQL
                import psycopg2
                from db import get_db_connection, release_db_connection
                conn = get_db_connection()
                cur = conn.cursor()
                cur.execute("SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='products')")
                result = cur.fetchone()
                barcode_db_ok = result[0] if result else False
                cur.close()
                release_db_connection(conn)
            else:
                # SQLite
                import sqlite3
                if os.path.exists(db_path):
                    conn = sqlite3.connect(db_path, timeout=2.0)
                    cur = conn.cursor()
                    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='products'")
                    result = cur.fetchone()
                    conn.close()
                    barcode_db_ok = result is not None
                else:
                    barcode_db_error = "Database file does not exist"
        except Exception as e:
            barcode_db_error = str(e)
        
        # Проверяем доступность директории данных
        data_dir_ok = os.path.exists(DATA_DIR) or os.path.isdir(DATA_DIR)
        
        status = "healthy" if (db_ok and data_dir_ok and barcode_db_ok) else "degraded"
        return jsonify({
            "status": status,
            "service": "analyz",
            "timestamp": datetime.now().isoformat(),
            "checks": {
                "database": "ok" if db_ok else "warning",
                "barcode_database": "ok" if barcode_db_ok else "warning",
                "barcode_database_error": barcode_db_error,
                "data_directory": "ok" if data_dir_ok else "warning"
            }
        }), 200 if status == "healthy" else 503
    except Exception as e:
        app.logger.error(f"Health check failed: {e}", exc_info=True)
        return jsonify({
            "status": "unhealthy",
            "service": "analyz",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }), 503

@app.route("/days", methods=["GET"]) 
def list_days():
    """Возвращает список дат (YYYY-MM-DD), для которых есть данные."""
    try:
        # Убеждаемся, что директория существует
        if not os.path.exists(DATA_DIR):
            os.makedirs(DATA_DIR, exist_ok=True)
            return jsonify({"days": []})  # Возвращаем пустой список, если директория только что создана
        
        days: List[str] = []
        # New structure: directories with date names and a CSV inside
        for entry in os.listdir(DATA_DIR):
            day_dir = os.path.join(DATA_DIR, entry)
            if os.path.isdir(day_dir) and os.path.exists(os.path.join(day_dir, f"{entry}.csv")):
                days.append(entry)
        # Backward compatibility: old flat files
        for fname in os.listdir(DATA_DIR):
            if fname.endswith('.csv') and len(fname) == 14:  # YYYY-MM-DD.csv
                candidate = fname[:-4]
                if candidate not in days:
                    days.append(candidate)
        days.sort()
        return jsonify({"days": days})
    except Exception as e:
        app.logger.error(f"Error listing days: {e}", exc_info=True)
        return jsonify({"days": [], "error": str(e)}), 500


@app.route("/analyze_day/<date_str>", methods=["GET"]) 
def analyze_day(date_str: str):
    """Загрузка и анализ данных за конкретный день."""
    try:
        # 1) Если есть свежий кэш — отдать его
        csv_cache, br_cache, hr_cache = _day_analysis_cache_paths(date_str)
        day_path = _day_path(date_str)
        # Используем кэш, если он существует (пересчёт не требуется, пока данные дня не перезаписаны)
        if os.path.exists(csv_cache):
            try:
                import json as _json
                result_df = pd.read_csv(csv_cache)
                try:
                    with open(br_cache, 'r', encoding='utf-8') as f:
                        breaks_map = _json.load(f)
                except Exception:
                    breaks_map = {}
                with open(hr_cache, 'r', encoding='utf-8') as f:
                    hourly_map = _json.load(f)
                # Переход к рендеру ниже
            except Exception:
                result_df = None
        else:
            result_df = None

        # 2) Если кэша нет — считать и сохранить
        if result_df is None:
            df = _load_day_df(date_str)
            if df is None:
                flash("Данных за выбранную дату нет.", "warning")
                return redirect(url_for("index"))
            result_df = analyze_dataframe(df)
            breaks_map = getattr(result_df, "breaks_by_approver", {})
            hourly_map = getattr(result_df, "hourly_by_approver", {})
            # Сохраняем кэш
            try:
                import json as _json
                _ensure_day_dir(date_str)
                result_df.to_csv(csv_cache, index=False, encoding='utf-8-sig')
                # Сериализуем перерывы в безопасный JSON и пишем атомарно
                serializable_breaks = {}
                for approver, brs in (breaks_map or {}).items():
                    serializable_breaks[approver] = [{
                        "duration": str(b.get("duration")),
                        "bucket": b.get("bucket"),
                        "before": {k: ("" if v is None else str(v)) for k, v in b.get("before", {}).items()},
                        "after": {k: ("" if v is None else str(v)) for k, v in b.get("after", {}).items()},
                    } for b in brs]
                # Кэш суммы перерывов (маленький файл, нужен для страницы /showstats)
                breaks_sum = {ap: sum(_duration_to_seconds(x.get("duration")) for x in (brs or [])) for ap, brs in (breaks_map or {}).items()}
                tmp_sum = f"{_day_breaks_sum_cache_path(date_str)}.tmp"
                with open(tmp_sum, 'w', encoding='utf-8') as f:
                    _json.dump(breaks_sum, f, ensure_ascii=False)
                os.replace(tmp_sum, _day_breaks_sum_cache_path(date_str))
                tmp_path = f"{br_cache}.tmp"
                with open(tmp_path, 'w', encoding='utf-8') as f:
                    _json.dump(serializable_breaks, f, ensure_ascii=False)
                os.replace(tmp_path, br_cache)
                with open(hr_cache, 'w', encoding='utf-8') as f:
                    _json.dump(hourly_map or {}, f, ensure_ascii=False)
            except Exception:
                pass
        # Маппинг сотрудников
        emp_df = None
        candidate_path = _get_employees_file_path()
        if candidate_path:
            emp_df = _try_read_employees(candidate_path)
        if emp_df is not None:
            mapping = _extract_employees_mapping(emp_df)
            if mapping is not None and not mapping.empty:
                mapping["Утвердил"] = mapping["Утвердил"].astype(str).str.strip()
                mapping = mapping.dropna(subset=["Утвердил"]).drop_duplicates(subset=["Утвердил"], keep="first")
                result_df["Утвердил"] = result_df["Утвердил"].astype(str).str.strip()
                result_df = result_df.merge(mapping, on="Утвердил", how="left")
                cols = ["Компания"] + [c for c in result_df.columns if c != "Компания"]
                result_df = result_df[cols]
                if "Занятость" not in result_df.columns:
                    result_df["Занятость"] = "ТСД"
                else:
                    result_df["Занятость"] = result_df["Занятость"].fillna("ТСД").replace({"": "ТСД"})

        records = result_df.to_dict(orient="records")
        
        # Вычисляем топ-3 лидеров по количеству задач (СЗ) для кубков
        # Сортируем по СЗ (задачам), при равенстве - по скорости
        sorted_for_top = sorted(records, key=lambda r: (
            -float(r.get('СЗ', 0) or 0),
            -float(r.get('скорость', 0) or 0)
        ))
        top_leaders = [r.get('Утвердил', '') for r in sorted_for_top[:3] if r.get('Утвердил')]
        
        # Фильтрация по компании, если передан параметр company_name
        company_filter = request.args.get("company_name", "").strip()
        if company_filter:
            # Фильтруем записи по компании (преобразуем в строку перед сравнением)
            records = [r for r in records if str(r.get("Компания") or "").strip() == company_filter]
            # Фильтруем breaks_map - оставляем только утвердителей из отфильтрованных записей
            approvers_in_company = {r.get("Утвердил") for r in records}
            breaks_map = {k: v for k, v in (breaks_map or {}).items() if k in approvers_in_company}
            # Фильтруем hourly_map аналогично
            hourly_map = {k: v for k, v in (hourly_map or {}).items() if k in approvers_in_company}
        
        def _sanitize_value(v):
            try:
                if v != v:
                    return None
            except Exception:
                pass
            return v
        def _sanitize_records(recs: List[Dict[str, object]]) -> List[Dict[str, object]]:
            out = []
            for r in recs:
                out.append({k: _sanitize_value(v) for k, v in r.items()})
            return out
        records_json = json.dumps(_sanitize_records(records), ensure_ascii=False, allow_nan=False)
        def _stringify_record(rec: Dict[str, object]) -> Dict[str, str]:
            return {k: ("" if v is None else str(v)) for k, v in rec.items()}
        serializable_breaks = {}
        for approver, brs in (breaks_map or {}).items():
            serializable_breaks[approver] = [{
                "duration": str(b.get("duration")),
                "bucket": b.get("bucket"),
                "before": _stringify_record(b.get("before", {})),
                "after": _stringify_record(b.get("after", {})),
            } for b in brs]
        hourly_json = json.dumps(hourly_map or {}, ensure_ascii=False)
        return render_template("results.html", 
                             records=records, 
                             records_json=records_json, 
                             breaks_json=json.dumps(serializable_breaks, ensure_ascii=False), 
                             hourly_json=hourly_json,
                             top_leaders=top_leaders,
                             top_leaders_json=json.dumps(top_leaders, ensure_ascii=False))
    except Exception as e:
        flash(f"Ошибка анализа дня: {e}", "danger")
        return redirect(url_for("index"))


@app.route("/day_summary/<date_str>", methods=["GET"]) 
def day_summary(date_str: str):
    """Краткая сводка по дню для календаря (JSON)."""
    try:
        company_filter = request.args.get("company_name", "").strip()
        # 1) Пытаемся вернуть кэш, если актуален, только для нефильтрованных запросов
        if not company_filter:
            try:
                cache_path = _day_summary_cache_path(date_str)
                day_path = _day_path(date_str)
                if os.path.exists(cache_path) and os.path.exists(day_path):
                    if os.path.getmtime(cache_path) >= os.path.getmtime(day_path):
                        with open(cache_path, "r", encoding="utf-8") as f:
                            import json as _json
                            return _json.load(f)
            except Exception:
                pass

        result = _build_day_summary(
            date_str,
            company_name=company_filter or None,
            write_cache=(company_filter == ""),
        )
        return result
    except ValueError as ve:
        error_msg = str(ve)
        app.logger.error(f"ValueError in day_summary for {date_str}: {error_msg}")
        if error_msg == "no_data":
            return {"error": "no_data"}, 404
        return {"error": error_msg}, 500
    except Exception as e:
        error_msg = str(e)
        app.logger.error(f"Exception in day_summary for {date_str}: {error_msg}", exc_info=True)
        return {"error": error_msg}, 500

@app.route("/employee_stats/<date_str>", methods=["GET"])
def employee_stats(date_str: str):
    """JSON: статистика по каждому сотруднику за день (для /showstats)."""
    try:
        company_filter = request.args.get("company_name", "").strip()

        csv_cache, br_cache, hr_cache = _day_analysis_cache_paths(date_str)
        sum_cache = _day_breaks_sum_cache_path(date_str)

        result_df = None
        breaks_sum_map: Dict[str, int] = {}

        # 1) Пробуем кэш ANL.csv
        if os.path.exists(csv_cache):
            try:
                result_df = pd.read_csv(csv_cache)
            except Exception:
                result_df = None

        # 2) Если кэша нет — считаем и сохраняем (как в analyze_day)
        if result_df is None:
            df = _load_day_df(date_str)
            if df is None:
                return {"error": "no_data"}, 404
            result_df = analyze_dataframe(df)
            breaks_map = getattr(result_df, "breaks_by_approver", {}) or {}
            hourly_map = getattr(result_df, "hourly_by_approver", {}) or {}

            # сохраняем кэш (включая breaks_sum)
            try:
                import json as _json
                _ensure_day_dir(date_str)
                result_df.to_csv(csv_cache, index=False, encoding='utf-8-sig')

                breaks_sum_map = {ap: sum(_duration_to_seconds(x.get("duration")) for x in (brs or [])) for ap, brs in breaks_map.items()}
                tmp_sum = f"{sum_cache}.tmp"
                with open(tmp_sum, 'w', encoding='utf-8') as f:
                    _json.dump(breaks_sum_map, f, ensure_ascii=False)
                os.replace(tmp_sum, sum_cache)

                serializable_breaks = {}
                for approver, brs in breaks_map.items():
                    serializable_breaks[approver] = [{
                        "duration": str(b.get("duration")),
                        "bucket": b.get("bucket"),
                        "before": {k: ("" if v is None else str(v)) for k, v in b.get("before", {}).items()},
                        "after": {k: ("" if v is None else str(v)) for k, v in b.get("after", {}).items()},
                    } for b in brs]
                tmp_path = f"{br_cache}.tmp"
                with open(tmp_path, 'w', encoding='utf-8') as f:
                    _json.dump(serializable_breaks, f, ensure_ascii=False)
                os.replace(tmp_path, br_cache)
                with open(hr_cache, 'w', encoding='utf-8') as f:
                    _json.dump(hourly_map or {}, f, ensure_ascii=False)
            except Exception:
                pass

        # 3) Маппинг сотрудников (Компания)
        emp_df = None
        candidate_path = _get_employees_file_path()
        if candidate_path:
            try:
                emp_df = _try_read_employees(candidate_path)
            except Exception:
                emp_df = None
        if emp_df is not None:
            mapping = _extract_employees_mapping(emp_df)
            if mapping is not None and not mapping.empty:
                mapping["Утвердил"] = mapping["Утвердил"].astype(str).str.strip()
                mapping = mapping.dropna(subset=["Утвердил"]).drop_duplicates(subset=["Утвердил"], keep="first")
                result_df["Утвердил"] = result_df["Утвердил"].astype(str).str.strip()
                result_df = result_df.merge(mapping, on="Утвердил", how="left")

        # 4) Фильтр по компании — только если передан
        if company_filter and "Компания" in result_df.columns:
            result_df["Компания"] = result_df["Компания"].astype(str).str.strip()
            result_df = result_df[result_df["Компания"] == company_filter].copy()

        # 5) Сумма перерывов: читаем маленький кэш; если его нет — пробуем восстановить из большого
        if not breaks_sum_map and os.path.exists(sum_cache):
            try:
                import json as _json
                with open(sum_cache, "r", encoding="utf-8") as f:
                    loaded = _json.load(f) or {}
                breaks_sum_map = {str(k): int(v or 0) for k, v in loaded.items()}
            except Exception:
                breaks_sum_map = {}
        if not breaks_sum_map and os.path.exists(br_cache):
            # единоразовый фолбэк: большой файл, но сразу пересохраним маленький
            try:
                import json as _json
                with open(br_cache, "r", encoding="utf-8") as f:
                    big = _json.load(f) or {}
                breaks_sum_map = {ap: sum(_duration_to_seconds(x.get("duration")) for x in (brs or [])) for ap, brs in big.items()}
                tmp_sum = f"{sum_cache}.tmp"
                with open(tmp_sum, 'w', encoding='utf-8') as f:
                    _json.dump(breaks_sum_map, f, ensure_ascii=False)
                os.replace(tmp_sum, sum_cache)
            except Exception:
                breaks_sum_map = {}

        # 6) Ответ
        rows = result_df.to_dict(orient="records")
        employees = []
        for r in rows:
            emp_id = str(r.get("Утвердил") or "").strip()
            if not emp_id:
                continue
            sec = int(breaks_sum_map.get(emp_id, 0) or 0)
            employees.append({
                "id": emp_id,
                "name": emp_id,
                "company": (str(r.get("Компания") or "").strip() if "Компания" in r else ""),
                "tasks": int(float(r.get("СЗ") or 0)),
                "weight": float(r.get("Вес") or 0),
                "qty": int(float(r.get("Шт") or 0)),
                "speed": float(r.get("скорость") or 0),
                "breaks_total_seconds": sec,
                "breaks_total": _format_hhmm_from_seconds(sec),
            })

        # сортировка: сначала по задачам, потом по скорости
        employees.sort(key=lambda x: (x.get("tasks", 0), x.get("speed", 0.0)), reverse=True)

        return {"date": date_str, "employees": employees}
    except ValueError as ve:
        error_msg = str(ve)
        app.logger.error(f"ValueError in employee_stats for {date_str}: {error_msg}")
        if error_msg == "no_data":
            return {"error": "no_data", "date": date_str, "employees": []}, 404
        return {"error": error_msg, "date": date_str, "employees": []}, 500
    except Exception as e:
        error_msg = str(e)
        app.logger.error(f"Exception in employee_stats for {date_str}: {error_msg}", exc_info=True)
        return {"error": error_msg, "date": date_str, "employees": []}, 500

@app.route("/employee_stats_today", methods=["GET"])
def employee_stats_today():
    """Статистика по сотрудникам за сегодня (удобно для /showstats)."""
    today = datetime.now().strftime("%Y-%m-%d")
    # Если за сегодня данных ещё нет, отдаём последний доступный день (как в календаре)
    try:
        csv_cache, _, _ = _day_analysis_cache_paths(today)
        if os.path.exists(csv_cache) or os.path.exists(_day_path(today)):
            return employee_stats(today)
        # fallback: последний день из DATA_DIR
        days_resp = list_days()
        days = (days_resp.get("days") or []) if isinstance(days_resp, dict) else []
        if days:
            return employee_stats(days[-1])
    except Exception as e:
        app.logger.error(f"Error in employee_stats_today: {e}", exc_info=True)
        # Пробуем вернуть данные за сегодня, даже если есть ошибка
        try:
            return employee_stats(today)
        except Exception as e2:
            app.logger.error(f"Error in employee_stats for today: {e2}", exc_info=True)
            return jsonify({"error": str(e2), "date": today, "employees": []}), 500
    return employee_stats(today)

def _generate_faststat_tasks(date_str: str) -> Dict[str, Any]:
    """Генерирует список задач для FastStat из DataFrame. Используется для кэширования."""
    try:
        day_path = _day_path(date_str)
        if not os.path.exists(day_path):
            return {"error": "no_data", "message": f"Файл {day_path} не найден", "tasks": []}
        
        df = _load_day_df(date_str)
        if df is None or df.empty:
            return {"error": "no_data", "message": "Файл пуст или не может быть прочитан", "tasks": []}

        # Логируем доступные колонки для отладки
        available_cols = list(df.columns)
        
        # Находим нужные колонки (используем более гибкий поиск)
        approver_col = None
        time_col = None
        weight_col = None
        product_col = None
        count_col = None
        unit_col = None
        eo_col = None
        source_eo_col = None
        process_col = None
        otpusk_sklad_mest_col = None
        primim_sklad_mesto_col = None
        warehouse_order_col = None

        # Нормализуем названия колонок для поиска
        for col in df.columns:
            col_lower = col.lower().strip()
            # Убираем лишние символы для более точного поиска
            col_clean = col_lower.replace(':', '').replace('.', '').replace(' ', '')
            
            if 'утвердил' in col_clean and approver_col is None:
                approver_col = col
            if ('времяподтверждения' in col_clean or 'время подтверждения' in col_lower or 'подтвержденовремя' in col_clean) and time_col is None:
                time_col = col
            if ('весгруза' in col_clean or 'вес груза' in col_lower) and weight_col is None:
                weight_col = col
            if ('краткоеописаниепродукта' in col_clean or 'краткое описание продукта' in col_lower) and product_col is None:
                product_col = col
            if ('исходцелколич' in col_clean or 'исходцелколичество' in col_clean) and count_col is None:
                count_col = col
            if ('единицавеса' in col_clean or 'единица веса' in col_lower) and unit_col is None:
                unit_col = col
            if ('принимающаяео' in col_clean or 'принимающая ео' in col_lower or 'приним' in col_clean and 'ео' in col_clean) and eo_col is None:
                eo_col = col
            if ('отпускающаяео' in col_clean or 'отпускающая ео' in col_lower) and source_eo_col is None:
                source_eo_col = col
            if ('видскладпроцесса' in col_clean or 'вид склад. процесса' in col_lower or 'видскладпроцесс' in col_clean) and process_col is None:
                process_col = col
            if ('отпускскладмест' in col_clean or 'отпуск складмест' in col_lower) and otpusk_sklad_mest_col is None:
                otpusk_sklad_mest_col = col
            if ('принимскладместо' in col_clean or 'приним. складместо' in col_lower or 'принимающ' in col_clean and 'складместо' in col_clean) and primim_sklad_mesto_col is None:
                primim_sklad_mesto_col = col
            if ('складскойзаказ' in col_clean or 'складской заказ' in col_lower) and warehouse_order_col is None:
                warehouse_order_col = col

        # Если не нашли обязательные колонки, возвращаем ошибку с информацией
        if not approver_col or not time_col:
            missing = []
            if not approver_col:
                missing.append("Утвердил")
            if not time_col:
                missing.append("Время подтверждения")
            return {
                "error": "required_columns_not_found",
                "message": f"Не найдены обязательные колонки: {', '.join(missing)}",
                "available_columns": available_cols,
                "tasks": []
            }

        # Загружаем маппинг сотрудников для получения компаний
        employee_company_map = {}
        emp_df = None
        candidate_path = _get_employees_file_path()
        if candidate_path:
            try:
                emp_df = _try_read_employees(candidate_path)
                if emp_df is not None:
                    mapping = _extract_employees_mapping(emp_df)
                    if mapping is not None and not mapping.empty:
                        mapping["Утвердил"] = mapping["Утвердил"].astype(str).str.strip()
                        mapping = mapping.dropna(subset=["Утвердил"]).drop_duplicates(subset=["Утвердил"], keep="first")
                        # Создаем словарь для быстрого поиска
                        for _, row in mapping.iterrows():
                            emp_code = str(row["Утвердил"]).strip()
                            company = str(row.get("Компания", "")).strip() if "Компания" in row else ""
                            if emp_code and company:
                                employee_company_map[emp_code] = company
            except Exception as e:
                # Игнорируем ошибки при загрузке маппинга - это не критично
                pass

        tasks = []
        for idx, row in df.iterrows():
            # Пропускаем первую строку (заголовок) если она содержит названия колонок
            if idx == 0:
                # Проверяем, не является ли это заголовком
                first_employee = str(row.get(approver_col, '')).strip() if approver_col else ''
                if 'утвердил' in first_employee.lower():
                    continue
            
            employee_val = row.get(approver_col)
            time_val = row.get(time_col)
            
            # Проверяем на NaN значения pandas
            if pd.isna(employee_val) or pd.isna(time_val):
                continue
            
            employee = str(employee_val).strip()
            time = str(time_val).strip()
            
            # Пропускаем пустые строки, заголовки и строки с nan
            if (not employee or not time or 
                employee == 'Утвердил:' or employee == '' or time == '' or
                employee.lower() == 'nan' or time.lower() == 'nan' or
                employee.lower() == 'none' or time.lower() == 'none'):
                continue

            # Обрабатываем вес - заменяем запятую на точку и убираем кавычки
            weight_val = row.get(weight_col, '0') if weight_col else '0'
            if pd.isna(weight_val):
                weight_val = '0'
            weight_str = str(weight_val).replace(',', '.').replace('"', '').strip()
            # Убираем все нечисловые символы кроме точки и минуса
            weight_str = ''.join(c for c in weight_str if c.isdigit() or c == '.' or c == '-')
            try:
                weight = float(weight_str) if weight_str else 0.0
            except (ValueError, TypeError):
                weight = 0.0

            # Конвертируем граммы в килограммы
            unit = str(row.get(unit_col, '')).strip() if unit_col else ''
            if unit and unit.upper() in ['Г', 'ГР', 'GRAM', 'GRAMS'] and weight > 0:
                weight = weight / 1000

            product = str(row.get(product_col, '')).strip() if product_col else ''
            if pd.isna(row.get(product_col)) if product_col else False:
                product = ''
            
            count_val = row.get(count_col, '1') if count_col else '1'
            if pd.isna(count_val):
                count_val = '1'
            count_str = str(count_val).replace(',', '.').replace('"', '').strip()
            try:
                count = int(float(count_str)) if count_str else 1
            except (ValueError, TypeError):
                count = 1

            eo = ''
            if eo_col and not pd.isna(row.get(eo_col)):
                eo = str(row.get(eo_col, '')).strip()
            
            source_eo = ''
            if source_eo_col and not pd.isna(row.get(source_eo_col)):
                source_eo = str(row.get(source_eo_col, '')).strip()
            
            process_type = ''
            if process_col and not pd.isna(row.get(process_col)):
                process_type = str(row.get(process_col, '')).strip()

            # Получаем МХ в зависимости от типа процесса
            mx_value = ''
            if process_type == '2060':  # Хранение - используем ОтпускСкладМест
                if otpusk_sklad_mest_col and not pd.isna(row.get(otpusk_sklad_mest_col)):
                    mx_value = str(row.get(otpusk_sklad_mest_col, '')).strip()
            elif process_type == '2021':  # КДК - используем Приним. СкладМесто
                if primim_sklad_mesto_col and not pd.isna(row.get(primim_sklad_mesto_col)):
                    mx_value = str(row.get(primim_sklad_mesto_col, '')).strip()

            # Получаем складской заказ
            warehouse_order = ''
            if warehouse_order_col and not pd.isna(row.get(warehouse_order_col)):
                warehouse_order = str(row.get(warehouse_order_col, '')).strip()

            # Получаем компанию из маппинга
            company = employee_company_map.get(employee, "")

            tasks.append({
                "employee": employee,
                "company": company,
                "time": time,
                "product": product,
                "weight": weight,
                "count": count,
                "eo": eo,
                "sourceEO": source_eo,
                "processType": process_type,
                "mx": mx_value,
                "warehouseOrder": warehouse_order
            })

        if len(tasks) == 0:
            # Попробуем понять, почему задачи не найдены
            sample_rows = []
            for idx, row in df.head(5).iterrows():
                emp_val = row.get(approver_col) if approver_col else None
                time_val = row.get(time_col) if time_col else None
                sample_rows.append({
                    "index": int(idx),
                    "employee": str(emp_val) if not pd.isna(emp_val) else "NaN",
                    "time": str(time_val) if not pd.isna(time_val) else "NaN",
                    "is_na_employee": pd.isna(emp_val) if approver_col else True,
                    "is_na_time": pd.isna(time_val) if time_col else True
                })
            
            return {
                "error": "no_tasks",
                "message": "Не найдено ни одной задачи в данных",
                "available_columns": available_cols,
                "found_columns": {
                    "approver": approver_col,
                    "time": time_col,
                    "weight": weight_col,
                    "product": product_col,
                    "count": count_col,
                    "unit": unit_col,
                    "eo": eo_col,
                    "source_eo": source_eo_col,
                    "process": process_col
                },
                "total_rows": len(df),
                "sample_rows": sample_rows,
                "tasks": []
            }

        return {"date": date_str, "tasks": tasks, "total_tasks": len(tasks)}
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        return {
            "error": str(e),
            "message": f"Ошибка при обработке данных: {str(e)}",
            "traceback": error_trace,
            "tasks": []
        }

@app.route("/faststat_data/<date_str>", methods=["GET"])
def faststat_data(date_str: str):
    """Возвращает детальные данные по задачам за день для FastStat."""
    try:
        faststat_cache_path = _day_faststat_cache_path(date_str)
        processing_flag = _day_faststat_processing_flag(date_str)
        
        # ПРИОРИТЕТ 1: Проверяем кэш (быстрая отдача готовых данных)
        if os.path.exists(faststat_cache_path):
            try:
                import json as _json
                with open(faststat_cache_path, 'r', encoding='utf-8') as f:
                    cached_data = _json.load(f)
                # Если в кэше есть ошибка - возвращаем ее с кодом
                if "error" in cached_data:
                    status_code = 404 if cached_data.get("error") in ["no_data", "no_tasks"] else 400
                    return cached_data, status_code
                return cached_data
            except Exception as e:
                app.logger.warning(f"Ошибка при чтении кэша faststat для {date_str}: {e}")
                # Продолжаем выполнение
        
        # ПРИОРИТЕТ 2: Проверяем, идет ли обработка
        if os.path.exists(processing_flag):
            # Обработка уже запущена - возвращаем статус "processing"
            return {
                "status": "processing",
                "message": "Данные обрабатываются, попробуйте запросить позже",
                "tasks": []
            }, 202  # 202 Accepted - запрос принят, но обработка еще не завершена
        
        # ПРИОРИТЕТ 3: Проверяем, есть ли файл данных для обработки
        day_path = _day_path(date_str)
        if not os.path.exists(day_path):
            return {
                "error": "no_data",
                "message": f"Файл {day_path} не найден",
                "tasks": []
            }, 404
        
        # ПРИОРИТЕТ 4: Если кэша нет, но файл есть - запускаем обработку в фоне
        def process_faststat_async():
            """Асинхронная обработка faststat данных"""
            try:
                # Создаем флаг обработки
                _ensure_day_dir(date_str)
                try:
                    with open(processing_flag, 'w') as f:
                        f.write(str(time.time()))
                except Exception:
                    pass
                
                try:
                    app.logger.info(f"Начата фоновая обработка faststat для {date_str}")
                    result = _generate_faststat_tasks(date_str)
                    
                    # Сохраняем в кэш для будущих запросов (только если нет ошибки)
                    if "error" not in result or result.get("error") == "no_data":
                        try:
                            import json as _json
                            tmp_path = f"{faststat_cache_path}.tmp"
                            with open(tmp_path, 'w', encoding='utf-8') as f:
                                _json.dump(result, f, ensure_ascii=False, indent=2)
                            os.replace(tmp_path, faststat_cache_path)
                            app.logger.info(f"Кэш faststat для {date_str} сохранен")
                        except Exception as e:
                            app.logger.warning(f"Не удалось сохранить кэш faststat для {date_str}: {e}")
                finally:
                    # Удаляем флаг обработки
                    try:
                        if os.path.exists(processing_flag):
                            os.remove(processing_flag)
                    except Exception:
                        pass
            except Exception as e:
                app.logger.error(f"Ошибка при фоновой обработке faststat для {date_str}: {e}")
                import traceback
                app.logger.error(traceback.format_exc())
                # Удаляем флаг обработки при ошибке
                try:
                    if os.path.exists(processing_flag):
                        os.remove(processing_flag)
                except Exception:
                    pass
        
        # Запускаем обработку в фоновом потоке
        processing_thread = threading.Thread(target=process_faststat_async, daemon=True)
        processing_thread.start()
        
        # Возвращаем статус "processing" - клиент может опросить позже
        return {
            "status": "processing",
            "message": "Обработка данных запущена, попробуйте запросить через несколько секунд",
            "tasks": []
        }, 202  # 202 Accepted
        
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        return {
            "error": str(e),
            "message": f"Ошибка при обработке данных: {str(e)}",
            "traceback": error_trace,
            "tasks": []
        }, 500


def _send_telegram_photo(photo_path: str, caption: str = "") -> bool:
    """Отправляет фото в Telegram через Bot API с retry логикой всем получателям."""
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
    
    if not TELEGRAM_CHAT_ID:
        app.logger.warning("TELEGRAM_CHAT_ID не установлен. Пропускаем отправку в Telegram.")
        return False
    
    # Проверяем размер файла один раз для всех получателей
    try:
        file_size = os.path.getsize(photo_path)
        if file_size > 10 * 1024 * 1024:  # Больше 10 МБ
            app.logger.warning(f"Файл слишком большой ({file_size / 1024 / 1024:.2f} МБ). Telegram ограничивает размер до 10 МБ.")
            return False
    except Exception as e:
        app.logger.error(f"Ошибка при проверке размера файла: {e}")
        return False
    
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
    
    # Настройка retry стратегии
    retry_strategy = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["POST"]
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session = requests.Session()
    session.mount("https://", adapter)
    
    max_retries = 3
    success_count = 0
    total_recipients = len(TELEGRAM_CHAT_ID)
    
    # Отправляем каждому получателю
    for chat_id in TELEGRAM_CHAT_ID:
        for attempt in range(max_retries):
            try:
                with open(photo_path, 'rb') as photo:
                    files = {'photo': photo}
                    data = {
                        'chat_id': chat_id,
                        'caption': caption[:1024] if caption else ""  # Максимум 1024 символа для подписи
                    }
                    # Увеличиваем таймаут для больших файлов
                    timeout = max(60, file_size / 1024 / 10)  # Минимум 60 секунд, плюс время на передачу
                    response = session.post(url, files=files, data=data, timeout=timeout)
                    response.raise_for_status()
                    app.logger.info(f"Скриншот успешно отправлен в Telegram chat_id {chat_id} (попытка {attempt + 1})")
                    success_count += 1
                    break  # Успешно отправлено этому получателю, переходим к следующему
            except requests.exceptions.Timeout as e:
                app.logger.warning(f"Таймаут при отправке фото в Telegram chat_id {chat_id} (попытка {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)  # Экспоненциальная задержка
                    continue
            except requests.exceptions.ConnectionError as e:
                app.logger.warning(f"Ошибка подключения при отправке фото в Telegram chat_id {chat_id} (попытка {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)  # Экспоненциальная задержка
                    continue
            except requests.exceptions.HTTPError as e:
                if e.response and e.response.status_code == 413:
                    app.logger.error(f"Файл слишком большой для Telegram chat_id {chat_id}: {e}")
                    break  # Не имеет смысла повторять для этого получателя
                app.logger.warning(f"HTTP ошибка при отправке фото в Telegram chat_id {chat_id} (попытка {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                    continue
            except Exception as e:
                app.logger.error(f"Ошибка при отправке фото в Telegram chat_id {chat_id} (попытка {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                    continue
        
        if success_count == 0 and attempt == max_retries - 1:
            app.logger.error(f"Не удалось отправить фото в Telegram chat_id {chat_id} после {max_retries} попыток")
    
    if success_count > 0:
        app.logger.info(f"Отправлено скриншотов: {success_count} из {total_recipients} получателей")
        return True
    else:
        app.logger.error(f"Не удалось отправить фото ни одному из {total_recipients} получателей")
        return False


def _get_companies_for_date(date_str: str) -> List[str]:
    """Получает список уникальных компаний для указанной даты."""
    try:
        df = _load_day_df(date_str)
        if df is None or df.empty:
            return []
        
        # Загружаем маппинг сотрудников
        employee_company_map = {}
        candidate_path = _get_employees_file_path()
        if candidate_path:
            try:
                emp_df = _try_read_employees(candidate_path)
                if emp_df is not None:
                    mapping = _extract_employees_mapping(emp_df)
                    if mapping is not None and not mapping.empty:
                        for _, row in mapping.iterrows():
                            emp_code = str(row["Утвердил"]).strip()
                            company = str(row.get("Компания", "")).strip() if "Компания" in row else ""
                            if emp_code and company:
                                employee_company_map[emp_code] = company
            except Exception:
                pass
        
        # Получаем уникальные компании
        companies = set()
        approver_col = None
        for col in df.columns:
            col_lower = col.lower().strip()
            if 'утвердил' in col_lower or 'approver' in col_lower:
                approver_col = col
                break
        
        if approver_col:
            for _, row in df.iterrows():
                employee = str(row.get(approver_col, '')).strip()
                if employee and employee in employee_company_map:
                    company = employee_company_map[employee]
                    if company:
                        companies.add(company)
        
        return sorted(list(companies))
    except Exception as e:
        app.logger.error(f"Ошибка при получении списка компаний: {e}")
        return []


@app.route("/send_screenshot", methods=["POST"])
def send_screenshot():
    """Принимает скриншот от фронтенда и отправляет его в Telegram."""
    try:
        import requests
        if 'file' not in request.files:
            return {"error": "Файл не найден"}, 400
        
        file = request.files['file']
        company = request.form.get('company', 'Неизвестная компания')
        date_str = request.form.get('date', '')
        
        if file.filename == '':
            return {"error": "Имя файла пустое"}, 400
        
        # Сохраняем временный файл
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as tmp_file:
            file.save(tmp_file.name)
            tmp_path = tmp_file.name
        
        try:
            # Проверяем размер файла перед отправкой
            file_size = os.path.getsize(tmp_path)
            app.logger.info(f"Размер скриншота для компании {company}: {file_size / 1024:.2f} КБ")
            
            # Если файл слишком большой, пытаемся его сжать (опционально)
            # Telegram ограничивает размер до 10 МБ, но лучше не превышать 5 МБ
            if file_size > 5 * 1024 * 1024:
                app.logger.warning(f"Файл большой ({file_size / 1024 / 1024:.2f} МБ), но попробуем отправить")
            
            caption = f"📊 Отчет за {date_str}\nКомпания: {company}"
            success = _send_telegram_photo(tmp_path, caption)
            if success:
                return {"success": True, "message": "Скриншот отправлен в Telegram"}
            else:
                return {"error": "Не удалось отправить скриншот в Telegram после нескольких попыток"}, 500
        finally:
            # Удаляем временный файл
            try:
                os.unlink(tmp_path)
            except:
                pass
    except Exception as e:
        import traceback
        app.logger.error(f"Ошибка при отправке скриншота: {e}")
        app.logger.error(traceback.format_exc())
        return {"error": str(e)}, 500


@app.route("/trigger_screenshots/<date_str>", methods=["POST"])
def trigger_screenshots(date_str: str):
    """Триггер для генерации скриншотов после загрузки отчета.
    Возвращает список компаний, для которых нужно создать скриншоты."""
    try:
        companies = _get_companies_for_date(date_str)
        return {"success": True, "companies": companies, "date": date_str}
    except Exception as e:
        app.logger.error(f"Ошибка при получении списка компаний: {e}")
        return {"error": str(e)}, 500


@app.route("/send_idle_screenshots/<date_str>", methods=["POST"])
def send_idle_screenshots(date_str: str):
    """Отправляет скриншоты простоев по компаниям в Telegram после загрузки отчета."""
    try:
        # Получаем простои за указанную дату
        idle_response = get_idle_times(date_str)
        if isinstance(idle_response, tuple):
            idle_data = idle_response[0]
        else:
            idle_data = idle_response
        
        if not idle_data.get("idle_times") or len(idle_data["idle_times"]) == 0:
            app.logger.info(f"Нет простоев более 10 минут за {date_str}")
            return {"success": True, "message": "Нет простоев для отправки", "sent_count": 0}
        
        # Группируем простои по компаниям
        companies_idle: Dict[str, List[Dict]] = {}
        for idle in idle_data["idle_times"]:
            company = idle.get("company", "Без компании")
            if company not in companies_idle:
                companies_idle[company] = []
            companies_idle[company].append(idle)
        
        app.logger.info(f"Отправка скриншотов простоев для {len(companies_idle)} компаний за {date_str}")
        
        sent_count = 0
        for company, idles in companies_idle.items():
            try:
                # Создаем скриншот таблицы простоев для компании
                screenshot_path = _create_idle_times_screenshot(company, idles, date_str)
                if screenshot_path and os.path.exists(screenshot_path):
                    caption = f"⏱️ Простои более 10 мин за {date_str}\nКомпания: {company}\nВсего простоев: {len(idles)}"
                    if _send_telegram_photo(screenshot_path, caption):
                        sent_count += 1
                        app.logger.info(f"Скриншот простоев отправлен для компании {company}")
                    # Удаляем временный файл
                    try:
                        os.unlink(screenshot_path)
                    except:
                        pass
            except Exception as e:
                app.logger.error(f"Ошибка при отправке скриншота простоев для {company}: {e}")
                import traceback
                app.logger.error(traceback.format_exc())
        
        app.logger.info(f"Отправлено скриншотов простоев: {sent_count} из {len(companies_idle)} компаний за {date_str}")
        return {"success": True, "sent_count": sent_count, "total_companies": len(companies_idle)}
    except Exception as e:
        import traceback
        app.logger.error(f"Ошибка при отправке скриншотов простоев: {e}")
        app.logger.error(traceback.format_exc())
        return {"error": str(e)}, 500


@app.route("/telegram_webhook", methods=["POST"])
def telegram_webhook():
    """Webhook для обработки команд Telegram бота."""
    try:
        import requests
        data = request.get_json()
        
        if not data:
            return {"ok": False}, 400
        
        message = data.get("message", {})
        text = message.get("text", "").strip()
        chat_id = str(message.get("chat", {}).get("id", ""))
        
        if not text or not chat_id:
            return {"ok": False}, 400
        
        # Обработка команды /pull
        if text == "/pull":
            # Получаем последнюю доступную дату
            data_days_dir = DATA_DIR
            if not os.path.exists(data_days_dir):
                _send_telegram_message(chat_id, "Нет данных для отправки")
                return {"ok": True}
            
            # Находим последнюю дату
            dates = []
            for item in os.listdir(data_days_dir):
                item_path = os.path.join(data_days_dir, item)
                if os.path.isdir(item_path) and len(item) == 10 and item[4] == '-' and item[7] == '-':
                    dates.append(item)
            
            if not dates:
                _send_telegram_message(chat_id, "Нет данных для отправки")
                return {"ok": True}
            
            latest_date = sorted(dates)[-1]
            
            # Получаем простои за последнюю дату
            idle_response = get_idle_times(latest_date)
            if isinstance(idle_response, tuple):
                idle_data = idle_response[0]
            else:
                idle_data = idle_response
            
            if not idle_data.get("idle_times") or len(idle_data["idle_times"]) == 0:
                _send_telegram_message(chat_id, f"За {latest_date} нет простоев более 10 минут")
                return {"ok": True}
            
            # Группируем простои по компаниям
            companies_idle: Dict[str, List[Dict]] = {}
            for idle in idle_data["idle_times"]:
                company = idle.get("company", "Без компании")
                if company not in companies_idle:
                    companies_idle[company] = []
                companies_idle[company].append(idle)
            
            # Отправляем скриншоты простоев по компаниям
            _send_telegram_message(chat_id, f"Отправка скриншотов простоев за {latest_date}...")
            
            sent_count = 0
            for company, idles in companies_idle.items():
                try:
                    # Создаем скриншот таблицы простоев для компании
                    screenshot_path = _create_idle_times_screenshot(company, idles, latest_date)
                    if screenshot_path and os.path.exists(screenshot_path):
                        caption = f"⏱️ Простои более 10 мин за {latest_date}\nКомпания: {company}\nВсего простоев: {len(idles)}"
                        if _send_telegram_photo(screenshot_path, caption):
                            sent_count += 1
                        # Удаляем временный файл
                        try:
                            os.unlink(screenshot_path)
                        except:
                            pass
                except Exception as e:
                    app.logger.error(f"Ошибка при отправке скриншота простоев для {company}: {e}")
                    import traceback
                    app.logger.error(traceback.format_exc())
            
            _send_telegram_message(chat_id, f"✅ Отправлено скриншотов простоев: {sent_count} компаний за {latest_date}")
            return {"ok": True}
        
        return {"ok": True}
    except Exception as e:
        import traceback
        app.logger.error(f"Ошибка в telegram_webhook: {e}")
        app.logger.error(traceback.format_exc())
        return {"ok": False, "error": str(e)}, 500


def _send_telegram_message(chat_id: str, text: str) -> bool:
    """Отправляет текстовое сообщение в Telegram."""
    try:
        import requests
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        data = {
            'chat_id': chat_id,
            'text': text[:4096]  # Максимум 4096 символов
        }
        response = requests.post(url, json=data, timeout=10)
        response.raise_for_status()
        return True
    except Exception as e:
        app.logger.error(f"Ошибка при отправке сообщения в Telegram: {e}")
        return False


def _create_idle_times_screenshot(company: str, idle_times: List[Dict], date_str: str) -> Optional[str]:
    """Создает скриншот таблицы простоев для компании."""
    try:
        from PIL import Image, ImageDraw, ImageFont
        import tempfile
        
        # Вычисляем топ-3 лидеров по количеству простоев (по общему количеству простоев)
        # Группируем по сотрудникам и считаем количество простоев
        employee_idle_counts = {}
        for idle in idle_times:
            emp = str(idle.get('employee', ''))
            if emp:
                employee_idle_counts[emp] = employee_idle_counts.get(emp, 0) + 1
        top_leaders_for_screenshot = sorted(employee_idle_counts.items(), key=lambda x: x[1], reverse=True)[:3]
        top_leaders_employees = [emp for emp, _ in top_leaders_for_screenshot]
        
        # Параметры таблицы
        padding = 20
        row_height = 35
        header_height = 50
        col_widths = [60, 180, 100, 100, 150]  # №, Сотрудник, С, До, Длительность
        table_width = sum(col_widths) + padding * 2
        max_rows = 30  # Максимум строк на скриншоте
        table_height = header_height + min(len(idle_times), max_rows) * row_height + padding * 2
        
        # Создаем изображение
        img = Image.new('RGB', (table_width, table_height), color='white')
        draw = ImageDraw.Draw(img)
        
        # Пытаемся загрузить шрифты
        try:
            # Пробуем разные шрифты в зависимости от ОС
            font_paths = [
                'arial.ttf',
                'Arial.ttf',
                '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
                '/System/Library/Fonts/Helvetica.ttc',
            ]
            font_large = None
            font_normal = None
            
            for font_path in font_paths:
                try:
                    if os.path.exists(font_path):
                        font_large = ImageFont.truetype(font_path, 16)
                        font_normal = ImageFont.truetype(font_path, 11)
                        break
                except:
                    continue
            
            if font_large is None:
                font_large = ImageFont.load_default()
                font_normal = ImageFont.load_default()
        except:
            font_large = ImageFont.load_default()
            font_normal = ImageFont.load_default()
        
        # Заголовок таблицы
        header_text = f"Простои более 10 мин - {company} ({date_str})"
        draw.rectangle([padding, padding, table_width - padding, padding + header_height], 
                      fill='#3b82f6', outline='#2563eb', width=2)
        
        # Получаем размер текста для центрирования
        bbox = draw.textbbox((0, 0), header_text, font=font_large)
        text_width = bbox[2] - bbox[0]
        text_x = padding + (table_width - padding * 2 - text_width) // 2
        draw.text((text_x, padding + 15), header_text, fill='white', font=font_large)
        
        # Заголовки колонок
        headers = ['№', 'Сотрудник', 'С', 'До', 'Длительность']
        y_header = padding + header_height
        x = padding
        for i, header in enumerate(headers):
            draw.rectangle([x, y_header, x + col_widths[i], y_header + 30], 
                         fill='#1e40af', outline='#1e3a8a', width=1)
            # Центрируем текст заголовка
            bbox = draw.textbbox((0, 0), header, font=font_normal)
            text_width = bbox[2] - bbox[0]
            text_x = x + (col_widths[i] - text_width) // 2
            draw.text((text_x, y_header + 8), header, fill='white', font=font_normal)
            x += col_widths[i]
        
        # Данные
        y = y_header + 30
        for idx, idle in enumerate(idle_times[:max_rows]):
            # Чередующийся цвет строк
            row_color = '#f9fafb' if idx % 2 == 0 else 'white'
            draw.rectangle([padding, y, table_width - padding, y + row_height], 
                         fill=row_color, outline='#e5e7eb', width=1)
            
            x = padding
            # Определяем позицию в топ-3 для кубка
            employee = str(idle.get('employee', ''))
            global_index = top_leaders_employees.index(employee) if employee in top_leaders_employees else -1
            trophy = '🥇' if global_index == 0 else ('🥈' if global_index == 1 else ('🥉' if global_index == 2 else ''))
            row_number = idx + 1
            
            # № (с кубком если топ-3)
            number_text = f"#{row_number}"
            bbox_num = draw.textbbox((0, 0), number_text, font=font_normal)
            num_width = bbox_num[2] - bbox_num[0]
            num_x = x + (col_widths[0] - num_width) // 2
            # Рисуем фон для номера (синий градиент)
            draw.rectangle([num_x - 3, y + 4, num_x + num_width + 3, y + 20], 
                         fill='#3b82f6', outline='#2563eb', width=1)
            draw.text((num_x, y + 8), number_text, fill='white', font=font_normal)
            # Рисуем кубок слева от номера, если есть
            if trophy:
                trophy_x = x + 5
                bbox_trophy = draw.textbbox((0, 0), trophy, font=font_large)
                trophy_y = y + 6
                draw.text((trophy_x, trophy_y), trophy, fill='black', font=font_large)
            x += col_widths[0]
            
            # Сотрудник
            employee_text = employee[:25]  # Ограничиваем длину
            draw.text((x + 5, y + 8), employee_text, fill='#1f2937', font=font_normal)
            x += col_widths[1]
            
            # С (время начала)
            from_text = str(idle.get('from', ''))
            draw.text((x + 5, y + 8), from_text, fill='#374151', font=font_normal)
            x += col_widths[1]
            
            # До (время окончания)
            to_text = str(idle.get('to', ''))
            draw.text((x + 5, y + 8), to_text, fill='#374151', font=font_normal)
            x += col_widths[2]
            
            # Длительность (выделяем цветом)
            duration_text = str(idle.get('duration_formatted', ''))
            draw.text((x + 5, y + 8), duration_text, fill='#ea580c', font=font_normal)
            
            y += row_height
        
        # Если простоев больше, чем помещается, добавляем примечание
        if len(idle_times) > max_rows:
            note_text = f"... и еще {len(idle_times) - max_rows} простоев"
            draw.text((padding + 5, y + 5), note_text, fill='#6b7280', font=font_normal)
        
        # Сохраняем во временный файл
        tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.png')
        img.save(tmp_file.name, 'PNG', optimize=True)
        tmp_file.close()
        
        return tmp_file.name
    except Exception as e:
        app.logger.error(f"Ошибка при создании скриншота простоев: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        return None


@app.route("/idle_times_html/<date_str>", methods=["GET"])
def get_idle_times_html(date_str: str):
    """Возвращает HTML таблицу простоев для указанной компании и даты."""
    try:
        company = request.args.get('company', '')
        if not company:
            return {"error": "company parameter required"}, 400
        
        # Получаем простои
        idle_response = get_idle_times(date_str)
        if isinstance(idle_response, tuple):
            idle_data = idle_response[0]
        else:
            idle_data = idle_response
        
        if not idle_data.get("idle_times"):
            return {"error": "no_idle_times", "html": ""}, 404
        
        # Фильтруем по компании
        company_idles = [idle for idle in idle_data["idle_times"] if idle.get("company") == company]
        
        if not company_idles:
            return {"error": "no_idle_times_for_company", "html": ""}, 404
        
        # Создаем HTML таблицу
        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body {{
                    font-family: system-ui, -apple-system, sans-serif;
                    margin: 0;
                    padding: 20px;
                    background: white;
                }}
                h1 {{
                    background: #3b82f6;
                    color: white;
                    padding: 15px;
                    margin: 0 0 20px 0;
                    border-radius: 4px;
                }}
                table {{
                    width: 100%;
                    border-collapse: collapse;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }}
                th {{
                    background: #1e40af;
                    color: white;
                    padding: 12px;
                    text-align: left;
                    font-weight: bold;
                }}
                td {{
                    padding: 10px 12px;
                    border-bottom: 1px solid #e5e7eb;
                }}
                tr:nth-child(even) {{
                    background: #f9fafb;
                }}
                tr:hover {{
                    background: #f3f4f6;
                }}
                .duration {{
                    color: #ea580c;
                    font-weight: bold;
                }}
            </style>
        </head>
        <body>
            <h1>⏱️ Простои более 10 мин - {company} ({date_str})</h1>
            <table>
                <thead>
                    <tr>
                        <th>Сотрудник</th>
                        <th>С</th>
                        <th>До</th>
                        <th>Длительность</th>
                    </tr>
                </thead>
                <tbody>
        """
        
        for idle in company_idles[:100]:  # Максимум 100 строк
            html += f"""
                    <tr>
                        <td>{idle.get('employee', '')}</td>
                        <td>{idle.get('from', '')}</td>
                        <td>{idle.get('to', '')}</td>
                        <td class="duration">{idle.get('duration_formatted', '')}</td>
                    </tr>
            """
        
        html += """
                </tbody>
            </table>
        </body>
        </html>
        """
        
        return {"html": html, "company": company, "date": date_str, "count": len(company_idles)}
    except Exception as e:
        app.logger.error(f"Ошибка при создании HTML таблицы простоев: {e}")
        return {"error": str(e), "html": ""}, 500




@app.route("/idle_times/<date_str>", methods=["GET"])
def get_idle_times(date_str: str):
    """Получает все простои сотрудников более 10 минут за указанную дату."""
    try:
        # Получаем данные задач
        df = _load_day_df(date_str)
        if df is None or df.empty:
            return {"error": "no_data", "message": "Нет данных за указанную дату", "idle_times": []}, 404
        
        # Загружаем маппинг сотрудников
        employee_company_map = {}
        candidate_path = _get_employees_file_path()
        if candidate_path:
            try:
                emp_df = _try_read_employees(candidate_path)
                if emp_df is not None:
                    mapping = _extract_employees_mapping(emp_df)
                    if mapping is not None and not mapping.empty:
                        for _, row in mapping.iterrows():
                            emp_code = str(row["Утвердил"]).strip()
                            company = str(row.get("Компания", "")).strip() if "Компания" in row else ""
                            if emp_code and company:
                                employee_company_map[emp_code] = company
            except Exception as e:
                app.logger.error(f"Ошибка при загрузке маппинга сотрудников: {e}")
        
        # Находим нужные колонки
        approver_col = None
        time_col = None
        
        for col in df.columns:
            col_lower = col.lower().strip()
            col_clean = col_lower.replace(':', '').replace('.', '').replace(' ', '')
            if 'утвердил' in col_clean or 'approver' in col_clean:
                approver_col = col
            if 'время' in col_clean and ('подтвержд' in col_clean or 'confirmation' in col_clean):
                time_col = col
        
        if not approver_col or not time_col:
            return {"error": "columns_not_found", "message": "Не найдены необходимые колонки", "idle_times": []}, 404
        
        # Группируем задачи по сотрудникам
        employees_tasks: Dict[str, List[Dict]] = {}
        for idx, row in df.iterrows():
            employee = str(row.get(approver_col, '')).strip()
            time_val = str(row.get(time_col, '')).strip()
            
            if pd.isna(employee) or pd.isna(time_val) or not employee or not time_val:
                continue
            
            # Пропускаем заголовок
            if employee.lower() == 'утвердил' or 'утвердил' in employee.lower():
                continue
            
            if employee not in employees_tasks:
                employees_tasks[employee] = []
            
            employees_tasks[employee].append({
                "time": time_val,
                "employee": employee
            })
        
        # Анализируем простои для каждого сотрудника
        idle_times_list = []
        
        def time_to_seconds(time_str: str) -> int:
            parts = time_str.split(':')
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + (int(parts[2]) if len(parts) > 2 else 0)
        
        for employee, tasks in employees_tasks.items():
            if len(tasks) < 2:
                continue
            
            # Сортируем задачи по времени
            sorted_tasks = sorted(tasks, key=lambda x: time_to_seconds(x["time"]))
            
            for i in range(1, len(sorted_tasks)):
                prev_time = sorted_tasks[i - 1]["time"]
                curr_time = sorted_tasks[i]["time"]
                diff_seconds = abs(time_to_seconds(curr_time) - time_to_seconds(prev_time))
                
                # Простой более 10 минут (600 секунд)
                if diff_seconds > 600:
                    company = employee_company_map.get(employee, '')
                    idle_times_list.append({
                        "employee": employee,
                        "company": company,
                        "from": prev_time,
                        "to": curr_time,
                        "duration_seconds": diff_seconds,
                        "duration_formatted": f"{diff_seconds // 3600} ч {(diff_seconds % 3600) // 60} мин {diff_seconds % 60} сек"
                    })
        
        # Сортируем по длительности простоя (по убыванию)
        idle_times_list.sort(key=lambda x: x["duration_seconds"], reverse=True)
        
        return {
            "date": date_str,
            "idle_times": idle_times_list,
            "total_idle_times": len(idle_times_list)
        }
    except Exception as e:
        import traceback
        app.logger.error(f"Ошибка при получении простоев: {e}")
        app.logger.error(traceback.format_exc())
        return {"error": str(e), "idle_times": []}, 500


@app.route("/upload_employees", methods=["POST"]) 
def upload_employees():
	"""Загрузка файла соответствия "Утвердил" -> "Компания"."""
	if "file" not in request.files:
		flash("Файл не был отправлен.", "danger")
		return redirect(url_for("index"))
	file = request.files["file"]
	if file.filename == "":
		flash("Не выбрано имя файла.", "danger")
		return redirect(url_for("index"))
	filename = secure_filename(file.filename)
	try:
		# Сохраняем с исходным расширением, поддерживаем CSV и XLSX
		ext = os.path.splitext(filename)[1].lower()
		save_path = EMPLOYEES_FILE_PATH if ext not in {'.xlsx', '.xls'} else EMPLOYEES_XLSX_PATH
		file.save(save_path)
		flash("Файл сотрудников сохранён.", "success")
	except Exception as e:
		flash(f"Не удалось сохранить файл: {e}", "danger")
	return redirect(url_for("index"))

if __name__ == "__main__":
	# Запуск локального сервера для разработки
	default_port = 5050
	# Используем только ANALYZ_PORT, игнорируем PORT чтобы не конфликтовать с Backend
	port = int(os.environ.get("ANALYZ_PORT", default_port))
	app.run(host=os.environ.get("ANALYZ_HOST", "0.0.0.0"), port=port, debug=True)



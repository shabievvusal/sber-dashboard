import os
import urllib.parse
import requests
from flask import Blueprint, jsonify, request, render_template, Response
from typing import Optional

# Импортируем функции работы с БД из db.py
from db import get_db_connection, release_db_connection, ensure_schema, get_param_placeholder

# Создаем Blueprint
barcode_bp = Blueprint('barcode', __name__, url_prefix='/barcode')

# ensure_schema теперь импортируется из db.py

# Ensure DB schema exists at startup
try:
    ensure_schema()
    import sys
    use_postgres = os.environ.get("BARCODE_USE_POSTGRES", "false").lower() == "true"
    if use_postgres:
        print(f"INFO: Barcode database schema initialized successfully in PostgreSQL", file=sys.stderr)
    else:
        db_path = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "..", "..", "database.sqlite3"))
        print(f"INFO: Barcode database schema initialized successfully at {db_path}", file=sys.stderr)
except Exception as e:
    import sys
    print(f"ERROR: Could not initialize barcode database schema: {e}", file=sys.stderr)
    print(f"Barcode generator may not work until database is accessible.", file=sys.stderr)

@barcode_bp.route("/")
def index():
    # compact режим для встраивания (оператор/менеджер)
    compact_param = request.args.get("compact", "").lower()
    compact = compact_param in ("1", "true", "yes")
    
    # Определяем базовый путь для API запросов
    # Если запрос идет через прокси /integrations/analyz, используем его
    base_path = request.headers.get('X-Forwarded-Prefix', '')
    if not base_path:
        # Проверяем Referer
        referer = request.headers.get('Referer', '')
        if '/integrations/analyz' in referer:
            base_path = '/integrations/analyz'
        else:
            # Если путь /barcode (без /integrations/analyz), значит через прокси
            # Базовый путь должен быть /integrations/analyz
            base_path = '/integrations/analyz'
    
    return render_template("barcode/index.html", compact=compact, base_path=base_path)

@barcode_bp.route("/test")
def test():
    return render_template("barcode/test.html")

@barcode_bp.route("/favicon.ico")
def favicon():
    from flask import send_from_directory
    return send_from_directory(".", "favicon.ico", mimetype="image/vnd.microsoft.icon")

@barcode_bp.route("/api/search")
def search_barcode():
    query = request.args.get("query", "").strip()
    if not query:
        return jsonify({"error": "query is required"}), 400

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        param = get_param_placeholder()

        # First try to find by barcode
        cur.execute(
            "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE barcode = " + param,
            (query,),
        )
        row = cur.fetchone()
        
        if row:
            # Found by barcode, get all products with same group_code
            group_code = row[1]
            cur.execute(
                "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE group_code = " + param + " ORDER BY quantity ASC",
                (group_code,),
            )
            rows = cur.fetchall()
            cur.close()

            products = [
                {
                    "id": r[0],
                    "group_code": r[1],
                    "product_name": r[2],
                    "barcode": r[3],
                    "quantity": r[4],
                }
                for r in rows
            ]

            return jsonify({
                "found": True,
                "search_type": "barcode",
                "group_code": group_code,
                "products": products,
            })
        else:
            # Try to find by group_code
            cur.execute(
                "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE group_code = " + param + " ORDER BY quantity ASC",
                (query,),
            )
            rows = cur.fetchall()
            cur.close()

            if rows:
                products = [
                    {
                        "id": r[0],
                        "group_code": r[1],
                        "product_name": r[2],
                        "barcode": r[3],
                        "quantity": r[4],
                    }
                    for r in rows
                ]

                return jsonify({
                    "found": True,
                    "search_type": "group_code",
                    "group_code": query,
                    "products": products,
                })
            else:
                return jsonify({"found": False, "message": "Barcode or group code not found"}), 404
    except Exception as e:
        import sys
        print(f"ERROR: Cannot connect to barcode database: {e}", file=sys.stderr)
        return jsonify({"error": "Database connection failed", "details": str(e)}), 500
    finally:
        if conn:
            release_db_connection(conn)

@barcode_bp.route("/api/generate-barcode", methods=["POST"])
def generate_barcode():
    data = request.get_json()
    base_code = data.get("base_code", "").strip()
    quantity = data.get("quantity", 0)
    
    if not base_code or not quantity:
        return jsonify({"success": False, "message": "Missing base_code or quantity"}), 400
    
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        param = get_param_placeholder()
        
        # First try to find by barcode
        cur.execute(
            "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE barcode = " + param,
            (base_code,),
        )
        row = cur.fetchone()
        
        if row:
            # Found by barcode, get all products with same group_code
            group_code = row[1]
            cur.execute(
                "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE group_code = " + param + " AND quantity = " + param,
                (group_code, quantity),
            )
            target_row = cur.fetchone()
            
            if target_row:
                # Found the specific barcode with quantity
                barcode_string = target_row[3]  # Use the actual barcode from database
                
                # Generate barcode image URL
                barcode_url = f"https://barcode.tec-it.com/barcode.ashx?data={urllib.parse.quote(barcode_string)}&code=Code128&dpi=150&format=PNG"
                
                cur.close()
                return jsonify({
                    "success": True,
                    "barcode_string": barcode_string,
                    "image": barcode_url,
                    "product_name": target_row[2]  # Добавляем название продукта
                })
            else:
                cur.close()
                return jsonify({"success": False, "message": f"Barcode with quantity {quantity} not found for group {group_code}"}), 404
        else:
            # Try to find by group_code
            cur.execute(
                "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE group_code = " + param + " AND quantity = " + param,
                (base_code, quantity),
            )
            target_row = cur.fetchone()
            
            if target_row:
                # Found the specific barcode with quantity
                barcode_string = target_row[3]  # Use the actual barcode from database
                
                # Generate barcode image URL
                barcode_url = f"https://barcode.tec-it.com/barcode.ashx?data={urllib.parse.quote(barcode_string)}&code=Code128&dpi=150&format=PNG"
                
                cur.close()
                return jsonify({
                    "success": True,
                    "barcode_string": barcode_string,
                    "image": barcode_url,
                    "product_name": target_row[2]  # Добавляем название продукта
                })
            else:
                cur.close()
                return jsonify({"success": False, "message": f"Barcode with quantity {quantity} not found for group {base_code}"}), 404
    except Exception as e:
        import sys
        print(f"ERROR: Database query failed: {e}", file=sys.stderr)
        return jsonify({"success": False, "message": "Database query failed", "details": str(e)}), 500
    finally:
        if conn:
            release_db_connection(conn)

@barcode_bp.route("/api/save-barcode", methods=["POST"])
def save_barcode():
    data = request.get_json()
    base_code = data.get("base_code", "").strip()
    quantity = data.get("quantity", 0)
    scale = data.get("scale", 1.0)  # Add scale parameter
    
    if not base_code or not quantity:
        return jsonify({"success": False, "message": "Missing base_code or quantity"}), 400
    
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        param = get_param_placeholder()
        
        # First try to find by barcode
        cur.execute(
            "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE barcode = " + param,
            (base_code,),
        )
        row = cur.fetchone()
        
        if row:
            # Found by barcode, get all products with same group_code
            group_code = row[1]
            cur.execute(
                "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE group_code = " + param + " AND quantity = " + param,
                (group_code, quantity),
            )
            target_row = cur.fetchone()
            
            if target_row:
                # Found the specific barcode with quantity
                barcode_string = target_row[3]  # Use the actual barcode from database
            else:
                cur.close()
                return jsonify({"success": False, "message": f"Barcode with quantity {quantity} not found for group {group_code}"}), 404
        else:
            # Try to find by group_code
            cur.execute(
                "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE group_code = " + param + " AND quantity = " + param,
                (base_code, quantity),
            )
            target_row = cur.fetchone()
            
            if target_row:
                # Found the specific barcode with quantity
                barcode_string = target_row[3]  # Use the actual barcode from database
            else:
                cur.close()
                return jsonify({"success": False, "message": f"Barcode with quantity {quantity} not found for group {base_code}"}), 404
    except Exception as e:
        import sys
        print(f"ERROR: Database query failed: {e}", file=sys.stderr)
        return jsonify({"success": False, "message": "Database query failed", "details": str(e)}), 500
    finally:
        if conn:
            release_db_connection(conn)
    
    # Generate barcode image URL with scale
    # Calculate width based on scale (default width is around 300px)
    width = int(300 * scale)
    barcode_url = f"https://barcode.tec-it.com/barcode.ashx?data={urllib.parse.quote(barcode_string)}&code=Code128&dpi=150&format=PNG&width={width}"
    
    # Download and return the image
    try:
        response = requests.get(barcode_url)
        if response.status_code == 200:
            return Response(
                response.content,
                mimetype='image/png',
                headers={'Content-Disposition': f'attachment; filename=barcode_{barcode_string}.png'}
            )
        else:
            return jsonify({"success": False, "message": "Failed to generate barcode image"}), 500
    except Exception as e:
        return jsonify({"success": False, "message": f"Error generating barcode: {str(e)}"}), 500

@barcode_bp.route("/api/upload-data", methods=["POST"])
def upload_barcode_data():
    """Загрузка и импорт Excel файла с данными штрихкодов."""
    if 'file' not in request.files:
        return jsonify({"success": False, "message": "Файл не был отправлен"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"success": False, "message": "Имя файла пустое"}), 400
    
    # Проверка типа файла
    filename = file.filename.lower()
    if not (filename.endswith('.xlsx') or filename.endswith('.xls')):
        return jsonify({"success": False, "message": "Разрешены только Excel файлы (.xlsx, .xls)"}), 400
    
    try:
        # Сохраняем файл во временную директорию
        import tempfile
        import shutil
        
        # Создаем временный файл
        with tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx') as tmp_file:
            file.save(tmp_file.name)
            tmp_path = tmp_file.name
        
        try:
            # Импортируем данные
            # Добавляем путь к модулю import_data в sys.path
            import sys
            analyz_data_path = os.path.join(os.path.dirname(__file__), "..", "..")
            analyz_data_path = os.path.abspath(analyz_data_path)
            if analyz_data_path not in sys.path:
                sys.path.insert(0, analyz_data_path)
            
            # Получаем количество записей перед импортом (после обработки дубликатов)
            import pandas as pd
            df = pd.read_excel(tmp_path, engine="openpyxl", header=None)
            df = df.iloc[:, :4]
            df.columns = ["group_code", "product_name", "barcode", "quantity"]
            df = df.dropna(how="all")
            df = df.dropna(subset=["group_code", "barcode", "quantity"])
            # Удаляем дубликаты для подсчета
            df = df.drop_duplicates(subset=["barcode"], keep="last")
            record_count = len(df)
            
            # Импортируем данные
            from import_data import import_excel_file
            import_excel_file(tmp_path)
            
            return jsonify({
                "success": True,
                "message": f"Данные успешно импортированы в базу данных ({record_count} записей)"
            }), 200
        finally:
            # Удаляем временный файл
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
                
    except Exception as e:
        import sys
        print(f"ERROR: Failed to import barcode data: {e}", file=sys.stderr)
        return jsonify({
            "success": False,
            "message": f"Ошибка при импорте данных: {str(e)}"
        }), 500

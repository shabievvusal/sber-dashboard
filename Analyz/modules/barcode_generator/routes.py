import os
import sqlite3
import urllib.parse
import requests
from flask import Blueprint, jsonify, request, render_template, Response
from typing import Optional

# Создаем Blueprint
barcode_bp = Blueprint('barcode', __name__, url_prefix='/barcode')

# Absolute path to the SQLite database file used by the app
# В Docker используем /app/data/database.sqlite3, локально - относительный путь
_default_db_path = os.path.join(os.path.dirname(__file__), "..", "..", "database.sqlite3")
DB_PATH = os.environ.get("DB_PATH", _default_db_path)
# Если путь относительный, делаем его абсолютным
if not os.path.isabs(DB_PATH):
    DB_PATH = os.path.abspath(DB_PATH)

def get_db_connection(timeout_seconds: Optional[float] = 5.0) -> sqlite3.Connection:
    """Return a new SQLite connection to the app database."""
    conn = sqlite3.connect(DB_PATH, timeout=timeout_seconds)
    return conn

def ensure_schema() -> None:
    """Ensure the required database schema exists."""
    try:
        # Создаем директорию для базы данных, если её нет
        db_dir = os.path.dirname(DB_PATH)
        if db_dir and db_dir != DB_PATH:  # Проверяем, что это не сам файл
            os.makedirs(db_dir, exist_ok=True)
            # Проверяем права на запись
            if not os.access(db_dir, os.W_OK):
                raise PermissionError(f"No write permission for directory: {db_dir}")
        
        # SQLite создаст файл автоматически при подключении, но проверим права
        if os.path.exists(DB_PATH):
            if not os.access(DB_PATH, os.W_OK):
                raise PermissionError(f"No write permission for database file: {DB_PATH}")
        else:
            # Проверяем, можем ли мы создать файл в директории
            test_file = os.path.join(db_dir, '.test_write')
            try:
                with open(test_file, 'w') as f:
                    f.write('test')
                os.remove(test_file)
            except Exception as e:
                raise PermissionError(f"Cannot create database file in {db_dir}: {e}")
        
        conn = sqlite3.connect(DB_PATH)
    except Exception as e:
        import sys
        print(f"ERROR: Cannot create/open database at {DB_PATH}: {e}", file=sys.stderr)
        print(f"DB_PATH environment variable: {os.environ.get('DB_PATH', 'not set')}", file=sys.stderr)
        print(f"Current working directory: {os.getcwd()}", file=sys.stderr)
        print(f"Directory exists: {os.path.exists(db_dir) if 'db_dir' in locals() else 'N/A'}", file=sys.stderr)
        raise
    cur = conn.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_code TEXT NOT NULL,
            product_name TEXT,
            barcode TEXT NOT NULL UNIQUE,
            quantity INTEGER NOT NULL
        );
        """
    )

    # Helpful indexes for common queries
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_products_group_code ON products(group_code);
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_products_group_qty ON products(group_code, quantity);
        """
    )

    conn.commit()
    conn.close()

# Ensure DB schema exists at startup
try:
    ensure_schema()
except Exception as e:
    import sys
    print(f"WARNING: Could not initialize barcode database schema: {e}", file=sys.stderr)
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

    try:
        conn = get_db_connection()
    except Exception as e:
        import sys
        print(f"ERROR: Cannot connect to barcode database: {e}", file=sys.stderr)
        return jsonify({"error": "Database connection failed", "details": str(e)}), 500
    cur = conn.cursor()

    # First try to find by barcode
    cur.execute(
        "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE barcode = ?",
        (query,),
    )
    row = cur.fetchone()
    
    if row:
        # Found by barcode, get all products with same group_code
        group_code = row[1]
        cur.execute(
            "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE group_code = ? ORDER BY quantity ASC",
            (group_code,),
        )
        rows = cur.fetchall()
        conn.close()

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
            "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE group_code = ? ORDER BY quantity ASC",
            (query,),
        )
        rows = cur.fetchall()
        conn.close()

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

@barcode_bp.route("/api/generate-barcode", methods=["POST"])
def generate_barcode():
    data = request.get_json()
    base_code = data.get("base_code", "").strip()
    quantity = data.get("quantity", 0)
    
    if not base_code or not quantity:
        return jsonify({"success": False, "message": "Missing base_code or quantity"}), 400
    
    # Find the barcode in database
    try:
        conn = get_db_connection()
    except Exception as e:
        import sys
        print(f"ERROR: Cannot connect to barcode database: {e}", file=sys.stderr)
        return jsonify({"success": False, "message": "Database connection failed", "details": str(e)}), 500
    
    try:
        cur = conn.cursor()
        
        # First try to find by barcode
        cur.execute(
            "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE barcode = ?",
            (base_code,),
        )
        row = cur.fetchone()
        
        if row:
            # Found by barcode, get all products with same group_code
            group_code = row[1]
            cur.execute(
                "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE group_code = ? AND quantity = ?",
                (group_code, quantity),
            )
            target_row = cur.fetchone()
            
            if target_row:
                # Found the specific barcode with quantity
                barcode_string = target_row[3]  # Use the actual barcode from database
                
                # Generate barcode image URL
                barcode_url = f"https://barcode.tec-it.com/barcode.ashx?data={urllib.parse.quote(barcode_string)}&code=Code128&dpi=150&format=PNG"
                
                conn.close()
                return jsonify({
                    "success": True,
                    "barcode_string": barcode_string,
                    "image": barcode_url,
                    "product_name": target_row[2]  # Добавляем название продукта
                })
            else:
                conn.close()
                return jsonify({"success": False, "message": f"Barcode with quantity {quantity} not found for group {group_code}"}), 404
        else:
            # Try to find by group_code
            cur.execute(
                "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE group_code = ? AND quantity = ?",
                (base_code, quantity),
            )
            target_row = cur.fetchone()
            
            if target_row:
                # Found the specific barcode with quantity
                barcode_string = target_row[3]  # Use the actual barcode from database
                
                # Generate barcode image URL
                barcode_url = f"https://barcode.tec-it.com/barcode.ashx?data={urllib.parse.quote(barcode_string)}&code=Code128&dpi=150&format=PNG"
                
                conn.close()
                return jsonify({
                    "success": True,
                    "barcode_string": barcode_string,
                    "image": barcode_url,
                    "product_name": target_row[2]  # Добавляем название продукта
                })
            else:
                conn.close()
                return jsonify({"success": False, "message": f"Barcode with quantity {quantity} not found for group {base_code}"}), 404
    except Exception as e:
        if conn:
            conn.close()
        import sys
        print(f"ERROR: Database query failed: {e}", file=sys.stderr)
        return jsonify({"success": False, "message": "Database query failed", "details": str(e)}), 500

@barcode_bp.route("/api/save-barcode", methods=["POST"])
def save_barcode():
    data = request.get_json()
    base_code = data.get("base_code", "").strip()
    quantity = data.get("quantity", 0)
    scale = data.get("scale", 1.0)  # Add scale parameter
    
    if not base_code or not quantity:
        return jsonify({"success": False, "message": "Missing base_code or quantity"}), 400
    
    # Find the barcode in database
    try:
        conn = get_db_connection()
    except Exception as e:
        import sys
        print(f"ERROR: Cannot connect to barcode database: {e}", file=sys.stderr)
        return jsonify({"success": False, "message": "Database connection failed", "details": str(e)}), 500
    
    try:
        cur = conn.cursor()
        
        # First try to find by barcode
        cur.execute(
            "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE barcode = ?",
            (base_code,),
        )
        row = cur.fetchone()
        
        if row:
            # Found by barcode, get all products with same group_code
            group_code = row[1]
            cur.execute(
                "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE group_code = ? AND quantity = ?",
                (group_code, quantity),
            )
            target_row = cur.fetchone()
            
            if target_row:
                # Found the specific barcode with quantity
                barcode_string = target_row[3]  # Use the actual barcode from database
            else:
                conn.close()
                return jsonify({"success": False, "message": f"Barcode with quantity {quantity} not found for group {group_code}"}), 404
        else:
            # Try to find by group_code
            cur.execute(
                "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE group_code = ? AND quantity = ?",
                (base_code, quantity),
            )
            target_row = cur.fetchone()
            
            if target_row:
                # Found the specific barcode with quantity
                barcode_string = target_row[3]  # Use the actual barcode from database
            else:
                conn.close()
                return jsonify({"success": False, "message": f"Barcode with quantity {quantity} not found for group {base_code}"}), 404
    except Exception as e:
        if conn:
            conn.close()
        import sys
        print(f"ERROR: Database query failed: {e}", file=sys.stderr)
        return jsonify({"success": False, "message": "Database query failed", "details": str(e)}), 500
    
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

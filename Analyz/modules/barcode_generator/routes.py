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
    # Создаем директорию для базы данных, если её нет
    db_dir = os.path.dirname(DB_PATH)
    if db_dir and db_dir != DB_PATH:  # Проверяем, что это не сам файл
        os.makedirs(db_dir, exist_ok=True)
    
    # Создаем файл базы данных, если его нет
    if not os.path.exists(DB_PATH):
        # Создаем пустой файл
        open(DB_PATH, 'a').close()
    
    conn = sqlite3.connect(DB_PATH)
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
ensure_schema()

@barcode_bp.route("/")
def index():
    # compact режим для встраивания (оператор/менеджер)
    compact_param = request.args.get("compact", "").lower()
    compact = compact_param in ("1", "true", "yes")
    return render_template("barcode/index.html", compact=compact)

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

    conn = get_db_connection()
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
    conn = get_db_connection()
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
        conn.close()
        
        if target_row:
            # Found the specific barcode with quantity
            barcode_string = target_row[3]  # Use the actual barcode from database
            
            # Generate barcode image URL
            barcode_url = f"https://barcode.tec-it.com/barcode.ashx?data={urllib.parse.quote(barcode_string)}&code=Code128&dpi=150&format=PNG"
            
            return jsonify({
                "success": True,
                "barcode_string": barcode_string,
                "image": barcode_url,
                "product_name": target_row[2]  # Добавляем название продукта
            })
        else:
            return jsonify({"success": False, "message": f"Barcode with quantity {quantity} not found for group {group_code}"}), 404
    else:
        # Try to find by group_code
        cur.execute(
            "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE group_code = ? AND quantity = ?",
            (base_code, quantity),
        )
        target_row = cur.fetchone()
        conn.close()
        
        if target_row:
            # Found the specific barcode with quantity
            barcode_string = target_row[3]  # Use the actual barcode from database
            
            # Generate barcode image URL
            barcode_url = f"https://barcode.tec-it.com/barcode.ashx?data={urllib.parse.quote(barcode_string)}&code=Code128&dpi=150&format=PNG"
            
            return jsonify({
                "success": True,
                "barcode_string": barcode_string,
                "image": barcode_url,
                "product_name": target_row[2]  # Добавляем название продукта
            })
        else:
            return jsonify({"success": False, "message": f"Barcode with quantity {quantity} not found for group {base_code}"}), 404

@barcode_bp.route("/api/save-barcode", methods=["POST"])
def save_barcode():
    data = request.get_json()
    base_code = data.get("base_code", "").strip()
    quantity = data.get("quantity", 0)
    scale = data.get("scale", 1.0)  # Add scale parameter
    
    if not base_code or not quantity:
        return jsonify({"success": False, "message": "Missing base_code or quantity"}), 400
    
    # Find the barcode in database
    conn = get_db_connection()
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
        conn.close()
        
        if target_row:
            # Found the specific barcode with quantity
            barcode_string = target_row[3]  # Use the actual barcode from database
        else:
            return jsonify({"success": False, "message": f"Barcode with quantity {quantity} not found for group {group_code}"}), 404
    else:
        # Try to find by group_code
        cur.execute(
            "SELECT id, group_code, product_name, barcode, quantity FROM products WHERE group_code = ? AND quantity = ?",
            (base_code, quantity),
        )
        target_row = cur.fetchone()
        conn.close()
        
        if target_row:
            # Found the specific barcode with quantity
            barcode_string = target_row[3]  # Use the actual barcode from database
        else:
            return jsonify({"success": False, "message": f"Barcode with quantity {quantity} not found for group {base_code}"}), 404
    
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

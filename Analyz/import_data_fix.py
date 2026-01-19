import os
import sys
import pandas as pd
import sqlite3

# Используем относительный путь к базе данных (избегаем проблем с кодировкой)
script_dir = os.path.dirname(os.path.abspath(__file__))
# Используем относительный путь от текущей директории
os.chdir(script_dir)
DB_PATH = "database.sqlite3"  # Относительный путь
EXCEL_PATH = "data.xlsx"  # Относительный путь

print(f"DB_PATH: {DB_PATH}")
print(f"EXCEL_PATH: {EXCEL_PATH}")
print(f"Excel file exists: {os.path.exists(EXCEL_PATH)}")

def ensure_schema():
    """Ensure the required database schema exists."""
    # Ensure the directory for the DB exists
    db_dir = os.path.dirname(DB_PATH) or '.'
    if db_dir and db_dir != DB_PATH:
        os.makedirs(db_dir, exist_ok=True)
    
    # Create database file if it doesn't exist
    if not os.path.exists(DB_PATH):
        try:
            # Try to create empty file
            with open(DB_PATH, 'wb') as f:
                pass
        except Exception as e:
            print(f"Warning: Could not create database file: {e}")
    
    # Connect to database using relative path
    try:
        conn = sqlite3.connect(DB_PATH, timeout=10.0)
    except Exception as e:
        print(f"Error connecting to database: {e}")
        print(f"DB_PATH: {DB_PATH}")
        print(f"Current directory: {os.getcwd()}")
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
    print("Schema ensured successfully")

def import_excel_to_sqlite(excel_path: str) -> None:
    if not os.path.exists(excel_path):
        print(f"Excel file not found: {excel_path}")
        sys.exit(1)
    
    ensure_schema()
    
    # Read Excel: expect columns A-D as described
    # A: group_code, B: product_name (optional), C: barcode, D: quantity
    print("Reading Excel file...")
    df = pd.read_excel(excel_path, engine="openpyxl", header=None)
    
    # Normalize dataframe to expected columns
    # Ensure at least 4 columns
    for _ in range(max(0, 4 - df.shape[1])):
        df[df.shape[1]] = None
    
    df = df.iloc[:, :4]
    df.columns = ["group_code", "product_name", "barcode", "quantity"]
    
    # Drop completely empty rows
    df = df.dropna(how="all")
    
    # Clean types
    df["group_code"] = df["group_code"].astype(str).str.strip()
    # product_name can be NaN -> keep as None
    df["product_name"] = df["product_name"].apply(lambda x: None if pd.isna(x) else str(x).strip())
    # barcode as string without .0 if numeric
    df["barcode"] = df["barcode"].apply(lambda x: str(int(x)) if isinstance(x, float) and x.is_integer() else str(x)).str.strip()
    # quantity as int (coerce errors to NaN then drop)
    df["quantity"] = pd.to_numeric(df["quantity"], errors="coerce").astype('Int64')
    df = df.dropna(subset=["group_code", "barcode", "quantity"])  # must have these
    
    print(f"Processed {len(df)} rows from Excel")
    
    # Подготовка к пакетной вставке
    records = df.to_dict(orient="records")
    
    print(f"Connecting to database: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    # Ускоряющие PRAGMA на время импорта
    cur.execute("PRAGMA journal_mode=WAL;")
    cur.execute("PRAGMA synchronous=OFF;")
    cur.execute("PRAGMA temp_store=MEMORY;")
    
    # Подготовим параметры для executemany
    params = [
        (
            rec["group_code"],
            rec["product_name"],
            rec["barcode"],
            int(rec["quantity"]) if pd.notna(rec["quantity"]) else None,
        )
        for rec in records
    ]
    
    print(f"Importing {len(params)} records...")
    cur.executemany(
        """
        INSERT INTO products (group_code, product_name, barcode, quantity)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(barcode) DO UPDATE SET
            group_code=excluded.group_code,
            product_name=excluded.product_name,
            quantity=excluded.quantity
        """,
        params,
    )
    
    conn.commit()
    conn.close()
    print(f"✅ Successfully imported {len(records)} rows from {excel_path} into {DB_PATH}")

if __name__ == "__main__":
    import_excel_to_sqlite(EXCEL_PATH)


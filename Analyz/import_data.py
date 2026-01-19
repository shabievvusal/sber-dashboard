import os
import sys
import pandas as pd

# Проверяем, используем ли PostgreSQL
USE_POSTGRES = os.environ.get("BARCODE_USE_POSTGRES", "false").lower() == "true"

if USE_POSTGRES:
    import psycopg2
    from psycopg2.extras import execute_values
    from db import get_db_connection, release_db_connection, ensure_schema, get_param_placeholder
else:
    import sqlite3
    from db import DB_PATH, ensure_schema

EXCEL_PATH = os.environ.get("EXCEL_PATH", os.path.join(os.path.dirname(__file__), "data.xlsx"))


def import_excel_to_sqlite(excel_path: str) -> None:
    """Import data from Excel to SQLite (legacy)."""
    if not os.path.exists(excel_path):
        print(f"Excel file not found: {excel_path}")
        sys.exit(1)

    ensure_schema()

    # Read Excel: expect columns A-D as described
    # A: group_code, B: product_name (optional), C: barcode, D: quantity
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

    # Подготовка к пакетной вставке
    records = df.to_dict(orient="records")

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
    print(f"Imported {len(records)} rows from {excel_path} into {DB_PATH}")


def import_excel_to_postgres(excel_path: str) -> None:
    """Import data from Excel to PostgreSQL."""
    if not os.path.exists(excel_path):
        print(f"Excel file not found: {excel_path}")
        sys.exit(1)

    ensure_schema()

    # Read Excel: expect columns A-D as described
    # A: group_code, B: product_name (optional), C: barcode, D: quantity
    print(f"Reading Excel file: {excel_path}")
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

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Подготовим параметры для execute_values (PostgreSQL)
        params = [
            (
                rec["group_code"],
                rec["product_name"],
                rec["barcode"],
                int(rec["quantity"]) if pd.notna(rec["quantity"]) else None,
            )
            for rec in records
        ]

        print(f"Importing {len(params)} records to PostgreSQL...")
        
        # Используем execute_values для быстрой вставки
        execute_values(
            cur,
            """
            INSERT INTO products (group_code, product_name, barcode, quantity)
            VALUES %s
            ON CONFLICT(barcode) DO UPDATE SET
                group_code=EXCLUDED.group_code,
                product_name=EXCLUDED.product_name,
                quantity=EXCLUDED.quantity
            """,
            params,
        )

        conn.commit()
        cur.close()
        print(f"✅ Successfully imported {len(records)} rows from {excel_path} into PostgreSQL")
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"❌ Error importing data: {e}")
        raise
    finally:
        if conn:
            release_db_connection(conn)


if __name__ == "__main__":
    if USE_POSTGRES:
        import_excel_to_postgres(EXCEL_PATH)
    else:
        import_excel_to_sqlite(EXCEL_PATH)


# Функции для использования в других модулях
def import_excel_file(excel_path: str) -> None:
    """Универсальная функция импорта, определяет тип БД автоматически."""
    if USE_POSTGRES:
        import_excel_to_postgres(excel_path)
    else:
        import_excel_to_sqlite(excel_path)

import os
from typing import Optional

# PostgreSQL connection settings
USE_POSTGRES = os.environ.get("BARCODE_USE_POSTGRES", "false").lower() == "true"

if USE_POSTGRES:
    import psycopg2
    from psycopg2 import pool
    POSTGRES_HOST = os.environ.get("POSTGRES_HOST", "localhost")
    POSTGRES_PORT = int(os.environ.get("POSTGRES_PORT", "5432"))
    POSTGRES_USER = os.environ.get("POSTGRES_USER", "ops_user")
    POSTGRES_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "ops_password")
    POSTGRES_DB = os.environ.get("POSTGRES_DB", "ops_db")
    
    # Connection pool для PostgreSQL
    _pg_pool = None
    
    def get_pg_pool():
        global _pg_pool
        if _pg_pool is None:
            _pg_pool = psycopg2.pool.SimpleConnectionPool(
                1, 20,
                host=POSTGRES_HOST,
                port=POSTGRES_PORT,
                user=POSTGRES_USER,
                password=POSTGRES_PASSWORD,
                database=POSTGRES_DB
            )
        return _pg_pool
else:
    # Fallback to SQLite (legacy)
    import sqlite3
    DB_PATH = os.environ.get(
        "DB_PATH",
        os.path.join(os.path.dirname(__file__), "database.sqlite3"),
    )


def get_db_connection(timeout_seconds: Optional[float] = 5.0):
    """Return a database connection (PostgreSQL or SQLite).
    
    Args:
        timeout_seconds: Optional timeout (for SQLite only).
    
    Returns:
        A database connection object.
    """
    if USE_POSTGRES:
        pool = get_pg_pool()
        if pool:
            return pool.getconn()
        else:
            raise Exception("PostgreSQL connection pool not available")
    else:
        # SQLite fallback
        conn = sqlite3.connect(DB_PATH, timeout=timeout_seconds)
        return conn


def release_db_connection(conn):
    """Release a database connection back to the pool (PostgreSQL only)."""
    if USE_POSTGRES and conn:
        pool = get_pg_pool()
        if pool:
            pool.putconn(conn)
    elif not USE_POSTGRES and conn:
        # SQLite - просто закрываем
        conn.close()


def get_param_placeholder():
    """Return the parameter placeholder for the current database type."""
    return "%s" if USE_POSTGRES else "?"


def ensure_schema() -> None:
    """Ensure the required database schema exists.
    
    Creates the `products` table with a unique constraint on `barcode` if it
    does not already exist.
    """
    if USE_POSTGRES:
        conn = None
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS products (
                    id SERIAL PRIMARY KEY,
                    group_code TEXT NOT NULL,
                    product_name TEXT,
                    barcode TEXT NOT NULL UNIQUE,
                    quantity INTEGER NOT NULL
                );
                """
            )
            
            # Create indexes
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
            cur.close()
        except Exception as e:
            if conn:
                conn.rollback()
            raise e
        finally:
            if conn:
                release_db_connection(conn)
    else:
        # SQLite fallback
        import sqlite3
        # Ensure the directory for the DB exists
        db_dir = os.path.dirname(DB_PATH)
        if db_dir and db_dir != DB_PATH:
            os.makedirs(db_dir, exist_ok=True)
        
        # Create database file if it doesn't exist
        if not os.path.exists(DB_PATH):
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

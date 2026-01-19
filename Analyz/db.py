import os
import sqlite3
from typing import Optional


# Absolute path to the SQLite database file used by the app
DB_PATH = os.environ.get(
	"DB_PATH",
	os.path.join(os.path.dirname(__file__), "database.sqlite3"),
)


def get_db_connection(timeout_seconds: Optional[float] = 5.0) -> sqlite3.Connection:
	"""Return a new SQLite connection to the app database.

	Args:
		timeout_seconds: Optional timeout while waiting for the database lock.

	Returns:
		A sqlite3.Connection object.
	"""
	conn = sqlite3.connect(DB_PATH, timeout=timeout_seconds)
	# Return rows as tuples for performance; dict mapping is done in app code
	return conn


def ensure_schema() -> None:
	"""Ensure the required database schema exists.

	Creates the `products` table with a unique constraint on `barcode` if it
	does not already exist.
	"""
	# Ensure the directory for the DB exists (in case of custom DB_PATH)
	os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

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




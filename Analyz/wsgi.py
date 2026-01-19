#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
from app import app

if __name__ == "__main__":
    # Явно указываем порт 5050 для Analyz
    default_port = 5050
    port = int(os.environ.get("ANALYZ_PORT", default_port))
    host = os.environ.get("ANALYZ_HOST", "0.0.0.0")
    app.run(host=host, port=port, debug=False)


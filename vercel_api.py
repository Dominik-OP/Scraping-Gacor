"""WSGI entrypoint for the Python service in the shared Vercel deployment."""

import io
import os
from email.message import Message
from http import HTTPStatus
from threading import Lock

from app import DashboardHandler, init_db

_initialized = False
_init_lock = Lock()


class ResponseHandler(DashboardHandler):
    """Reuse the API routes with WSGI request and response streams."""

    def send_response(self, code, message=None):
        self.response_status = f"{code} {message or HTTPStatus(code).phrase}"
        self.response_headers = []

    def send_header(self, keyword, value):
        self.response_headers.append((keyword, str(value)))

    def end_headers(self):
        pass


def app(environ, start_response):
    global _initialized
    if os.getenv("VERCEL") and not os.getenv("DATABASE_URL", "").strip():
        start_response("503 Service Unavailable", [("Content-Type", "application/json")])
        return [b'{"error":"The database is not configured. Contact your administrator."}']
    with _init_lock:
        if not _initialized:
            try:
                init_db()
            except Exception as error:
                safe_errors = {
                    "DATABASE_URL must be a PostgreSQL connection string",
                    "Install PostgreSQL dependencies: pip install -r requirements.txt",
                }
                reason = str(error) if str(error) in safe_errors else type(error).__name__
                print(f"Database startup failed: {reason}; SQLSTATE={getattr(error, 'sqlstate', None)}; "
                      f"cause={type(error.__cause__).__name__}", flush=True)
                start_response("503 Service Unavailable", [("Content-Type", "application/json")])
                return [b'{"error":"The database is unavailable. Try again shortly."}']
            _initialized = True
    handler = ResponseHandler.__new__(ResponseHandler)
    handler.command = environ["REQUEST_METHOD"]
    handler.request_version = "HTTP/1.1"
    handler.path = environ.get("PATH_INFO", "/")
    if environ.get("QUERY_STRING"):
        handler.path += "?" + environ["QUERY_STRING"]
    handler.headers = Message()
    for key, value in environ.items():
        if key.startswith("HTTP_"):
            handler.headers[key[5:].replace("_", "-")] = value
    handler.headers["Content-Length"] = environ.get("CONTENT_LENGTH") or "0"
    handler.headers["Content-Type"] = environ.get("CONTENT_TYPE") or "application/json"
    handler.rfile = environ["wsgi.input"]
    handler.wfile = io.BytesIO()
    method = getattr(handler, f"do_{handler.command}", None)
    if method is None:
        handler.send_json({"error": "Method not allowed."}, HTTPStatus.METHOD_NOT_ALLOWED)
    else:
        try:
            method()
        except Exception:
            handler.wfile = io.BytesIO()
            handler.send_json({"error": "The service is unavailable. Try again shortly."},
                              HTTPStatus.SERVICE_UNAVAILABLE)
    start_response(handler.response_status, handler.response_headers)
    return [handler.wfile.getvalue()]

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import json
import mimetypes
import os
import threading

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "students.json"
LOCK = threading.Lock()


def load_students():
    if not DATA_FILE.exists():
        return {}
    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def save_students(data):
    tmp = DATA_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(DATA_FILE)


students = load_students()


def normalize(payload):
    if not isinstance(payload, dict):
        raise ValueError("Invalid student data")

    student_id = str(payload.get("id", "")).strip().upper()
    name = str(payload.get("name", "")).strip()
    course = str(payload.get("course", "")).strip()
    year = str(payload.get("year", "")).strip() or "1st Year"
    email = str(payload.get("email", "")).strip() or "Not provided"

    try:
        age = int(payload.get("age", 0))
    except (TypeError, ValueError):
        raise ValueError("Age must be a whole number")

    try:
        attendance = float(payload.get("attendance", 0))
        gpa = float(payload.get("gpa", 0))
    except (TypeError, ValueError):
        raise ValueError("Attendance and GPA must be numbers")

    if not student_id or not name or not course:
        raise ValueError("Student ID, student name and course are required")
    if not 10 <= age <= 100:
        raise ValueError("Age must be between 10 and 100")
    if not 0 <= attendance <= 100:
        raise ValueError("Attendance must be between 0 and 100")
    if not 0 <= gpa <= 10:
        raise ValueError("GPA must be between 0 and 10")

    return {
        "id": student_id,
        "name": name,
        "age": age,
        "course": course,
        "year": year,
        "email": email,
        "attendance": round(attendance, 2),
        "gpa": round(gpa, 2),
    }


def response_json(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    server_version = "StudentDictionary/2.0"

    def send_html(self):
        html = (BASE_DIR / "index.html").read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(html)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(html)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            return json.loads(raw.decode("utf-8"))
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
            raise ValueError("Invalid JSON request")

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path == "/":
            return self.send_html()

        if path == "/api/students":
            with LOCK:
                items = sorted(students.values(), key=lambda x: x["name"].lower())
            return response_json(self, 200, {"students": items, "count": len(items)})

        if path.startswith("/api/students/"):
            sid = path.split("/api/students/", 1)[1].upper()
            with LOCK:
                record = students.get(sid)
            if not record:
                return response_json(self, 404, {"error": "Student not found"})
            return response_json(self, 200, record)

        # Serve the two local front-end assets. This is important when
        # running the project directly with: py app.py
        asset_map = {
            "/styles.css": "styles.css",
            "/script.js": "script.js",
        }
        filename = asset_map.get(path)
        if filename:
            return self.send_static(filename)

        return response_json(self, 404, {"error": "Route not found"})

    def send_static(self, filename):
        file_path = (BASE_DIR / filename).resolve()
        if BASE_DIR not in file_path.parents:
            return response_json(self, 403, {"error": "Forbidden"})
        if not file_path.exists() or not file_path.is_file():
            return response_json(self, 404, {"error": "Asset not found"})
        body = file_path.read_bytes()
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if urlparse(self.path).path.rstrip("/") != "/api/students":
            return response_json(self, 404, {"error": "Route not found"})
        try:
            record = normalize(self.read_json())
        except ValueError as exc:
            return response_json(self, 400, {"error": str(exc)})

        with LOCK:
            if record["id"] in students:
                return response_json(self, 409, {"error": "A student with this ID already exists"})
            students[record["id"]] = record
            save_students(students)
        return response_json(self, 201, {"message": "Student added successfully", "student": record})

    def do_PUT(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/students/"):
            return response_json(self, 404, {"error": "Route not found"})
        old_id = path.split("/api/students/", 1)[1].upper()
        try:
            record = normalize(self.read_json())
        except ValueError as exc:
            return response_json(self, 400, {"error": str(exc)})

        with LOCK:
            if old_id not in students:
                return response_json(self, 404, {"error": "Student not found"})
            if record["id"] != old_id and record["id"] in students:
                return response_json(self, 409, {"error": "The new student ID already exists"})
            if record["id"] != old_id:
                del students[old_id]
            students[record["id"]] = record
            save_students(students)
        return response_json(self, 200, {"message": "Student updated successfully", "student": record})

    def do_DELETE(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/students/"):
            return response_json(self, 404, {"error": "Route not found"})
        sid = path.split("/api/students/", 1)[1].upper()
        with LOCK:
            removed = students.pop(sid, None)
            if removed is None:
                return response_json(self, 404, {"error": "Student not found"})
            save_students(students)
        return response_json(self, 200, {"message": "Student deleted successfully", "student": removed})

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def main():
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), Handler)
    print("=" * 64)
    print(" STUDENT INFORMATION DICTIONARY | VEDA TECHNOLOGY TASK 7")
    print(f" Running at http://{host}:{port}")
    print(" Press Ctrl+C to stop the server")
    print("=" * 64)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

"""OCVS Health Check server.

Serves the static site and persists shared data:
- POST /api/checklist  (editor password required) writes the checklist
  definition to data/healthcheck.json, so edits are shared with everyone.
- POST /api/feedback   (open to everyone) stores anonymous feedback about a
  checklist item in data/feedback.json.
- GET  /api/feedback   (editor password required) returns all feedback.
- DELETE /api/feedback (editor password required) removes one feedback entry.
  data/feedback.json itself is never served, so feedback stays invisible
  to regular users.

Usage:  python server.py [port]      (default port 8080)
"""

import hashlib
import json
import re
import sys
import threading
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "data" / "healthcheck.json"
FEEDBACK_FILE = ROOT / "data" / "feedback.json"

# SHA-256 of the editor password. Must match EDITOR_PASSWORD_HASH in js/app.js.
EDITOR_PASSWORD_HASH = "daf02459820e86900ff15570b3d53a1726bd2258c1682aff02517edd61d70b9e"

MAX_FEEDBACK_LENGTH = 5000
USER_TEXT_ERROR = (
    "Plain text only. HTML, code blocks, scripts and similar content are not allowed."
)

USER_TEXT_RULES = [
    (r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "Text contains invalid control characters."),
    (r"<\s*/?\s*[a-zA-Z][^>]*>", USER_TEXT_ERROR),
    (r"&lt;\s*/?\s*[a-zA-Z]", USER_TEXT_ERROR),
    (r"(?:^|[\s\"'(])javascript\s*:", USER_TEXT_ERROR),
    (r"(?:^|[\s\"'(])data\s*:", USER_TEXT_ERROR),
    (r"(?:^|[\s\"'(])vbscript\s*:", USER_TEXT_ERROR),
    (r"\bon[a-z]+\s*=", USER_TEXT_ERROR),
    (r"<\s*!\[CDATA\[", USER_TEXT_ERROR),
    (r"<%", USER_TEXT_ERROR),
    (r"<\?php", USER_TEXT_ERROR),
    (r"```", USER_TEXT_ERROR),
    (r"\beval\s*\(", USER_TEXT_ERROR),
    (r"\bnew\s+Function\s*\(", USER_TEXT_ERROR),
]

_user_text_patterns = [(re.compile(p, re.IGNORECASE), msg) for p, msg in USER_TEXT_RULES]


def validate_user_text(text):
    if not isinstance(text, str):
        return False, USER_TEXT_ERROR
    if len(text) > MAX_FEEDBACK_LENGTH:
        return False, f"Text is too long (maximum {MAX_FEEDBACK_LENGTH} characters)."
    for pattern, message in _user_text_patterns:
        if pattern.search(text):
            return False, message
    return True, ""


write_lock = threading.Lock()


def write_json_atomic(path, data):
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def load_feedback():
    try:
        return json.loads(FEEDBACK_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # Nothing may be cached: visitors must always get current checklist,
        # styles and logic after an edit or an update of the tool.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ------------------------------ helpers ------------------------------

    def _clean_path(self):
        return self.path.split("?", 1)[0].split("#", 1)[0]

    def _editor_authorized(self):
        password = self.headers.get("X-Editor-Password", "")
        return hashlib.sha256(password.encode("utf-8")).hexdigest() == EDITOR_PASSWORD_HASH

    def _read_body_json(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length))

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ------------------------------- GET ---------------------------------

    def do_GET(self):
        path = self._clean_path()
        if path == "/data/feedback.json":
            self.send_error(403, "Feedback is only available through the editor")
            return
        if path == "/api/feedback":
            if not self._editor_authorized():
                self.send_error(403, "Invalid editor password")
                return
            self._send_json(load_feedback())
            return
        super().do_GET()

    def do_HEAD(self):
        if self._clean_path() == "/data/feedback.json":
            self.send_error(403)
            return
        super().do_HEAD()

    # ------------------------------- POST --------------------------------

    def do_POST(self):
        path = self._clean_path()
        if path == "/api/checklist":
            self._post_checklist()
        elif path == "/api/feedback":
            self._post_feedback()
        else:
            self.send_error(404)

    def _post_checklist(self):
        if not self._editor_authorized():
            self.send_error(403, "Invalid editor password")
            return
        try:
            data = self._read_body_json()
            if not isinstance(data.get("categories"), list):
                raise ValueError("missing categories")
        except (ValueError, KeyError, AttributeError, json.JSONDecodeError):
            self.send_error(400, "Invalid checklist JSON")
            return

        with write_lock:
            write_json_atomic(DATA_FILE, data)
        self.send_response(204)
        self.end_headers()

    def _post_feedback(self):
        try:
            data = self._read_body_json()
            item_id = data.get("itemId")
            text = data.get("text")
            if not isinstance(item_id, str) or not item_id.strip():
                raise ValueError("missing itemId")
            if not isinstance(text, str) or not text.strip():
                raise ValueError("missing text")
        except (ValueError, KeyError, AttributeError, json.JSONDecodeError):
            self.send_error(400, "Invalid feedback")
            return

        ok, message = validate_user_text(text.strip())
        if not ok:
            self._send_json({"error": message}, status=400)
            return

        entry = {
            "id": uuid.uuid4().hex,
            "text": text.strip()[:MAX_FEEDBACK_LENGTH],
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        with write_lock:
            feedback = load_feedback()
            feedback.setdefault(item_id.strip(), []).append(entry)
            write_json_atomic(FEEDBACK_FILE, feedback)
        self.send_response(204)
        self.end_headers()

    # ------------------------------ DELETE -------------------------------

    def do_DELETE(self):
        if self._clean_path() != "/api/feedback":
            self.send_error(404)
            return
        if not self._editor_authorized():
            self.send_error(403, "Invalid editor password")
            return

        try:
            data = self._read_body_json()
            item_id = data.get("itemId")
            entry_id = data.get("id")
            if not isinstance(item_id, str) or not isinstance(entry_id, str):
                raise ValueError("missing itemId or id")
        except (ValueError, KeyError, AttributeError, json.JSONDecodeError):
            self.send_error(400, "Invalid delete request")
            return

        with write_lock:
            feedback = load_feedback()
            entries = feedback.get(item_id, [])
            remaining = [e for e in entries if e.get("id") != entry_id]
            if len(remaining) == len(entries):
                self.send_error(404, "Feedback entry not found")
                return
            if remaining:
                feedback[item_id] = remaining
            else:
                feedback.pop(item_id, None)
            write_json_atomic(FEEDBACK_FILE, feedback)

        self.send_response(204)
        self.end_headers()


def purge_idless_feedback():
    """Drop feedback entries stored by older versions without an id; they
    cannot be managed (deleted) from the editor."""
    with write_lock:
        feedback = load_feedback()
        cleaned = {}
        for item_id, entries in feedback.items():
            kept = [e for e in entries if e.get("id")]
            if kept:
                cleaned[item_id] = kept
        if cleaned != feedback:
            write_json_atomic(FEEDBACK_FILE, cleaned)


def main():
    purge_idless_feedback()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"OCVS Health Check serving on http://0.0.0.0:{port} (Ctrl+C to stop)")
    server.serve_forever()


if __name__ == "__main__":
    main()

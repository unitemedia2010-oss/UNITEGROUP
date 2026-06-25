from __future__ import annotations

import argparse
import io
import json
import logging
import os
import re
import socket
import sys
import tempfile
import time
import unicodedata
import zipfile
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable

import requests
from dotenv import load_dotenv
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload

APP_VERSION = "40.1.0"
DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder"
GOOGLE_DOC_MIME = "application/vnd.google-apps.document"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
IMAGE_MIME_PREFIX = "image/"
SCOPES = ["https://www.googleapis.com/auth/drive"]

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat()


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def normalize_text(value: Any) -> str:
    raw = unicodedata.normalize("NFKD", str(value or ""))
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    raw = raw.lower()
    raw = re.sub(r"[^a-z0-9]+", " ", raw)
    return re.sub(r"\s+", " ", raw).strip()


def compact_text(value: Any) -> str:
    return normalize_text(value).replace(" ", "")


def phrase_in_text(phrase: str, text: str) -> bool:
    return bool(phrase and f" {phrase} " in f" {text} ")


def code_variants(value: Any) -> set[str]:
    code = compact_text(value)
    variants = {code} if code else set()
    match = re.fullmatch(r"(tvu|u)(\d{2,6})", code)
    if match:
        digits = match.group(2)
        variants.add(f"u{digits}")
        variants.add(f"tvu{digits}")
    return {variant for variant in variants if len(variant) >= 4}


def code_matches_text(code: str, normalized: str, compact: str) -> bool:
    for variant in code_variants(code):
        match = re.fullmatch(r"([a-z]+)(\d+)", variant)
        if match:
            prefix, digits = match.groups()
            if re.search(rf"(?<![a-z0-9]){re.escape(prefix)}\s*{re.escape(digits)}(?![a-z0-9])", normalized):
                return True
        if re.search(rf"(?<![a-z0-9]){re.escape(variant)}(?![a-z0-9])", compact):
            return True
    return False


def preferred_employee(rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    return sorted(rows, key=lambda row: (
        row.get("employment_status") != "active",
        not bool(row.get("employee_code")),
        normalize_text(row.get("full_name")),
    ))[0]


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def chunks(items: list[Any], size: int) -> Iterable[list[Any]]:
    for index in range(0, len(items), size):
        yield items[index:index + size]


class SingleInstance:
    def __init__(self, path: Path):
        self.path = path
        self.handle = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = open(self.path, "a+")
        if os.name == "nt":
            import msvcrt
            try:
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise RuntimeError("Worker đã chạy trên máy này.") from exc
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.handle:
            if os.name == "nt":
                import msvcrt
                try:
                    self.handle.seek(0)
                    msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
                except OSError:
                    pass
            self.handle.close()


class SupabaseREST:
    def __init__(self, url: str, service_key: str):
        if not url or not service_key:
            raise RuntimeError("Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env")
        self.url = url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        })

    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        response = self.session.request(method, f"{self.url}{path}", timeout=120, **kwargs)
        if not response.ok:
            raise RuntimeError(f"Supabase {method} {path} lỗi {response.status_code}: {response.text[:1000]}")
        return response

    def select(self, table: str, params: dict[str, str] | None = None) -> list[dict[str, Any]]:
        response = self._request("GET", f"/rest/v1/{table}", params=params or {})
        return response.json()

    def select_all(self, table: str, params: dict[str, str] | None = None, page_size: int = 1000) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        start = 0
        while True:
            headers = {"Range": f"{start}-{start + page_size - 1}"}
            response = self._request("GET", f"/rest/v1/{table}", params=params or {}, headers=headers)
            batch = response.json()
            rows.extend(batch)
            if len(batch) < page_size:
                break
            start += page_size
        return rows

    def insert(self, table: str, payload: dict[str, Any] | list[dict[str, Any]], returning: bool = True) -> Any:
        headers = {"Prefer": "return=representation" if returning else "return=minimal"}
        response = self._request("POST", f"/rest/v1/{table}", json=payload, headers=headers)
        return response.json() if returning and response.text else None

    def upsert(self, table: str, payload: list[dict[str, Any]], on_conflict: str) -> Any:
        if not payload:
            return []
        headers = {"Prefer": "resolution=merge-duplicates,return=representation"}
        response = self._request(
            "POST",
            f"/rest/v1/{table}",
            params={"on_conflict": on_conflict},
            json=payload,
            headers=headers,
        )
        return response.json() if response.text else []

    def update(self, table: str, filters: dict[str, str], payload: dict[str, Any]) -> Any:
        headers = {"Prefer": "return=representation"}
        response = self._request("PATCH", f"/rest/v1/{table}", params=filters, json=payload, headers=headers)
        return response.json() if response.text else []

    def rpc(self, name: str, payload: dict[str, Any] | None = None) -> Any:
        response = self._request("POST", f"/rest/v1/rpc/{name}", json=payload or {})
        return response.json() if response.text else None


class DriveClient:
    def __init__(self, credentials_file: Path, token_file: Path):
        self.credentials_file = credentials_file
        self.token_file = token_file
        self.service = self._build_service()

    def _build_service(self):
        creds: Credentials | None = None
        if self.token_file.exists():
            creds = Credentials.from_authorized_user_file(str(self.token_file), SCOPES)
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        if not creds or not creds.valid:
            if not self.credentials_file.exists():
                raise RuntimeError(
                    f"Thiếu {self.credentials_file.name}. Hãy tạo OAuth Desktop App trong Google Cloud rồi đặt file vào {self.credentials_file}."
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(self.credentials_file), SCOPES)
            oauth_host = os.getenv("GOOGLE_OAUTH_HOST", "127.0.0.1").strip() or "127.0.0.1"
            oauth_port = safe_int(os.getenv("GOOGLE_OAUTH_PORT"), 0)
            try:
                creds = flow.run_local_server(
                    host=oauth_host,
                    port=oauth_port,
                    open_browser=True,
                    authorization_prompt_message=(
                        "Mo URL nay neu trinh duyet khong tu bat: {url}"
                    ),
                    success_message=(
                        "Da xac thuc Google Drive thanh cong. Ban co the dong cua so nay."
                    ),
                    prompt="consent",
                )
            except AttributeError as error:
                raise RuntimeError(
                    "Google da cap quyen nhung callback localhost khong ve duoc Python. "
                    "Hay giu cua so PowerShell mo den khi trinh duyet quay ve 127.0.0.1, "
                    "tat proxy/VPN tam thoi, cho phep Python qua Firewall, roi chay authorize lai."
                ) from error
        self.token_file.write_text(creds.to_json(), encoding="utf-8")
        return build("drive", "v3", credentials=creds, cache_discovery=False)

    def get_file_metadata(self, file_id: str) -> dict[str, Any]:
        return self.service.files().get(
            fileId=file_id,
            fields=(
                "id,name,mimeType,modifiedTime,size,md5Checksum,parents,webViewLink,"
                "thumbnailLink,trashed,driveId,shortcutDetails(targetId,targetMimeType)"
            ),
            supportsAllDrives=True,
        ).execute()

    def _resolve_shortcut(self, item: dict[str, Any]) -> dict[str, Any]:
        shortcut = item.get("shortcutDetails") or {}
        target_id = shortcut.get("targetId")
        if item.get("mimeType") != "application/vnd.google-apps.shortcut" or not target_id:
            return item
        target = self.get_file_metadata(target_id)
        target["shortcut_id"] = item.get("id")
        target["shortcut_name"] = item.get("name")
        return target

    def _list_children(self, folder_id: str, drive_id: str | None = None) -> list[dict[str, Any]]:
        token = None
        rows: list[dict[str, Any]] = []
        fields = (
            "nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,size,md5Checksum,"
            "parents,webViewLink,thumbnailLink,trashed,driveId,shortcutDetails(targetId,targetMimeType))"
        )
        while True:
            kwargs: dict[str, Any] = {
                "q": f"'{folder_id}' in parents and trashed = false",
                "pageSize": 1000,
                "pageToken": token,
                "fields": fields,
                "supportsAllDrives": True,
                "includeItemsFromAllDrives": True,
                "spaces": "drive",
            }
            if drive_id:
                kwargs.update({"corpora": "drive", "driveId": drive_id})
            result = self.service.files().list(**kwargs).execute()
            rows.extend(result.get("files", []))
            if result.get("incompleteSearch"):
                logging.warning("Google Drive báo incompleteSearch tại folder %s", folder_id)
            token = result.get("nextPageToken")
            if not token:
                return rows

    def list_folder(self, folder_id: str, recursive: bool = True, path: str = "") -> list[dict[str, Any]]:
        root = self._resolve_shortcut(self.get_file_metadata(folder_id))
        if root.get("mimeType") != DRIVE_FOLDER_MIME:
            raise RuntimeError(f"Drive ID {folder_id} không phải thư mục hoặc shortcut thư mục.")
        root_id = root["id"]
        root_drive_id = root.get("driveId")
        collected: list[dict[str, Any]] = []
        stack = [(root_id, path or root.get("name") or root_id, root_drive_id)]
        visited_folders: set[str] = set()
        collected_ids: set[str] = set()
        shortcut_count = 0
        while stack:
            current_id, current_path, drive_id = stack.pop()
            if current_id in visited_folders:
                continue
            visited_folders.add(current_id)
            for raw_item in self._list_children(current_id, drive_id):
                try:
                    item = self._resolve_shortcut(raw_item)
                except Exception as shortcut_error:
                    logging.warning("Không mở được shortcut %s: %s", raw_item.get("name"), shortcut_error)
                    continue
                if raw_item.get("mimeType") == "application/vnd.google-apps.shortcut":
                    shortcut_count += 1
                if item.get("mimeType") == DRIVE_FOLDER_MIME:
                    if recursive:
                        stack.append((item["id"], f"{current_path}/{raw_item.get('name') or item.get('name')}", item.get("driveId") or drive_id))
                    continue
                if item.get("id") in collected_ids:
                    continue
                collected_ids.add(item["id"])
                item["source_folder_path"] = current_path
                item["source_root_folder_id"] = root_id
                if raw_item.get("id") != item.get("id"):
                    item["source_shortcut_id"] = raw_item.get("id")
                collected.append(item)
        logging.info(
            "Drive folder %s: %s file, %s thư mục, %s shortcut đã xử lý",
            root.get("name") or root_id,
            len(collected),
            len(visited_folders),
            shortcut_count,
        )
        return collected

    def download_docx_bytes(self, file_id: str, mime_type: str) -> bytes:
        if mime_type == GOOGLE_DOC_MIME:
            request = self.service.files().export_media(fileId=file_id, mimeType=DOCX_MIME)
        else:
            request = self.service.files().get_media(fileId=file_id, supportsAllDrives=True)
        buffer = io.BytesIO()
        downloader = MediaIoBaseDownload(buffer, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return buffer.getvalue()

    def find_file_by_name(self, folder_id: str, name: str) -> dict[str, Any] | None:
        escaped = name.replace("'", "\\'")
        result = self.service.files().list(
            q=f"'{folder_id}' in parents and name = '{escaped}' and trashed = false",
            pageSize=10,
            fields="files(id,name,mimeType,modifiedTime,size,md5Checksum,parents,webViewLink,thumbnailLink)",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute()
        files = result.get("files", [])
        return files[0] if files else None

    def upload_bytes(self, folder_id: str, name: str, content: bytes, mime_type: str) -> dict[str, Any]:
        existing = self.find_file_by_name(folder_id, name)
        if existing:
            return existing
        with tempfile.NamedTemporaryFile(delete=False) as temp:
            temp.write(content)
            temp_path = temp.name
        try:
            media = MediaFileUpload(temp_path, mimetype=mime_type, resumable=False)
            return self.service.files().create(
                body={"name": name, "parents": [folder_id]},
                media_body=media,
                fields="id,name,mimeType,modifiedTime,size,md5Checksum,parents,webViewLink,thumbnailLink",
                supportsAllDrives=True,
            ).execute()
        finally:
            try:
                os.unlink(temp_path)
            except OSError:
                pass


@dataclass
class EmployeeMatch:
    employee_id: str | None
    method: str
    confidence: float
    status: str
    candidates: list[str]


class EmployeeMatcher:
    def __init__(self, employees: list[dict[str, Any]], max_fuzzy: int = 8, auto_attach_pending: bool = True):
        self.employees = employees
        self.max_fuzzy = max_fuzzy
        self.auto_attach_pending = auto_attach_pending
        self.by_code: dict[str, list[dict[str, Any]]] = {}
        self.by_name: dict[str, list[dict[str, Any]]] = {}
        for employee in employees:
            code = compact_text(employee.get("employee_code"))
            name = normalize_text(employee.get("full_name"))
            if code:
                self.by_code.setdefault(code, []).append(employee)
            if name:
                self.by_name.setdefault(name, []).append(employee)

    def match(self, file_name: str, text_hint: str = "") -> EmployeeMatch:
        searchable = f"{file_name} {text_hint}".strip()
        normalized = normalize_text(searchable)
        compact = compact_text(searchable)
        tokens = set(normalized.split())

        code_matches: list[dict[str, Any]] = []
        for code, employees in self.by_code.items():
            if code in tokens or code_matches_text(code, normalized, compact):
                code_matches.extend(employees)
        code_matches = list({row["id"]: row for row in code_matches}.values())
        if len(code_matches) == 1:
            employee = code_matches[0]
            employee_name = normalize_text(employee.get("full_name"))
            name_present = bool(employee_name and employee_name in normalized)
            return EmployeeMatch(
                employee_id=employee["id"],
                method="employee_code_and_name" if name_present else "employee_code",
                confidence=100.0 if name_present else 99.0,
                status="verified",
                candidates=[employee["id"]],
            )
        if len(code_matches) > 1:
            active_matches = [row for row in code_matches if row.get("employment_status") == "active"]
            if len(active_matches) == 1:
                employee = active_matches[0]
                return EmployeeMatch(employee["id"], "employee_code", 96.0, "verified", [row["id"] for row in code_matches])
            preferred = preferred_employee(code_matches)
            return EmployeeMatch(preferred["id"] if self.auto_attach_pending else None, "employee_code", 75.0, "pending", [row["id"] for row in code_matches])

        exact_name_hits: list[tuple[str, list[dict[str, Any]]]] = []
        for name, rows in self.by_name.items():
            if len(name) >= 5 and phrase_in_text(name, normalized):
                exact_name_hits.append((name, rows))
        if exact_name_hits:
            best_token_count = max(len(name.split()) for name, _ in exact_name_hits)
            best_length = max(len(name) for name, _ in exact_name_hits if len(name.split()) == best_token_count)
            exact_names: list[dict[str, Any]] = []
            for name, rows in exact_name_hits:
                if len(name.split()) == best_token_count and len(name) == best_length:
                    exact_names.extend(rows)
        else:
            exact_names = []
        unique_by_id = {row["id"]: row for row in exact_names}
        if len(unique_by_id) == 1:
            employee = next(iter(unique_by_id.values()))
            if len(self.by_name.get(normalize_text(employee.get("full_name")), [])) == 1:
                return EmployeeMatch(employee["id"], "full_name_unique", 92.0, "verified", [employee["id"]])
            active_matches = [row for row in self.by_name.get(normalize_text(employee.get("full_name")), []) if row.get("employment_status") == "active"]
            if len(active_matches) == 1 and active_matches[0]["id"] == employee["id"]:
                return EmployeeMatch(employee["id"], "full_name_unique", 94.0, "verified", [employee["id"]])
        if unique_by_id:
            candidates = sorted(unique_by_id.values(), key=lambda row: (
                row.get("employment_status") != "active",
                not bool(row.get("employee_code")),
                normalize_text(row.get("full_name")),
            ))
            active_candidates = [row for row in candidates if row.get("employment_status") == "active"]
            if len(active_candidates) == 1:
                employee = active_candidates[0]
                return EmployeeMatch(employee["id"], "full_name_unique", 94.0, "verified", [row["id"] for row in candidates[:self.max_fuzzy]])
            preferred = candidates[0]
            return EmployeeMatch(preferred["id"] if self.auto_attach_pending else None, "full_name_unique", 70.0, "pending", [row["id"] for row in candidates[:self.max_fuzzy]])

        cleaned_file = normalize_text(re.sub(r"\b(img|image|anh|cccd|cmnd|chan dung|portrait|mat truoc|mat sau|front|back|scan|copy)\b", " ", normalized))
        scored: list[tuple[float, dict[str, Any]]] = []
        for employee in self.employees:
            name = normalize_text(employee.get("full_name"))
            if not name:
                continue
            ratio = SequenceMatcher(None, name, cleaned_file).ratio()
            if ratio >= 0.74:
                scored.append((ratio, employee))
        scored.sort(key=lambda item: item[0], reverse=True)
        if scored:
            best_ratio, best_employee = scored[0]
            second_ratio = scored[1][0] if len(scored) > 1 else 0
            candidates = [employee["id"] for _, employee in scored[:self.max_fuzzy]]
            if best_ratio >= 0.92 and best_ratio - second_ratio >= 0.08:
                return EmployeeMatch(best_employee["id"], "fuzzy_suggestion", round(best_ratio * 100, 2), "pending", candidates)
            return EmployeeMatch(best_employee["id"] if self.auto_attach_pending else None, "fuzzy_suggestion", round(best_ratio * 100, 2), "pending", candidates)
        return EmployeeMatch(None, "unmatched", 0, "unmatched", [])


class DocumentWorker:
    def __init__(self):
        self.worker_id = os.getenv("WORKER_ID", "unite-media-pc").strip() or "unite-media-pc"
        self.host_name = socket.gethostname()
        self.poll_seconds = max(5, safe_int(os.getenv("POLL_SECONDS"), 20))
        self.batch_size = max(10, safe_int(os.getenv("BATCH_SIZE"), 100))
        self.max_fuzzy = max(1, safe_int(os.getenv("MAX_FUZZY_CANDIDATES"), 8))
        self.auto_attach_pending = env_bool("AUTO_ATTACH_SUGGESTED", True)
        self.schedule_times = [part.strip() for part in os.getenv("SCHEDULE_TIMES", "08:00,12:00,17:30").split(",") if part.strip()]
        self.run_startup_scan = env_bool("RUN_STARTUP_SCAN", True)
        self.startup_age_hours = max(1, safe_int(os.getenv("STARTUP_SCAN_MAX_AGE_HOURS"), 4))
        self.supabase = SupabaseREST(os.getenv("SUPABASE_URL", ""), os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""))
        self.drive = DriveClient(
            ROOT / os.getenv("GOOGLE_CREDENTIALS_FILE", "credentials.json"),
            ROOT / os.getenv("GOOGLE_TOKEN_FILE", "token.json"),
        )
        self.state_path = ROOT / "worker-state.json"
        self.state = self._load_state()

    def _load_state(self) -> dict[str, Any]:
        if self.state_path.exists():
            try:
                return json.loads(self.state_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                pass
        return {}

    def _save_state(self):
        self.state_path.write_text(json.dumps(self.state, ensure_ascii=False, indent=2), encoding="utf-8")

    def heartbeat(self, status: str = "idle", current_job_id: str | None = None, message: str = ""):
        payload = [{
            "worker_id": self.worker_id,
            "host_name": self.host_name,
            "worker_version": APP_VERSION,
            "status": status,
            "current_job_id": current_job_id,
            "last_seen_at": iso_now(),
            "message": message or None,
            "metadata": {"schedule_times": self.schedule_times, "poll_seconds": self.poll_seconds},
        }]
        self.supabase.upsert("document_worker_status", payload, "worker_id")

    def recover_stale_jobs(self):
        rows = self.supabase.select_all(
            "document_scan_jobs",
            {"select": "id,heartbeat_at,status,worker_id", "status": "eq.processing"},
        )
        threshold = utc_now() - timedelta(minutes=10)
        for row in rows:
            heartbeat = parse_iso(row.get("heartbeat_at"))
            if not heartbeat or heartbeat < threshold:
                self.supabase.update(
                    "document_scan_jobs",
                    {"id": f"eq.{row['id']}", "status": "eq.processing"},
                    {
                        "status": "pending",
                        "worker_id": None,
                        "progress_message": "Khôi phục sau khi worker bị dừng. Đang chờ xử lý lại.",
                        "error_message": None,
                    },
                )

    def get_pending_job(self) -> dict[str, Any] | None:
        rows = self.supabase.select(
            "document_scan_jobs",
            {
                "select": "*",
                "status": "eq.pending",
                "order": "created_at.asc",
                "limit": "1",
            },
        )
        if not rows:
            return None
        job = rows[0]
        updated = self.supabase.update(
            "document_scan_jobs",
            {"id": f"eq.{job['id']}", "status": "eq.pending"},
            {
                "status": "processing",
                "worker_id": self.worker_id,
                "started_at": iso_now(),
                "heartbeat_at": iso_now(),
                "progress_message": "Máy Media đã nhận yêu cầu và đang chuẩn bị quét.",
            },
        )
        return updated[0] if updated else None

    def create_job(self, trigger_type: str, source_kind: str = "all", force_rescan: bool = False) -> dict[str, Any] | None:
        existing = self.supabase.select(
            "document_scan_jobs",
            {"select": "*", "status": "in.(pending,processing)", "source_kind": f"eq.{source_kind}", "limit": "1"},
        )
        if existing:
            return existing[0]
        rows = self.supabase.insert("document_scan_jobs", {
            "trigger_type": trigger_type,
            "source_kind": source_kind,
            "status": "pending",
            "force_rescan": bool(force_rescan),
            "progress_message": "Đã tạo lịch quét từ máy Media.",
        })
        return rows[0] if rows else None

    def latest_completed_scan(self) -> datetime | None:
        rows = self.supabase.select(
            "document_scan_jobs",
            {"select": "finished_at", "status": "eq.completed", "order": "finished_at.desc", "limit": "1"},
        )
        return parse_iso(rows[0].get("finished_at")) if rows else None

    def maybe_enqueue_startup_scan(self):
        if not self.run_startup_scan:
            return
        latest = self.latest_completed_scan()
        if latest and utc_now() - latest < timedelta(hours=self.startup_age_hours):
            return
        self.create_job("startup", "all")

    def maybe_enqueue_scheduled_scan(self):
        now_local = datetime.now()
        due: list[datetime] = []
        for value in self.schedule_times:
            try:
                hour, minute = [int(part) for part in value.split(":", 1)]
            except ValueError:
                continue
            candidate = now_local.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if candidate <= now_local:
                due.append(candidate)
        if not due:
            return
        latest_due = max(due)
        last_key = self.state.get("last_schedule_key")
        due_key = latest_due.strftime("%Y-%m-%d %H:%M")
        if last_key == due_key:
            return
        self.state["last_schedule_key"] = due_key
        self._save_state()
        self.create_job("scheduled", "all")

    def load_settings(self) -> dict[str, Any]:
        rows = self.supabase.select("hr_document_settings", {"select": "*", "id": "eq.default", "limit": "1"})
        if not rows:
            raise RuntimeError("Chưa có cấu hình hr_document_settings.")
        return rows[0]

    def load_employees(self) -> list[dict[str, Any]]:
        return self.supabase.select_all(
            "employees",
            {"select": "id,employee_code,full_name,employment_status", "full_name": "not.is.null"},
        )

    def load_existing_documents(self) -> dict[str, dict[str, Any]]:
        rows = self.supabase.select_all(
            "employee_documents",
            {"select": "drive_file_id,parent_drive_file_id,metadata,updated_at"},
        )
        return {row["drive_file_id"]: row for row in rows if row.get("drive_file_id")}

    @staticmethod
    def classify_document(source_kind: str, file_name: str, mime_type: str, extracted_index: int | None = None) -> str:
        normalized = normalize_text(file_name)
        if source_kind == "portrait":
            return "portrait" if mime_type.startswith(IMAGE_MIME_PREFIX) or extracted_index else "employee_dossier"
        if source_kind == "cccd":
            if re.search(r"\b(sau|back|mat sau)\b", normalized) or extracted_index == 2:
                return "citizen_id_back"
            if re.search(r"\b(truoc|front|mat truoc)\b", normalized) or extracted_index == 1:
                return "citizen_id_front"
            return "citizen_id_combined"
        if re.search(r"\b(hop dong|contract)\b", normalized):
            return "contract"
        if re.search(r"\b(chung chi|bang cap|certificate)\b", normalized):
            return "certificate"
        if mime_type in {DOCX_MIME, GOOGLE_DOC_MIME}:
            return "employee_dossier"
        return "other"

    @staticmethod
    def image_mime_from_name(name: str) -> str:
        suffix = Path(name).suffix.lower()
        return {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".bmp": "image/bmp",
            ".tif": "image/tiff",
            ".tiff": "image/tiff",
        }.get(suffix, "application/octet-stream")

    def build_record(
        self,
        item: dict[str, Any],
        source_kind: str,
        matcher: EmployeeMatcher,
        source_folder: str,
        parent_drive_file_id: str | None = None,
        is_extracted: bool = False,
        extracted_index: int | None = None,
    ) -> dict[str, Any]:
        file_name = item.get("name") or item.get("id")
        mime_type = item.get("mimeType") or "application/octet-stream"
        match = matcher.match(file_name)
        document_type = self.classify_document(source_kind, file_name, mime_type, extracted_index)
        metadata = {
            "modifiedTime": item.get("modifiedTime"),
            "md5Checksum": item.get("md5Checksum"),
            "worker_version": APP_VERSION,
            "worker_id": self.worker_id,
        }
        return {
            "employee_id": match.employee_id,
            "document_type": document_type,
            "drive_file_id": item["id"],
            "parent_drive_file_id": parent_drive_file_id,
            "drive_folder_id": (item.get("parents") or [None])[0],
            "drive_view_url": item.get("webViewLink") or f"https://drive.google.com/open?id={item['id']}",
            "drive_thumbnail_url": item.get("thumbnailLink"),
            "file_name": file_name,
            "normalized_file_name": normalize_text(file_name),
            "mime_type": mime_type,
            "size_bytes": safe_int(item.get("size"), 0) or None,
            "source_folder": source_folder,
            "source_kind": source_kind if source_kind in {"cccd", "portrait", "other"} else "mixed",
            "is_extracted": is_extracted,
            "is_primary": False,
            "match_method": match.method,
            "match_confidence": match.confidence,
            "verification_status": match.status,
            "candidate_employee_ids": match.candidates,
            "metadata": metadata,
            "last_scanned_at": iso_now(),
        }

    def extract_docx_images(
        self,
        item: dict[str, Any],
        source_kind: str,
        destination_folder_id: str,
        matcher: EmployeeMatcher,
    ) -> list[dict[str, Any]]:
        if item.get("mimeType") not in {DOCX_MIME, GOOGLE_DOC_MIME}:
            return []
        payload = self.drive.download_docx_bytes(item["id"], item["mimeType"])
        records: list[dict[str, Any]] = []
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            media_files = sorted(name for name in archive.namelist() if name.startswith("word/media/") and not name.endswith("/"))
            for index, media_name in enumerate(media_files, start=1):
                content = archive.read(media_name)
                extension = Path(media_name).suffix.lower() or ".bin"
                base_name = Path(item.get("name") or item["id"]).stem
                output_name = f"{item['id']}__IMG_{index:02d}__{base_name}{extension}"
                mime_type = self.image_mime_from_name(output_name)
                uploaded = self.drive.upload_bytes(destination_folder_id, output_name, content, mime_type)
                uploaded["mimeType"] = uploaded.get("mimeType") or mime_type
                records.append(self.build_record(
                    uploaded,
                    source_kind,
                    matcher,
                    source_folder="03_DOCX_EXTRACTED",
                    parent_drive_file_id=item["id"],
                    is_extracted=True,
                    extracted_index=index,
                ))
        return records

    def update_job(self, job_id: str, **fields):
        fields["heartbeat_at"] = iso_now()
        self.supabase.update("document_scan_jobs", {"id": f"eq.{job_id}"}, fields)

    def process_job(self, job: dict[str, Any]):
        job_id = job["id"]
        self.heartbeat("processing", job_id, "Đang xử lý hồ sơ Drive")
        extracted_count = 0
        totals = {
            "processed_files": 0,
            "inserted_count": 0,
            "updated_count": 0,
            "verified_count": 0,
            "pending_count": 0,
            "unmatched_count": 0,
            "error_count": 0,
        }
        try:
            settings = self.load_settings()
            matcher = EmployeeMatcher(self.load_employees(), self.max_fuzzy, self.auto_attach_pending)
            existing = self.load_existing_documents()
            force_rescan = bool(job.get("force_rescan"))
            source_kind = job.get("source_kind") or "all"
            source_map = {
                "cccd": settings.get("cccd_folder_id"),
                "portrait": settings.get("portrait_folder_id"),
                "other": settings.get("other_folder_id"),
            }
            selected_sources = [source_kind] if source_kind != "all" else [key for key, value in source_map.items() if value]
            selected_sources = [key for key in selected_sources if source_map.get(key)]
            if not selected_sources:
                raise RuntimeError("Chưa cấu hình thư mục Drive phù hợp trong HR Portal.")

            all_items: list[tuple[str, dict[str, Any]]] = []
            recursive = bool(settings.get("scan_recursive", True))
            for kind in selected_sources:
                self.update_job(job_id, progress_message=f"Đang đọc danh sách file thư mục {kind}...", current_file=None)
                folder_items = self.drive.list_folder(source_map[kind], recursive=recursive, path=kind.upper())
                mime_counts = Counter(item.get("mimeType") or "unknown" for item in folder_items)
                logging.info("Nguồn %s: %s", kind, ", ".join(f"{mime}={count}" for mime, count in mime_counts.most_common()))
                for item in folder_items:
                    all_items.append((kind, item))

            changed_items: list[tuple[str, dict[str, Any]]] = []
            for kind, item in all_items:
                known = existing.get(item["id"])
                known_modified = (known or {}).get("metadata", {}).get("modifiedTime")
                if not force_rescan and known and known_modified == item.get("modifiedTime"):
                    continue
                changed_items.append((kind, item))

            self.update_job(
                job_id,
                total_files=len(changed_items),
                processed_files=0,
                progress_message=(
                    f"Tìm thấy {len(changed_items)} file mới hoặc thay đổi."
                    if changed_items else "Không có file mới hoặc thay đổi."
                ),
            )

            extract_docx = bool(settings.get("extract_docx_images", True))
            extracted_folder_id = settings.get("extracted_folder_id")
            doc_sources = sum(1 for _, item in changed_items if item.get("mimeType") in {DOCX_MIME, GOOGLE_DOC_MIME})
            if doc_sources and extract_docx and not extracted_folder_id:
                logging.warning(
                    "Có %s DOCX/Google Docs nhưng chưa cấu hình extracted_folder_id; worker chỉ liên kết file gốc, chưa trích ảnh.",
                    doc_sources,
                )
            records_buffer: list[dict[str, Any]] = []

            for index, (kind, item) in enumerate(changed_items, start=1):
                try:
                    self.update_job(
                        job_id,
                        current_file=item.get("name"),
                        processed_files=index - 1,
                        progress_message=f"Đang xử lý {index}/{len(changed_items)}: {item.get('name')}",
                    )
                    record = self.build_record(item, kind, matcher, item.get("source_folder_path") or kind.upper())
                    records_buffer.append(record)
                    if extract_docx and extracted_folder_id and item.get("mimeType") in {DOCX_MIME, GOOGLE_DOC_MIME}:
                        extracted_records = self.extract_docx_images(item, kind, extracted_folder_id, matcher)
                        extracted_count += len(extracted_records)
                        records_buffer.extend(extracted_records)

                    if len(records_buffer) >= self.batch_size:
                        before_ids = {row["drive_file_id"] for row in records_buffer}
                        inserted = sum(1 for drive_id in before_ids if drive_id not in existing)
                        updated = len(before_ids) - inserted
                        self.supabase.upsert("employee_documents", records_buffer, "drive_file_id")
                        totals["inserted_count"] += inserted
                        totals["updated_count"] += updated
                        for row in records_buffer:
                            status = row["verification_status"]
                            if status == "verified":
                                totals["verified_count"] += 1
                            elif status == "pending":
                                totals["pending_count"] += 1
                            else:
                                totals["unmatched_count"] += 1
                        records_buffer.clear()
                except Exception as file_error:
                    totals["error_count"] += 1
                    logging.exception("Lỗi xử lý file %s", item.get("name"))
                    self.update_job(job_id, error_message=str(file_error)[:1000])
                totals["processed_files"] = index

            if records_buffer:
                before_ids = {row["drive_file_id"] for row in records_buffer}
                inserted = sum(1 for drive_id in before_ids if drive_id not in existing)
                updated = len(before_ids) - inserted
                self.supabase.upsert("employee_documents", records_buffer, "drive_file_id")
                totals["inserted_count"] += inserted
                totals["updated_count"] += updated
                for row in records_buffer:
                    status = row["verification_status"]
                    if status == "verified":
                        totals["verified_count"] += 1
                    elif status == "pending":
                        totals["pending_count"] += 1
                    else:
                        totals["unmatched_count"] += 1

            final_message = (
                f"Hoàn tất: {totals['processed_files']} file nguồn • "
                f"{totals['verified_count']} liên kết • {totals['pending_count']} cần xác nhận • "
                f"{totals['unmatched_count']} chưa nhận diện • {extracted_count} ảnh trích"
            )
            self.update_job(
                job_id,
                status="completed",
                finished_at=iso_now(),
                current_file=None,
                progress_message=final_message,
                **totals,
            )
            self.state["last_success_at"] = iso_now()
            self._save_state()
            self.supabase.upsert("document_worker_status", [{
                "worker_id": self.worker_id,
                "host_name": self.host_name,
                "worker_version": APP_VERSION,
                "status": "idle",
                "current_job_id": None,
                "last_seen_at": iso_now(),
                "last_scan_at": iso_now(),
                "message": final_message,
            }], "worker_id")
            logging.info(final_message)
        except Exception as error:
            logging.exception("Job %s thất bại", job_id)
            self.update_job(
                job_id,
                status="failed",
                finished_at=iso_now(),
                current_file=None,
                error_message=str(error)[:2000],
                progress_message="Quét thất bại. Xem log trên máy Media.",
                **totals,
            )
            self.heartbeat("error", None, str(error)[:500])

    def run_daemon(self):
        self.recover_stale_jobs()
        self.heartbeat("online", None, "Worker vừa khởi động")
        self.maybe_enqueue_startup_scan()
        logging.info("Unite document worker V%s đang chạy. Poll mỗi %ss", APP_VERSION, self.poll_seconds)
        while True:
            try:
                self.maybe_enqueue_scheduled_scan()
                job = self.get_pending_job()
                if job:
                    self.process_job(job)
                else:
                    self.heartbeat("idle", None, "Đang chờ yêu cầu từ HR Portal")
            except KeyboardInterrupt:
                self.heartbeat("offline", None, "Worker đã dừng")
                raise
            except Exception as error:
                logging.exception("Vòng lặp worker lỗi")
                try:
                    self.heartbeat("error", None, str(error)[:500])
                except Exception:
                    pass
            time.sleep(self.poll_seconds)

    def run_once(self):
        self.recover_stale_jobs()
        job = self.get_pending_job()
        if job:
            self.process_job(job)
        else:
            logging.info("Không có job pending.")
            self.heartbeat("idle", None, "Không có job pending")

    def scan_now(self, source_kind: str = "all", force_rescan: bool = False):
        self.create_job("manual", source_kind, force_rescan=force_rescan)
        self.run_once()

    def diagnose(self, source_kind: str = "all"):
        settings = self.load_settings()
        source_map = {
            "cccd": settings.get("cccd_folder_id"),
            "portrait": settings.get("portrait_folder_id"),
            "other": settings.get("other_folder_id"),
        }
        selected = [source_kind] if source_kind != "all" else [key for key, value in source_map.items() if value]
        logging.info(
            "Cấu hình trích ảnh: %s | thư mục ảnh trích: %s | recursive: %s",
            bool(settings.get("extract_docx_images", True)),
            settings.get("extracted_folder_id") or "CHƯA CÓ",
            bool(settings.get("scan_recursive", True)),
        )
        for kind in selected:
            folder_id = source_map.get(kind)
            if not folder_id:
                logging.warning("Nguồn %s chưa có Folder ID", kind)
                continue
            items = self.drive.list_folder(folder_id, recursive=bool(settings.get("scan_recursive", True)), path=kind.upper())
            counts = Counter(item.get("mimeType") or "unknown" for item in items)
            logging.info("DIAG %s: tổng %s file", kind, len(items))
            for mime, count in counts.most_common():
                logging.info("  %s: %s", mime, count)


def configure_logging():
    log_dir = ROOT / "logs"
    log_dir.mkdir(exist_ok=True)
    level = getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)s | %(message)s",
        handlers=[
            logging.FileHandler(log_dir / "worker.log", encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )


def main():
    parser = argparse.ArgumentParser(description="Unite HR Drive document worker")
    parser.add_argument("command", nargs="?", default="daemon", choices=["daemon", "once", "scan-now", "diagnose", "authorize"])
    parser.add_argument("--source", default="all", choices=["all", "cccd", "portrait", "other"])
    parser.add_argument("--force", action="store_true", help="Quét lại cả file đã xử lý")
    args = parser.parse_args()
    configure_logging()

    with SingleInstance(ROOT / "worker.lock"):
        if args.command == "authorize":
            drive = DriveClient(
                ROOT / os.getenv("GOOGLE_CREDENTIALS_FILE", "credentials.json"),
                ROOT / os.getenv("GOOGLE_TOKEN_FILE", "token.json"),
            )
            logging.info("Google Drive authorization completed. Token: %s", drive.token_file)
            return
        worker = DocumentWorker()
        if args.command == "daemon":
            worker.run_daemon()
        elif args.command == "once":
            worker.run_once()
        elif args.command == "scan-now":
            worker.scan_now(args.source, force_rescan=args.force)
        elif args.command == "diagnose":
            worker.diagnose(args.source)


if __name__ == "__main__":
    main()

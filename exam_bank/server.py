#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
공무원 기출문제 은행 웹 서버 (SQLite DB 연동 + 정적 HTML/CSS/JS 서빙)
"""

import json
import mimetypes
import os
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "exam_bank.db")
PORT = int(os.environ.get("PORT", "8765"))


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def serialize_question(row: sqlite3.Row) -> dict:
    return {
        "question_id": row["question_id"],
        "subject_row_id": row["subject_row_id"],
        "q_no": row["q_no"],
        "polarity": row["polarity"],
        "category": row["category"],
        "stem": row["stem"],
        "passage": row["passage"],
        "sub_passage": row["sub_passage"],
        "choices": json.loads(row["choices_json"] or "[]"),
        "answer": row["answer"],
        "answer_source": row["answer_source"],
        "formulas": json.loads(row["formulas_json"] or "[]"),
        "images": json.loads(row["images_json"] or "[]"),
        "explanation": {
            "keywords": json.loads(row["keywords_json"] or "[]"),
            "law_refs": json.loads(row["law_refs_json"] or "[]"),
            "overall_commentary": row["overall_commentary"] or "",
            "bogi_analysis": json.loads(row["bogi_analysis_json"] or "[]"),
            "passage_evidence": row["passage_evidence"] or "",
            "choice_explanations": json.loads(row["choice_explanations_json"] or "[]"),
            "repeat_count": row["repeat_count"] or 1,
            "repeat_str": row["repeat_str"] or "",
        },
        "user_state": {
            "selected_choice": row["selected_choice"] or "",
            "is_correct": row["is_correct"],
            "is_bookmarked": bool(row["is_bookmarked"]) if row["is_bookmarked"] is not None else False,
            "memo": row["memo"] or "",
            "updated_at": row["updated_at"] or "",
        },
    }


class ExamBankHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # 콘솔 출력 최소화

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message, status=400):
        self.send_json({"error": message}, status=status)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path.startswith("/api/"):
            self.handle_api_get(path, qs)
        else:
            self.serve_static(path)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            self.send_error_json("Invalid JSON payload", 400)
            return

        if path == "/api/attempts":
            self.handle_post_attempt(payload)
        elif path == "/api/sessions":
            self.handle_post_session(payload)
        else:
            self.send_error_json("Not found", 404)

    def serve_static(self, path: str):
        if path == "/" or path == "":
            rel = "index.html"
        else:
            rel = path.lstrip("/")
        safe_path = os.path.normpath(os.path.join(BASE_DIR, rel))
        if not safe_path.startswith(BASE_DIR) or not os.path.isfile(safe_path):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"404 Not Found")
            return

        ctype, _ = mimetypes.guess_type(safe_path)
        if safe_path.endswith(".js"):
            ctype = "application/javascript; charset=utf-8"
        elif safe_path.endswith(".css"):
            ctype = "text/css; charset=utf-8"
        elif safe_path.endswith(".html"):
            ctype = "text/html; charset=utf-8"

        with open(safe_path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_api_get(self, path: str, qs: dict):
        conn = get_db()
        try:
            if path == "/api/filters":
                rows = conn.execute(
                    """
                    SELECT DISTINCT exam_type, grade, series, year, subject_name
                    FROM paper_mappings
                    ORDER BY exam_type, grade, series, year DESC, subject_name
                    """
                ).fetchall()

                hierarchy = {}
                for r in rows:
                    et, gr, sr, yr, sj = r["exam_type"], r["grade"], r["series"], r["year"], r["subject_name"]
                    hierarchy.setdefault(et, {}).setdefault(gr, {}).setdefault(sr, {"years": set(), "subjects": set()})
                    hierarchy[et][gr][sr]["years"].add(yr)
                    hierarchy[et][gr][sr]["subjects"].add(sj)

                clean_hierarchy = {}
                for et, gr_map in hierarchy.items():
                    clean_hierarchy[et] = {}
                    for gr, sr_map in gr_map.items():
                        clean_hierarchy[et][gr] = {}
                        for sr, info in sr_map.items():
                            clean_hierarchy[et][gr][sr] = {
                                "years": sorted(info["years"], reverse=True),
                                "subjects": sorted(info["subjects"]),
                            }

                stats_row = conn.execute(
                    """
                    SELECT
                        (SELECT COUNT(*) FROM papers) AS unique_papers,
                        (SELECT COUNT(*) FROM paper_mappings) AS total_mappings,
                        (SELECT COUNT(*) FROM questions) AS unique_questions,
                        (SELECT COUNT(*) FROM explanations WHERE law_refs_json != '[]') AS law_verified_questions,
                        (SELECT COUNT(*) FROM user_attempts WHERE selected_choice != '') AS solved_count,
                        (SELECT COUNT(*) FROM user_attempts WHERE is_correct = 1) AS correct_count,
                        (SELECT COUNT(*) FROM user_attempts WHERE is_correct = 0) AS wrong_count,
                        (SELECT COUNT(*) FROM user_attempts WHERE is_bookmarked = 1) AS bookmarked_count,
                        (SELECT COUNT(*) FROM exam_sessions) AS session_count
                    """
                ).fetchone()

                self.send_json({
                    "hierarchy": clean_hierarchy,
                    "stats": dict(stats_row),
                })

            elif path == "/api/papers":
                exam_type = qs.get("exam_type", [""])[0]
                grade = qs.get("grade", [""])[0]
                series = qs.get("series", [""])[0]
                year = qs.get("year", [""])[0]
                subject = qs.get("subject", [""])[0]

                clauses = []
                params = []
                if exam_type:
                    clauses.append("m.exam_type = ?")
                    params.append(exam_type)
                if grade:
                    clauses.append("m.grade = ?")
                    params.append(grade)
                if series:
                    clauses.append("m.series = ?")
                    params.append(series)
                if year:
                    clauses.append("m.year = ?")
                    params.append(int(year))
                if subject:
                    clauses.append("m.subject_name = ?")
                    params.append(subject)

                where_sql = ("WHERE " + " AND ".join(clauses)) if clauses else ""
                sql = f"""
                    SELECT
                        m.subject_row_id, m.exam_type, m.grade, m.series, m.year, m.subject_name,
                        p.exam_id, p.exam_title, p.booklet_type, p.total_questions,
                        (SELECT COUNT(*) FROM questions q
                         JOIN user_attempts ua ON q.question_id = ua.question_id
                         WHERE q.subject_row_id = m.subject_row_id AND ua.selected_choice != '') AS solved_count,
                        (SELECT COUNT(*) FROM questions q
                         JOIN user_attempts ua ON q.question_id = ua.question_id
                         WHERE q.subject_row_id = m.subject_row_id AND ua.is_correct = 1) AS correct_count
                    FROM paper_mappings m
                    JOIN papers p ON m.subject_row_id = p.subject_row_id
                    {where_sql}
                    ORDER BY m.year DESC, m.exam_type, m.grade, m.series, m.subject_name
                    LIMIT 200
                """
                papers = [dict(r) for r in conn.execute(sql, params).fetchall()]
                self.send_json({"papers": papers})

            elif path.startswith("/api/papers/"):
                prb_id = path.split("/api/papers/", 1)[1].strip("/")
                paper = conn.execute(
                    "SELECT * FROM papers WHERE subject_row_id = ?", (prb_id,)
                ).fetchone()
                if not paper:
                    self.send_error_json("Paper not found", 404)
                    return

                q_rows = conn.execute(
                    """
                    SELECT
                        q.*,
                        e.keywords_json, e.law_refs_json, e.overall_commentary,
                        e.bogi_analysis_json, e.passage_evidence, e.choice_explanations_json,
                        e.repeat_count, e.repeat_str,
                        ua.selected_choice, ua.is_correct, ua.is_bookmarked, ua.memo, ua.updated_at
                    FROM questions q
                    LEFT JOIN explanations e ON q.question_id = e.question_id
                    LEFT JOIN user_attempts ua ON q.question_id = ua.question_id
                    WHERE q.subject_row_id = ?
                    ORDER BY q.q_no ASC
                    """,
                    (prb_id,),
                ).fetchall()

                self.send_json({
                    "paper": dict(paper),
                    "questions": [serialize_question(r) for r in q_rows],
                })

            elif path == "/api/questions/search":
                q_text = qs.get("q", [""])[0].strip()
                exam_type = qs.get("exam_type", [""])[0]
                grade = qs.get("grade", [""])[0]
                subject = qs.get("subject", [""])[0]
                mode = qs.get("mode", ["all"])[0]
                limit = min(int(qs.get("limit", ["25"])[0]), 60)
                offset = int(qs.get("offset", ["0"])[0])

                clauses = []
                params = []
                if q_text:
                    like = f"%{q_text}%"
                    clauses.append("(q.stem LIKE ? OR q.passage LIKE ? OR q.choices_json LIKE ? OR e.law_refs_json LIKE ? OR e.keywords_json LIKE ?)")
                    params.extend([like, like, like, like, like])
                if exam_type:
                    clauses.append("p.exam_type = ?")
                    params.append(exam_type)
                if grade:
                    clauses.append("p.grade = ?")
                    params.append(grade)
                if subject:
                    clauses.append("p.subject_name = ?")
                    params.append(subject)

                if mode == "wrong":
                    clauses.append("ua.is_correct = 0")
                elif mode == "bookmarked":
                    clauses.append("ua.is_bookmarked = 1")
                elif mode == "law_verified":
                    clauses.append("e.law_refs_json != '[]'")

                where_sql = ("WHERE " + " AND ".join(clauses)) if clauses else ""
                count_sql = f"""
                    SELECT COUNT(*) AS cnt
                    FROM questions q
                    JOIN papers p ON q.subject_row_id = p.subject_row_id
                    LEFT JOIN explanations e ON q.question_id = e.question_id
                    LEFT JOIN user_attempts ua ON q.question_id = ua.question_id
                    {where_sql}
                """
                total = conn.execute(count_sql, params).fetchone()["cnt"]

                data_sql = f"""
                    SELECT
                        q.*, p.exam_type, p.grade, p.year, p.exam_title, p.subject_name, p.booklet_type,
                        e.keywords_json, e.law_refs_json, e.overall_commentary,
                        e.bogi_analysis_json, e.passage_evidence, e.choice_explanations_json,
                        e.repeat_count, e.repeat_str,
                        ua.selected_choice, ua.is_correct, ua.is_bookmarked, ua.memo, ua.updated_at
                    FROM questions q
                    JOIN papers p ON q.subject_row_id = p.subject_row_id
                    LEFT JOIN explanations e ON q.question_id = e.question_id
                    LEFT JOIN user_attempts ua ON q.question_id = ua.question_id
                    {where_sql}
                    ORDER BY p.year DESC, p.exam_type, p.grade, p.subject_name, q.q_no ASC
                    LIMIT ? OFFSET ?
                """
                rows = conn.execute(data_sql, params + [limit, offset]).fetchall()
                items = []
                for r in rows:
                    item = serialize_question(r)
                    item["paper_meta"] = {
                        "exam_type": r["exam_type"],
                        "grade": r["grade"],
                        "year": r["year"],
                        "exam_title": r["exam_title"],
                        "subject_name": r["subject_name"],
                        "booklet_type": r["booklet_type"],
                    }
                    items.append(item)

                self.send_json({"total": total, "items": items})

            elif path == "/api/sessions":
                rows = conn.execute(
                    "SELECT * FROM exam_sessions ORDER BY id DESC LIMIT 50"
                ).fetchall()
                self.send_json({"sessions": [dict(r) for r in rows]})

            else:
                self.send_error_json("Unknown endpoint", 404)
        finally:
            conn.close()

    def handle_post_attempt(self, payload: dict):
        qid = payload.get("question_id", "").strip()
        if not qid:
            self.send_error_json("question_id is required", 400)
            return

        conn = get_db()
        try:
            existing = conn.execute(
                "SELECT * FROM user_attempts WHERE question_id = ?", (qid,)
            ).fetchone()

            selected = payload.get("selected_choice")
            if selected is None and existing:
                selected = existing["selected_choice"]
            selected = selected or ""

            is_correct = payload.get("is_correct")
            if is_correct is None and existing:
                is_correct = existing["is_correct"]

            is_bookmarked = payload.get("is_bookmarked")
            if is_bookmarked is None:
                is_bookmarked = existing["is_bookmarked"] if existing else 0
            else:
                is_bookmarked = 1 if is_bookmarked else 0

            memo = payload.get("memo")
            if memo is None:
                memo = existing["memo"] if existing else ""

            with conn:
                conn.execute(
                    """
                    INSERT INTO user_attempts (question_id, selected_choice, is_correct, is_bookmarked, memo, updated_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
                    ON CONFLICT(question_id) DO UPDATE SET
                        selected_choice = excluded.selected_choice,
                        is_correct = excluded.is_correct,
                        is_bookmarked = excluded.is_bookmarked,
                        memo = excluded.memo,
                        updated_at = datetime('now', 'localtime')
                    """,
                    (qid, selected, is_correct, is_bookmarked, memo),
                )

            self.send_json({"ok": True, "question_id": qid})
        finally:
            conn.close()

    def handle_post_session(self, payload: dict):
        conn = get_db()
        try:
            with conn:
                cur = conn.execute(
                    """
                    INSERT INTO exam_sessions (subject_row_id, exam_title, subject_name, year, total_count, correct_count, score, elapsed_seconds)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        payload.get("subject_row_id", ""),
                        payload.get("exam_title", ""),
                        payload.get("subject_name", ""),
                        int(payload.get("year", 0)),
                        int(payload.get("total_count", 0)),
                        int(payload.get("correct_count", 0)),
                        float(payload.get("score", 0.0)),
                        int(payload.get("elapsed_seconds", 0)),
                    ),
                )
            self.send_json({"ok": True, "session_id": cur.lastrowid})
        finally:
            conn.close()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), ExamBankHandler)
    print(f"Exam Bank Server running at http://127.0.0.1:{PORT}")
    server.serve_forever()

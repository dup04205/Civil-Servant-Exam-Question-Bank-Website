#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
공무원_기출문제 XML 아카이브(4,688개 문제/해설 XML + index.xml)를
SQLite 데이터베이스(exam_bank.db)로 적재하는 ETL 스크립트
"""

import json
import os
import sqlite3
import xml.etree.ElementTree as ET

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
XML_ROOT = os.path.abspath(os.path.join(BASE_DIR, "..", "공무원_기출문제"))
DB_PATH = os.path.join(BASE_DIR, "exam_bank.db")


def init_schema(conn: sqlite3.Connection):
    conn.executescript(
        """
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        DROP TABLE IF EXISTS explanations;
        DROP TABLE IF EXISTS questions;
        DROP TABLE IF EXISTS papers;
        DROP TABLE IF EXISTS paper_mappings;

        -- 1. 직렬별 시험지 매핑 테이블 (같은 시험지가 여러 직렬 폴더에 속할 수 있음)
        CREATE TABLE paper_mappings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject_row_id TEXT NOT NULL,
            exam_type TEXT NOT NULL,
            grade TEXT NOT NULL,
            series TEXT NOT NULL,
            year INTEGER NOT NULL,
            subject_name TEXT NOT NULL,
            question_xml TEXT NOT NULL,
            explanation_xml TEXT NOT NULL
        );

        -- 2. 고유 시험지 메타데이터 (subject_row_id 기준 중복 제거)
        CREATE TABLE papers (
            subject_row_id TEXT PRIMARY KEY,
            exam_id TEXT NOT NULL,
            exam_type TEXT NOT NULL,
            grade TEXT NOT NULL,
            year INTEGER NOT NULL,
            exam_title TEXT NOT NULL,
            subject_code TEXT,
            subject_name TEXT NOT NULL,
            booklet_type TEXT,
            total_questions INTEGER NOT NULL
        );

        -- 3. 문항 테이블
        CREATE TABLE questions (
            question_id TEXT PRIMARY KEY,
            subject_row_id TEXT NOT NULL,
            q_no INTEGER NOT NULL,
            polarity TEXT,
            category TEXT,
            stem TEXT NOT NULL,
            passage TEXT,
            sub_passage TEXT,
            choices_json TEXT NOT NULL,
            answer TEXT NOT NULL,
            answer_source TEXT,
            formulas_json TEXT,
            images_json TEXT,
            FOREIGN KEY (subject_row_id) REFERENCES papers(subject_row_id)
        );

        -- 4. 해설 및 법제처 MCP 검증 법령 테이블
        CREATE TABLE explanations (
            question_id TEXT PRIMARY KEY,
            keywords_json TEXT,
            law_refs_json TEXT,
            overall_commentary TEXT,
            bogi_analysis_json TEXT,
            passage_evidence TEXT,
            choice_explanations_json TEXT,
            repeat_count INTEGER DEFAULT 1,
            repeat_str TEXT,
            FOREIGN KEY (question_id) REFERENCES questions(question_id)
        );

        -- 5. 사용자 풀이 기록 / 오답노트 / 북마크 / 개인 메모 (재구축 시에도 유지)
        CREATE TABLE IF NOT EXISTS user_attempts (
            question_id TEXT PRIMARY KEY,
            selected_choice TEXT,
            is_correct INTEGER,
            is_bookmarked INTEGER DEFAULT 0,
            memo TEXT DEFAULT '',
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        );

        -- 6. 모의고사 응시 세션 기록 (재구축 시에도 유지)
        CREATE TABLE IF NOT EXISTS exam_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject_row_id TEXT NOT NULL,
            exam_title TEXT NOT NULL,
            subject_name TEXT NOT NULL,
            year INTEGER NOT NULL,
            total_count INTEGER NOT NULL,
            correct_count INTEGER NOT NULL,
            score REAL NOT NULL,
            elapsed_seconds INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );

        CREATE INDEX idx_mappings_filter ON paper_mappings(exam_type, grade, series, year, subject_name);
        CREATE INDEX idx_mappings_prb ON paper_mappings(subject_row_id);
        CREATE INDEX idx_questions_prb ON questions(subject_row_id, q_no);
        CREATE INDEX idx_papers_subj ON papers(subject_name, year);
        """
    )


def load_xmls_into_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    init_schema(conn)

    index_path = os.path.join(XML_ROOT, "index.xml")
    idx_root = ET.parse(index_path).getroot()
    paper_elems = idx_root.findall("paper")
    print(f"Found {len(paper_elems)} paper mappings in index.xml")

    seen_prbs = set()
    mappings_batch = []
    papers_batch = []
    questions_batch = []
    explanations_batch = []

    for idx, p_el in enumerate(paper_elems, 1):
        if idx % 300 == 0:
            print(f"Processed {idx}/{len(paper_elems)} mappings (unique: {len(seen_prbs)})...", flush=True)
        exam_type = p_el.get("exam_type", "")
        grade = p_el.get("grade", "")
        series = p_el.get("series", "")
        year = int(p_el.get("year", "0"))
        subject = p_el.get("subject", "")
        q_rel = p_el.get("question_xml", "")
        exp_rel = p_el.get("explanation_xml", "")

        q_path = os.path.join(XML_ROOT, q_rel)
        exp_path = os.path.join(XML_ROOT, exp_rel)

        # 빠른 subject_row_id 추출 (중복 시험지 전체 XML DOM 파싱 생략)
        with open(q_path, "r", encoding="utf-8") as fq:
            head_chunk = fq.read(600)
        import re
        m_prb = re.search(r"<subject_row_id>([^<]+)</subject_row_id>", head_chunk)
        prb_id = m_prb.group(1) if m_prb else ""

        if prb_id and prb_id in seen_prbs:
            mappings_batch.append(
                (prb_id, exam_type, grade, series, year, subject, q_rel, exp_rel)
            )
            continue

        q_root = ET.parse(q_path).getroot()
        meta = q_root.find("metadata")
        prb_id = meta.findtext("subject_row_id", "")

        mappings_batch.append(
            (prb_id, exam_type, grade, series, year, subject, q_rel, exp_rel)
        )

        if prb_id in seen_prbs:
            continue
        seen_prbs.add(prb_id)

        papers_batch.append((
            prb_id,
            meta.findtext("exam_id", ""),
            exam_type,
            grade,
            year,
            meta.findtext("exam_title", ""),
            meta.findtext("subject_code", ""),
            subject,
            meta.findtext("booklet_type", ""),
            int(meta.findtext("total_questions", "0")),
        ))

        for q in q_root.findall("questions/question"):
            qid = q.get("id", "")
            q_no = int(q.get("no", "0"))
            polarity = q.get("type", "")
            category = q.get("category", "")
            stem = q.findtext("stem", "") or ""
            passage = q.findtext("passage", "") or ""
            sub_passage = q.findtext("sub_passage", "") or ""

            choices = []
            for ch in q.findall("choices/choice"):
                choices.append({
                    "no": int(ch.get("no", "0")),
                    "is_answer": ch.get("is_answer") == "true",
                    "text": ch.text or "",
                })

            ans_el = q.find("answer")
            answer = (ans_el.text or "").strip() if ans_el is not None else ""
            answer_source = ans_el.get("source", "") if ans_el is not None else ""

            formulas = [
                {"area": fm.get("area", ""), "latex": fm.text or ""}
                for fm in q.findall("formulas/formula")
            ]
            images = [
                {
                    "area": im.get("area", ""),
                    "kind": im.get("kind", ""),
                    "seq": im.get("seq", ""),
                    "path": im.text or "",
                }
                for im in q.findall("images/image")
            ]

            questions_batch.append((
                qid, prb_id, q_no, polarity, category,
                stem, passage, sub_passage,
                json.dumps(choices, ensure_ascii=False),
                answer, answer_source,
                json.dumps(formulas, ensure_ascii=False),
                json.dumps(images, ensure_ascii=False),
            ))

        exp_root = ET.parse(exp_path).getroot()
        for qe in exp_root.findall("explanations/question_explanation"):
            qid = qe.get("id", "")
            keywords = [kw.text for kw in qe.findall("topic_keywords/keyword") if kw.text]
            law_refs = [
                {
                    "name": lw.get("name", ""),
                    "law_id": lw.get("law_id", ""),
                    "mst": lw.get("mst", ""),
                    "effective_date": lw.get("effective_date", ""),
                    "type": lw.get("type", ""),
                    "note": lw.text or "",
                }
                for lw in qe.findall("law_references/law")
            ]
            overall = qe.findtext("overall_commentary", "") or ""
            bogi_items = [
                {
                    "symbol": bi.get("symbol", ""),
                    "judgment": bi.get("judgment", ""),
                    "statement": bi.findtext("statement", "") or "",
                    "commentary": bi.findtext("commentary", "") or "",
                }
                for bi in qe.findall("bogi_analysis/bogi_item")
            ]
            evidence = qe.findtext("passage_evidence", "") or ""
            choice_exps = [
                {
                    "no": int(ce.get("no", "0")),
                    "is_answer": ce.get("is_answer") == "true",
                    "judgment": ce.get("judgment", ""),
                    "choice_text": ce.findtext("choice_text", "") or "",
                    "commentary": ce.findtext("commentary", "") or "",
                }
                for ce in qe.findall("choice_explanations/choice_explanation")
            ]
            hist_el = qe.find("exam_history")
            repeat_cnt = int(hist_el.get("repeat_count", "1")) if hist_el is not None else 1
            repeat_str = (hist_el.text or "") if hist_el is not None else ""

            explanations_batch.append((
                qid,
                json.dumps(keywords, ensure_ascii=False),
                json.dumps(law_refs, ensure_ascii=False),
                overall,
                json.dumps(bogi_items, ensure_ascii=False),
                evidence,
                json.dumps(choice_exps, ensure_ascii=False),
                repeat_cnt,
                repeat_str,
            ))

    with conn:
        conn.executemany(
            "INSERT INTO paper_mappings (subject_row_id, exam_type, grade, series, year, subject_name, question_xml, explanation_xml) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            mappings_batch,
        )
        conn.executemany(
            "INSERT INTO papers (subject_row_id, exam_id, exam_type, grade, year, exam_title, subject_code, subject_name, booklet_type, total_questions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            papers_batch,
        )
        conn.executemany(
            "INSERT INTO questions (question_id, subject_row_id, q_no, polarity, category, stem, passage, sub_passage, choices_json, answer, answer_source, formulas_json, images_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            questions_batch,
        )
        conn.executemany(
            "INSERT INTO explanations (question_id, keywords_json, law_refs_json, overall_commentary, bogi_analysis_json, passage_evidence, choice_explanations_json, repeat_count, repeat_str) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            explanations_batch,
        )

    conn.close()
    print(f"DB build complete! Papers: {len(papers_batch)}, Mappings: {len(mappings_batch)}, Questions: {len(questions_batch)}, Explanations: {len(explanations_batch)}")


if __name__ == "__main__":
    load_xmls_into_db()

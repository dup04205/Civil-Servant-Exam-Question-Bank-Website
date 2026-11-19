/**
 * 데이터 API 클라이언트
 * - 로컬 서버(server.py) 실행 시: SQLite DB REST API(/api/...) 사용
 * - 정적 웹 호스팅(GitHub Pages 등) 시: ../공무원_기출문제/ XML 직접 파싱 + localStorage 자동 폴백
 */

const STORAGE_ATTEMPTS_KEY = "cs_exam_attempts_v1";
const STORAGE_SESSIONS_KEY = "cs_exam_sessions_v1";

let useStaticMode = null;
let staticIndexCache = null; // { hierarchy, mappings }
const staticPaperCache = new Map();

function loadLocalAttempts() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_ATTEMPTS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveLocalAttempts(map) {
  try {
    localStorage.setItem(STORAGE_ATTEMPTS_KEY, JSON.stringify(map));
  } catch {}
}

function getXmlBasePath() {
  // /exam_bank/ 또는 루트에서 ../공무원_기출문제 경로 계산
  const p = window.location.pathname;
  if (p.includes("/exam_bank")) {
    return "../공무원_기출문제";
  }
  return "./공무원_기출문제";
}

async function detectMode() {
  if (useStaticMode !== null) return useStaticMode;
  try {
    const res = await fetch("/api/filters", { method: "GET" });
    if (res.ok && (res.headers.get("content-type") || "").includes("application/json")) {
      useStaticMode = false;
      return false;
    }
  } catch {}
  useStaticMode = true;
  return true;
}

async function ensureStaticIndex() {
  if (staticIndexCache) return staticIndexCache;
  const base = getXmlBasePath();
  const res = await fetch(`${base}/index.xml`);
  if (!res.ok) throw new Error("기출문제 인덱스를 불러오지 못했습니다.");
  const xmlText = await res.text();
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const paperEls = Array.from(doc.querySelectorAll("paper"));

  const hierarchy = {};
  const mappings = [];

  for (const el of paperEls) {
    const exam_type = el.getAttribute("exam_type") || "";
    const grade = el.getAttribute("grade") || "";
    const series = el.getAttribute("series") || "";
    const year = Number(el.getAttribute("year") || "0");
    const subject_name = el.getAttribute("subject") || "";
    const total_questions = Number(el.getAttribute("questions") || "0");
    const question_xml = el.getAttribute("question_xml") || "";
    const explanation_xml = el.getAttribute("explanation_xml") || "";
    // 정적 모드에서는 question_xml 경로 자체를 고유 키로 사용
    const subject_row_id = encodeURIComponent(question_xml);

    hierarchy[exam_type] ??= {};
    hierarchy[exam_type][grade] ??= {};
    hierarchy[exam_type][grade][series] ??= { years: new Set(), subjects: new Set() };
    hierarchy[exam_type][grade][series].years.add(year);
    hierarchy[exam_type][grade][series].subjects.add(subject_name);

    mappings.push({
      subject_row_id,
      exam_type,
      grade,
      series,
      year,
      subject_name,
      total_questions,
      booklet_type: "대표",
      question_xml,
      explanation_xml,
    });
  }

  const cleanHierarchy = {};
  for (const [et, grMap] of Object.entries(hierarchy)) {
    cleanHierarchy[et] = {};
    for (const [gr, srMap] of Object.entries(grMap)) {
      cleanHierarchy[et][gr] = {};
      for (const [sr, info] of Object.entries(srMap)) {
        cleanHierarchy[et][gr][sr] = {
          years: Array.from(info.years).sort((a, b) => b - a),
          subjects: Array.from(info.subjects).sort((a, b) => a.localeCompare(b, "ko")),
        };
      }
    }
  }

  staticIndexCache = { hierarchy: cleanHierarchy, mappings };
  return staticIndexCache;
}

function getText(parent, tag) {
  return parent.querySelector(tag)?.textContent || "";
}

async function loadStaticPaper(subjectRowId) {
  if (staticPaperCache.has(subjectRowId)) {
    return staticPaperCache.get(subjectRowId);
  }
  const { mappings } = await ensureStaticIndex();
  const mapping = mappings.find((m) => m.subject_row_id === subjectRowId);
  if (!mapping) throw new Error("시험지를 찾을 수 없습니다.");

  const base = getXmlBasePath();
  const [qRes, expRes] = await Promise.all([
    fetch(`${base}/${mapping.question_xml.split("/").map(encodeURIComponent).join("/")}`),
    fetch(`${base}/${mapping.explanation_xml.split("/").map(encodeURIComponent).join("/")}`),
  ]);
  if (!qRes.ok) throw new Error("문제 파일을 불러오지 못했습니다.");

  const parser = new DOMParser();
  const qDoc = parser.parseFromString(await qRes.text(), "application/xml");
  const expDoc = expRes.ok ? parser.parseFromString(await expRes.text(), "application/xml") : null;

  const meta = qDoc.querySelector("metadata");
  const paper = {
    subject_row_id: subjectRowId,
    exam_id: getText(meta, "exam_id"),
    exam_type: getText(meta, "exam_type") || mapping.exam_type,
    grade: getText(meta, "grade") || mapping.grade,
    year: Number(getText(meta, "year") || mapping.year),
    exam_title: getText(meta, "exam_title"),
    subject_code: getText(meta, "subject_code"),
    subject_name: getText(meta, "subject_name") || mapping.subject_name,
    booklet_type: getText(meta, "booklet_type") || "대표",
    total_questions: Number(getText(meta, "total_questions") || mapping.total_questions),
  };

  const expById = new Map();
  if (expDoc) {
    for (const qe of expDoc.querySelectorAll("question_explanation")) {
      const qid = qe.getAttribute("id") || "";
      const law_refs = Array.from(qe.querySelectorAll("law_references > law")).map((lw) => ({
        name: lw.getAttribute("name") || "",
        law_id: lw.getAttribute("law_id") || "",
        mst: lw.getAttribute("mst") || "",
        effective_date: lw.getAttribute("effective_date") || "",
        type: lw.getAttribute("type") || "",
        note: lw.textContent || "",
      }));
      const choice_explanations = Array.from(qe.querySelectorAll("choice_explanations > choice_explanation")).map((ce) => ({
        no: Number(ce.getAttribute("no") || "0"),
        is_answer: ce.getAttribute("is_answer") === "true",
        judgment: ce.getAttribute("judgment") || "",
        choice_text: getText(ce, "choice_text"),
        commentary: getText(ce, "commentary"),
      }));
      const hist = qe.querySelector("exam_history");
      expById.set(qid, {
        keywords: Array.from(qe.querySelectorAll("topic_keywords > keyword")).map((k) => k.textContent || ""),
        law_refs,
        overall_commentary: getText(qe, "overall_commentary"),
        bogi_analysis: [],
        passage_evidence: getText(qe, "passage_evidence"),
        choice_explanations,
        repeat_count: Number(hist?.getAttribute("repeat_count") || "1"),
        repeat_str: hist?.textContent || "",
      });
    }
  }

  const questions = Array.from(qDoc.querySelectorAll("questions > question")).map((q) => {
    const qid = q.getAttribute("id") || "";
    const choices = Array.from(q.querySelectorAll("choices > choice")).map((ch) => ({
      no: Number(ch.getAttribute("no") || "0"),
      is_answer: ch.getAttribute("is_answer") === "true",
      text: ch.textContent || "",
    }));
    const ansEl = q.querySelector("answer");
    return {
      question_id: qid,
      subject_row_id: subjectRowId,
      q_no: Number(q.getAttribute("no") || "0"),
      polarity: q.getAttribute("type") || "",
      category: q.getAttribute("category") || "",
      stem: getText(q, "stem"),
      passage: getText(q, "passage"),
      sub_passage: getText(q, "sub_passage"),
      choices,
      answer: (ansEl?.textContent || "").trim(),
      answer_source: ansEl?.getAttribute("source") || "",
      formulas: [],
      images: [],
      explanation: expById.get(qid) || {
        keywords: [],
        law_refs: [],
        overall_commentary: "",
        bogi_analysis: [],
        passage_evidence: "",
        choice_explanations: [],
        repeat_count: 1,
        repeat_str: "",
      },
      paper_meta: {
        exam_type: paper.exam_type,
        grade: paper.grade,
        year: paper.year,
        exam_title: paper.exam_title,
        subject_name: paper.subject_name,
        booklet_type: paper.booklet_type,
      },
    };
  });

  const result = { paper, questions };
  staticPaperCache.set(subjectRowId, result);
  return result;
}

/* ==================== 공개 API 함수 ==================== */

export async function fetchFilters() {
  if (!(await detectMode())) {
    const res = await fetch("/api/filters");
    if (!res.ok) throw new Error("필터 데이터를 불러오지 못했습니다.");
    return res.json();
  }

  const { hierarchy } = await ensureStaticIndex();
  const attempts = Object.values(loadLocalAttempts());
  const wrong_count = attempts.filter((a) => a.is_correct === 0).length;
  const bookmarked_count = attempts.filter((a) => a.is_bookmarked).length;
  return {
    hierarchy,
    stats: { wrong_count, bookmarked_count },
  };
}

export async function fetchPapers(params = {}) {
  if (!(await detectMode())) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) qs.set(k, v);
    }
    const res = await fetch(`/api/papers?${qs.toString()}`);
    if (!res.ok) throw new Error("시험지 목록을 불러오지 못했습니다.");
    return res.json();
  }

  const { mappings } = await ensureStaticIndex();
  const filtered = mappings
    .filter((m) =>
      (!params.exam_type || m.exam_type === params.exam_type) &&
      (!params.grade || m.grade === params.grade) &&
      (!params.series || m.series === params.series) &&
      (!params.year || String(m.year) === String(params.year)) &&
      (!params.subject || m.subject_name === params.subject)
    )
    .sort((a, b) => b.year - a.year || a.subject_name.localeCompare(b.subject_name, "ko"))
    .map((m) => ({ ...m, solved_count: 0, correct_count: 0 }));

  return { papers: filtered };
}

export async function fetchPaperDetail(subjectRowId) {
  if (!(await detectMode())) {
    const res = await fetch(`/api/papers/${encodeURIComponent(subjectRowId)}`);
    if (!res.ok) throw new Error("시험지 문항을 불러오지 못했습니다.");
    return res.json();
  }

  const { paper, questions } = await loadStaticPaper(subjectRowId);
  const attempts = loadLocalAttempts();
  const hydrated = questions.map((q) => {
    const st = attempts[q.question_id] || {};
    return {
      ...q,
      user_state: {
        selected_choice: st.selected_choice || "",
        is_correct: st.is_correct ?? null,
        is_bookmarked: Boolean(st.is_bookmarked),
        memo: st.memo || "",
      },
    };
  });
  return { paper, questions: hydrated };
}

export async function searchQuestions(params = {}) {
  if (!(await detectMode())) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const res = await fetch(`/api/questions/search?${qs.toString()}`);
    if (!res.ok) throw new Error("문항 검색에 실패했습니다.");
    return res.json();
  }

  // 정적 모드에서는 지금까지 열어본 시험지 캐시 및 저장된 오답/북마크 문항 기준으로 필터링
  const attempts = loadLocalAttempts();
  const qText = (params.q || "").trim().toLowerCase();
  const mode = params.mode || "wrong";
  const allCached = [];
  const seen = new Set();

  for (const { questions } of staticPaperCache.values()) {
    for (const q of questions) {
      if (seen.has(q.question_id)) continue;
      seen.add(q.question_id);
      const st = attempts[q.question_id] || {};
      const hydrated = {
        ...q,
        user_state: {
          selected_choice: st.selected_choice || "",
          is_correct: st.is_correct ?? null,
          is_bookmarked: Boolean(st.is_bookmarked),
          memo: st.memo || "",
        },
      };
      if (mode === "wrong" && hydrated.user_state.is_correct !== 0) continue;
      if (mode === "bookmarked" && !hydrated.user_state.is_bookmarked) continue;
      if (qText) {
        const hay = `${q.stem} ${q.passage} ${q.choices.map((c) => c.text).join(" ")}`.toLowerCase();
        if (!hay.includes(qText)) continue;
      }
      allCached.push(hydrated);
    }
  }

  const limit = Number(params.limit || 20);
  const offset = Number(params.offset || 0);
  return {
    total: allCached.length,
    items: allCached.slice(offset, offset + limit),
  };
}

export async function saveAttempt(payload) {
  if (!(await detectMode())) {
    const res = await fetch("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("풀이 기록 저장에 실패했습니다.");
    return res.json();
  }

  const attempts = loadLocalAttempts();
  const prev = attempts[payload.question_id] || {};
  attempts[payload.question_id] = {
    selected_choice: payload.selected_choice !== undefined ? payload.selected_choice : (prev.selected_choice || ""),
    is_correct: payload.is_correct !== undefined ? payload.is_correct : (prev.is_correct ?? null),
    is_bookmarked: payload.is_bookmarked !== undefined ? Boolean(payload.is_bookmarked) : Boolean(prev.is_bookmarked),
    memo: payload.memo !== undefined ? payload.memo : (prev.memo || ""),
  };
  saveLocalAttempts(attempts);
  return { ok: true };
}

export async function saveExamSession(payload) {
  if (!(await detectMode())) {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("결과 저장에 실패했습니다.");
    return res.json();
  }

  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_SESSIONS_KEY) || "[]");
    list.unshift({ ...payload, created_at: new Date().toLocaleString("ko-KR") });
    localStorage.setItem(STORAGE_SESSIONS_KEY, JSON.stringify(list.slice(0, 50)));
  } catch {}
  return { ok: true };
}

export async function fetchSessions() {
  if (!(await detectMode())) {
    const res = await fetch("/api/sessions");
    if (!res.ok) throw new Error("응시 기록을 불러오지 못했습니다.");
    return res.json();
  }

  try {
    return { sessions: JSON.parse(localStorage.getItem(STORAGE_SESSIONS_KEY) || "[]") };
  } catch {
    return { sessions: [] };
  }
}

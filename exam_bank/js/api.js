/**
 * SQLite DB 연동 백엔드 API 클라이언트
 */

export async function fetchFilters() {
  const res = await fetch("/api/filters");
  if (!res.ok) throw new Error("필터 데이터를 불러오지 못했습니다.");
  return res.json();
}

export async function fetchPapers(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  const res = await fetch(`/api/papers?${qs.toString()}`);
  if (!res.ok) throw new Error("시험지 목록을 불러오지 못했습니다.");
  return res.json();
}

export async function fetchPaperDetail(subjectRowId) {
  const res = await fetch(`/api/papers/${encodeURIComponent(subjectRowId)}`);
  if (!res.ok) throw new Error("시험지 문항을 불러오지 못했습니다.");
  return res.json();
}

export async function searchQuestions(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const res = await fetch(`/api/questions/search?${qs.toString()}`);
  if (!res.ok) throw new Error("문항 검색에 실패했습니다.");
  return res.json();
}

export async function saveAttempt(payload) {
  const res = await fetch("/api/attempts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("풀이 기록 저장에 실패했습니다.");
  return res.json();
}

export async function saveExamSession(payload) {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("모의고사 결과 저장에 실패했습니다.");
  return res.json();
}

export async function fetchSessions() {
  const res = await fetch("/api/sessions");
  if (!res.ok) throw new Error("응시 기록을 불러오지 못했습니다.");
  return res.json();
}

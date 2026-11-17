import {
  fetchFilters,
  fetchPaperDetail,
  fetchPapers,
  fetchSessions,
  saveAttempt,
  saveExamSession,
  searchQuestions,
} from "./api.js";
import {
  getCircledNumber,
  renderInlineFragment,
  renderStructuredContent,
} from "./renderer.js";

const state = {
  hierarchy: {},
  stats: {},
  currentView: "papers", // papers | solve | search | wrong | bookmarked | dashboard
  solveMode: "study",    // study | exam
  examSubmitted: false,
  currentPaper: null,
  questions: [],
  timerSeconds: 0,
  timerId: null,
  queryOffset: 0,
  queryLimit: 20,
  queryTotal: 0,
};

const els = {
  sidebar: document.getElementById("sidebar"),
  btnToggleSidebar: document.getElementById("btnToggleSidebar"),
  navTabs: document.querySelectorAll(".nav-tab"),
  filterExamType: document.getElementById("filterExamType"),
  filterGrade: document.getElementById("filterGrade"),
  filterSeries: document.getElementById("filterSeries"),
  filterYear: document.getElementById("filterYear"),
  filterSubject: document.getElementById("filterSubject"),
  btnResetFilters: document.getElementById("btnResetFilters"),
  sidebarStats: document.getElementById("sidebarStats"),
  topbarBreadcrumb: document.getElementById("topbarBreadcrumb"),
  topStatSolved: document.getElementById("topStatSolved"),
  topStatAccuracy: document.getElementById("topStatAccuracy"),
  navWrongCount: document.getElementById("navWrongCount"),
  navBookmarkCount: document.getElementById("navBookmarkCount"),
  // Views
  viewPapers: document.getElementById("viewPapers"),
  viewSolve: document.getElementById("viewSolve"),
  viewQuery: document.getElementById("viewQuery"),
  viewDashboard: document.getElementById("viewDashboard"),
  // Papers
  paperGrid: document.getElementById("paperGrid"),
  paperListCount: document.getElementById("paperListCount"),
  // Solve
  btnBackToPapers: document.getElementById("btnBackToPapers"),
  solvePaperTitle: document.getElementById("solvePaperTitle"),
  solvePaperMeta: document.getElementById("solvePaperMeta"),
  modeBtns: document.querySelectorAll(".mode-btn"),
  examTimer: document.getElementById("examTimer"),
  btnSubmitExam: document.getElementById("btnSubmitExam"),
  questionStream: document.getElementById("questionStream"),
  omrGrid: document.getElementById("omrGrid"),
  omrProgress: document.getElementById("omrProgress"),
  // Query / Wrong / Bookmarked
  queryViewTitle: document.getElementById("queryViewTitle"),
  queryViewDesc: document.getElementById("queryViewDesc"),
  queryResultCount: document.getElementById("queryResultCount"),
  searchForm: document.getElementById("searchForm"),
  searchInput: document.getElementById("searchInput"),
  queryStream: document.getElementById("queryStream"),
  btnPrevPage: document.getElementById("btnPrevPage"),
  btnNextPage: document.getElementById("btnNextPage"),
  pageIndicator: document.getElementById("pageIndicator"),
  // Dashboard
  dashboardKpis: document.getElementById("dashboardKpis"),
  sessionTableBody: document.getElementById("sessionTableBody"),
  // Dialog
  resultDialog: document.getElementById("resultDialog"),
  resultDialogBody: document.getElementById("resultDialogBody"),
  btnCloseResultDialog: document.getElementById("btnCloseResultDialog"),
  btnConfirmResultDialog: document.getElementById("btnConfirmResultDialog"),
};

/* ==================== 유틸 ==================== */
function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function stopTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function startTimer() {
  stopTimer();
  state.timerSeconds = 0;
  els.examTimer.textContent = "00:00";
  state.timerId = setInterval(() => {
    state.timerSeconds++;
    els.examTimer.textContent = formatTime(state.timerSeconds);
  }, 1000);
}

function switchView(viewName) {
  state.currentView = viewName;
  if (viewName !== "solve") stopTimer();

  for (const tab of els.navTabs) {
    const active = tab.dataset.view === viewName || (viewName === "solve" && tab.dataset.view === "papers");
    tab.classList.toggle("is-active", active);
  }

  els.viewPapers.classList.toggle("is-active", viewName === "papers");
  els.viewSolve.classList.toggle("is-active", viewName === "solve");
  els.viewQuery.classList.toggle("is-active", ["search", "wrong", "bookmarked"].includes(viewName));
  els.viewDashboard.classList.toggle("is-active", viewName === "dashboard");

  const labels = {
    papers: "시험지 목록",
    solve: state.currentPaper ? `${state.currentPaper.year} ${state.currentPaper.subject_name}` : "문제 풀이",
    search: "키워드 · 법령 검색",
    wrong: "오답노트",
    bookmarked: "북마크 문항",
    dashboard: "학습 기록 · 통계",
  };
  els.topbarBreadcrumb.textContent = labels[viewName] || "";
  els.sidebar.classList.remove("is-open");
}

function updateStatsUI(stats) {
  state.stats = stats;
  const solved = stats.solved_count || 0;
  const correct = stats.correct_count || 0;
  const acc = solved > 0 ? `${Math.round((correct / solved) * 100)}%` : "-";
  els.topStatSolved.textContent = `풀이 ${solved.toLocaleString()}문항`;
  els.topStatAccuracy.textContent = `정답률 ${acc}`;
  els.navWrongCount.textContent = String(stats.wrong_count || 0);
  els.navBookmarkCount.textContent = String(stats.bookmarked_count || 0);
  els.sidebarStats.textContent = `시험지 ${(stats.unique_papers || 0).toLocaleString()}종 · ${(stats.unique_questions || 0).toLocaleString()}문항`;
}

async function refreshStats() {
  const data = await fetchFilters();
  state.hierarchy = data.hierarchy;
  updateStatsUI(data.stats);
}

/* ==================== 계층형 필터 ==================== */
function populateSelect(selectEl, items, defaultLabel) {
  const prev = selectEl.value;
  selectEl.replaceChildren();
  const def = document.createElement("option");
  def.value = "";
  def.textContent = defaultLabel;
  selectEl.appendChild(def);
  for (const val of items) {
    const opt = document.createElement("option");
    opt.value = String(val);
    opt.textContent = String(val);
    selectEl.appendChild(opt);
  }
  if (items.map(String).includes(prev)) {
    selectEl.value = prev;
  }
}

function syncFilterOptions() {
  const h = state.hierarchy;
  const examTypes = Object.keys(h);
  populateSelect(els.filterExamType, examTypes, "전체 (국가직 · 지방직)");
  const et = els.filterExamType.value;

  const grades = new Set();
  for (const t of et ? [et] : examTypes) {
    for (const g of Object.keys(h[t] || {})) grades.add(g);
  }
  populateSelect(els.filterGrade, [...grades], "전체 (9급 · 7급)");
  const gr = els.filterGrade.value;

  const seriesSet = new Set();
  for (const t of et ? [et] : examTypes) {
    for (const g of gr ? [gr] : Object.keys(h[t] || {})) {
      for (const s of Object.keys((h[t] && h[t][g]) || {})) seriesSet.add(s);
    }
  }
  populateSelect(els.filterSeries, [...seriesSet].sort(), "전체 직렬");
  const sr = els.filterSeries.value;

  const yearsSet = new Set();
  const subjectsSet = new Set();
  for (const t of et ? [et] : examTypes) {
    for (const g of gr ? [gr] : Object.keys(h[t] || {})) {
      for (const s of sr ? [sr] : Object.keys((h[t] && h[t][g]) || {})) {
        const info = h[t]?.[g]?.[s];
        if (!info) continue;
        info.years.forEach((y) => yearsSet.add(y));
        info.subjects.forEach((sj) => subjectsSet.add(sj));
      }
    }
  }
  populateSelect(els.filterYear, [...yearsSet].sort((a, b) => b - a), "전체 연도");
  populateSelect(els.filterSubject, [...subjectsSet].sort(), "전체 과목");
}

function getFilterParams() {
  return {
    exam_type: els.filterExamType.value,
    grade: els.filterGrade.value,
    series: els.filterSeries.value,
    year: els.filterYear.value,
    subject: els.filterSubject.value,
  };
}

async function loadPaperList() {
  const { papers } = await fetchPapers(getFilterParams());
  els.paperListCount.textContent = `${papers.length}개 시험지`;
  els.paperGrid.replaceChildren();

  if (papers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "선택한 조건에 해당하는 시험지가 없습니다.";
    els.paperGrid.appendChild(empty);
    return;
  }

  for (const p of papers) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "paper-card";
    card.addEventListener("click", () => openPaper(p.subject_row_id, p.series));

    const top = document.createElement("div");
    top.className = "paper-card-top";
    const badges = document.createElement("div");
    badges.className = "paper-badges";

    for (const [txt, isAccent] of [
      [`${p.exam_type} ${p.grade}`, true],
      [String(p.year), false],
      [`${p.booklet_type || "대표"}책형`, false],
    ]) {
      const b = document.createElement("span");
      b.className = isAccent ? "badge badge-accent" : "badge";
      b.textContent = txt;
      badges.appendChild(b);
    }
    top.appendChild(badges);

    const title = document.createElement("h3");
    title.className = "paper-card-title";
    title.textContent = p.subject_name;

    const sub = document.createElement("div");
    sub.className = "paper-card-sub";
    sub.textContent = `${p.series} · ${p.exam_title}`;

    const foot = document.createElement("div");
    foot.className = "paper-card-foot tabular-nums";
    const qCnt = document.createElement("span");
    qCnt.textContent = `총 ${p.total_questions}문항`;
    const prog = document.createElement("span");
    prog.textContent = p.solved_count > 0 ? `풀이 ${p.solved_count}/${p.total_questions} (정답 ${p.correct_count})` : "미응시";
    foot.append(qCnt, prog);

    card.append(top, title, sub, foot);
    els.paperGrid.appendChild(card);
  }
}

/* ==================== 문항 카드 빌더 (통일된 스타일) ==================== */
function buildQuestionCard(q, options = {}) {
  const { showPaperTag = false, onSelectChoice } = options;
  const card = document.createElement("article");
  card.className = "q-card";
  card.id = `q-card-${q.q_no}`;

  // 1. 헤더
  const header = document.createElement("div");
  header.className = "q-header";
  const hLeft = document.createElement("div");
  hLeft.className = "q-header-left";

  const numBadge = document.createElement("span");
  numBadge.className = "q-number tabular-nums";
  numBadge.textContent = String(q.q_no).padStart(2, "0");
  hLeft.appendChild(numBadge);

  if (showPaperTag && q.paper_meta) {
    const pTag = document.createElement("span");
    pTag.className = "q-paper-tag";
    pTag.textContent = `${q.paper_meta.year} ${q.paper_meta.exam_type} ${q.paper_meta.grade} · ${q.paper_meta.subject_name}`;
    hLeft.appendChild(pTag);
  }

  if (q.polarity) {
    const typeTag = document.createElement("span");
    typeTag.className = "q-type-tag";
    typeTag.textContent = `${q.polarity} · ${q.category || ""}`;
    hLeft.appendChild(typeTag);
  }

  if (q.explanation?.law_refs?.length > 0) {
    const lawBadge = document.createElement("span");
    lawBadge.className = "q-law-badge";
    lawBadge.textContent = `법제처 MCP 검증 (${q.explanation.law_refs.map((l) => l.name).slice(0, 2).join(", ")})`;
    hLeft.appendChild(lawBadge);
  }

  const bookmarkBtn = document.createElement("button");
  bookmarkBtn.type = "button";
  bookmarkBtn.className = `btn-bookmark ${q.user_state?.is_bookmarked ? "is-active" : ""}`;
  bookmarkBtn.textContent = q.user_state?.is_bookmarked ? "★ 북마크됨" : "☆ 북마크";
  bookmarkBtn.addEventListener("click", async () => {
    const next = !q.user_state.is_bookmarked;
    q.user_state.is_bookmarked = next;
    bookmarkBtn.classList.toggle("is-active", next);
    bookmarkBtn.textContent = next ? "★ 북마크됨" : "☆ 북마크";
    await saveAttempt({ question_id: q.question_id, is_bookmarked: next });
    refreshStats();
  });

  header.append(hLeft, bookmarkBtn);
  card.appendChild(header);

  // 2. 발문
  const stemEl = document.createElement("h2");
  stemEl.className = "q-stem";
  stemEl.appendChild(renderInlineFragment(q.stem));
  card.appendChild(stemEl);

  // 3. 지문 (있을 경우 통일된 문단·표 스타일로 렌더링)
  if (q.passage) {
    const passageBox = document.createElement("div");
    passageBox.className = "q-passage";
    renderStructuredContent(q.passage, passageBox, false);
    card.appendChild(passageBox);
  }

  // 4. <보기> / 보조지문
  if (q.sub_passage) {
    const bogiBox = document.createElement("div");
    bogiBox.className = "q-bogi-box";
    const bogiHead = document.createElement("div");
    bogiHead.className = "q-bogi-header";
    bogiHead.textContent = "보 기";
    bogiBox.appendChild(bogiHead);
    renderStructuredContent(q.sub_passage, bogiBox, true);
    card.appendChild(bogiBox);
  }

  // 5. 선지 목록
  const choicesWrap = document.createElement("div");
  choicesWrap.className = "q-choices";

  const showResult =
    state.currentView !== "solve"
      ? Boolean(q.user_state?.selected_choice)
      : state.solveMode === "study"
        ? Boolean(q.user_state?.selected_choice)
        : state.examSubmitted;

  const ansNums = (q.answer || "").split(/[,\s]+/).filter(Boolean).map(Number);

  const choiceButtons = [];
  for (const ch of q.choices) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "q-choice";

    const noSpan = document.createElement("span");
    noSpan.className = "q-choice-no tabular-nums";
    noSpan.textContent = getCircledNumber(ch.no);

    const textSpan = document.createElement("span");
    textSpan.appendChild(renderInlineFragment(ch.text));

    const markSpan = document.createElement("span");
    markSpan.className = "q-choice-mark";

    const isSelected = String(q.user_state?.selected_choice) === String(ch.no);
    const isAns = ansNums.includes(ch.no);

    if (showResult) {
      if (isAns) {
        btn.classList.add("is-correct");
        markSpan.textContent = isSelected ? "정답 (선택)" : "정답";
      } else if (isSelected) {
        btn.classList.add("is-wrong");
        markSpan.textContent = "오답";
      }
    } else if (isSelected) {
      btn.classList.add("is-selected");
    }

    btn.append(noSpan, textSpan, markSpan);
    btn.addEventListener("click", async () => {
      if (state.currentView === "solve" && state.solveMode === "exam" && state.examSubmitted) return;
      const correctFlag = ansNums.includes(ch.no) ? 1 : 0;
      q.user_state.selected_choice = String(ch.no);
      q.user_state.is_correct = correctFlag;

      await saveAttempt({
        question_id: q.question_id,
        selected_choice: String(ch.no),
        is_correct: correctFlag,
      });

      if (onSelectChoice) onSelectChoice(q);

      // 카드 UI 즉시 갱신
      const freshCard = buildQuestionCard(q, options);
      card.replaceWith(freshCard);
      refreshStats();
    });

    choiceButtons.push(btn);
    choicesWrap.appendChild(btn);
  }
  card.appendChild(choicesWrap);

  // 6. 하단 액션 & 해설 토글
  const actions = document.createElement("div");
  actions.className = "q-actions";

  const toggleExpBtn = document.createElement("button");
  toggleExpBtn.type = "button";
  toggleExpBtn.className = "btn-secondary";
  const shouldAutoOpen = showResult && state.solveMode === "study" && q.user_state?.selected_choice;
  toggleExpBtn.textContent = shouldAutoOpen ? "해설 접기" : "정답 · 해설 보기";

  const expBox = buildExplanationBox(q);
  expBox.hidden = !shouldAutoOpen;

  toggleExpBtn.addEventListener("click", () => {
    expBox.hidden = !expBox.hidden;
    toggleExpBtn.textContent = expBox.hidden ? "정답 · 해설 보기" : "해설 접기";
  });

  actions.appendChild(toggleExpBtn);
  card.append(actions, expBox);
  return card;
}

function buildExplanationBox(q) {
  const box = document.createElement("div");
  box.className = "q-explanation-box";
  const exp = q.explanation || {};

  const head = document.createElement("div");
  head.className = "exp-head";
  const ansPill = document.createElement("span");
  ansPill.className = "exp-answer-pill";
  ansPill.textContent = `정답 ${q.answer}번 (${q.answer_source || "공식발표"})`;
  const hist = document.createElement("span");
  hist.className = "q-type-tag";
  hist.textContent = exp.repeat_str || "";
  head.append(ansPill, hist);
  box.appendChild(head);

  if (exp.overall_commentary) {
    const overall = document.createElement("div");
    overall.className = "exp-overall";
    overall.textContent = exp.overall_commentary;
    box.appendChild(overall);
  }

  if (exp.law_refs && exp.law_refs.length > 0) {
    const lawCard = document.createElement("div");
    lawCard.className = "exp-law-card";
    const h4 = document.createElement("h4");
    h4.textContent = "법제처 국가법령정보센터(MCP) 검증 조문";
    lawCard.appendChild(h4);
    for (const lr of exp.law_refs) {
      const item = document.createElement("div");
      item.className = "exp-law-item";
      item.textContent = `• 「${lr.name}」 (법령ID: ${lr.law_id}, 시행: ${lr.effective_date}) — ${lr.note}`;
      lawCard.appendChild(item);
    }
    box.appendChild(lawCard);
  }

  if (exp.choice_explanations && exp.choice_explanations.length > 0) {
    const list = document.createElement("div");
    list.className = "exp-choice-list";
    for (const ce of exp.choice_explanations) {
      const item = document.createElement("div");
      item.className = `exp-choice-item ${ce.is_answer ? "is-ans" : ""}`;
      const strong = document.createElement("strong");
      strong.textContent = `${getCircledNumber(ce.no)} [${ce.judgment}] `;
      item.append(strong, document.createTextNode(ce.commentary));
      list.appendChild(item);
    }
    box.appendChild(list);
  }

  // 개인 오답/학습 메모 DB 저장
  const memoBox = document.createElement("div");
  memoBox.className = "memo-box";
  const memoLabel = document.createElement("label");
  memoLabel.textContent = "개인 학습 메모 (SQLite DB 저장)";
  const memoRow = document.createElement("div");
  memoRow.className = "memo-row";
  const memoInput = document.createElement("input");
  memoInput.type = "text";
  memoInput.value = q.user_state?.memo || "";
  memoInput.placeholder = "헷갈리는 판례나 핵심 포인트를 메모하세요...";
  const memoBtn = document.createElement("button");
  memoBtn.type = "button";
  memoBtn.className = "btn-secondary";
  memoBtn.textContent = "메모 저장";
  memoBtn.addEventListener("click", async () => {
    q.user_state.memo = memoInput.value;
    await saveAttempt({ question_id: q.question_id, memo: memoInput.value });
    memoBtn.textContent = "저장됨";
    setTimeout(() => { memoBtn.textContent = "메모 저장"; }, 1200);
  });
  memoRow.append(memoInput, memoBtn);
  memoBox.append(memoLabel, memoRow);
  box.appendChild(memoBox);

  return box;
}

/* ==================== 시험지 풀기 & OMR ==================== */
async function openPaper(subjectRowId, seriesLabel = "") {
  const data = await fetchPaperDetail(subjectRowId);
  state.currentPaper = data.paper;
  state.questions = data.questions;
  state.examSubmitted = false;

  els.solvePaperTitle.textContent = `${data.paper.year} ${data.paper.subject_name} (${data.paper.exam_type} ${data.paper.grade})`;
  els.solvePaperMeta.textContent = `${seriesLabel ? seriesLabel + " · " : ""}${data.paper.exam_title} · ${data.paper.booklet_type || "대표"}책형 · ${data.questions.length}문항`;

  switchView("solve");
  renderSolveStream();
  renderOMR();
  startTimer();
}

function renderSolveStream() {
  els.questionStream.replaceChildren();
  for (const q of state.questions) {
    els.questionStream.appendChild(
      buildQuestionCard(q, {
        showPaperTag: false,
        onSelectChoice: () => renderOMR(),
      })
    );
  }
}

function renderOMR() {
  els.omrGrid.replaceChildren();
  let answeredCount = 0;

  for (const q of state.questions) {
    const sel = q.user_state?.selected_choice;
    if (sel) answeredCount++;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "omr-btn tabular-nums";
    btn.textContent = String(q.q_no);

    const showJudge = state.solveMode === "study" ? Boolean(sel) : state.examSubmitted;
    if (showJudge && sel) {
      btn.classList.add(q.user_state.is_correct === 1 ? "is-correct" : "is-wrong");
    } else if (sel) {
      btn.classList.add("is-answered");
    }

    btn.addEventListener("click", () => {
      document.getElementById(`q-card-${q.q_no}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    els.omrGrid.appendChild(btn);
  }

  els.omrProgress.textContent = `${answeredCount} / ${state.questions.length}`;
}

async function submitExam() {
  stopTimer();
  state.examSubmitted = true;

  const total = state.questions.length;
  let correct = 0;
  for (const q of state.questions) {
    const ansNums = (q.answer || "").split(/[,\s]+/).filter(Boolean).map(Number);
    if (q.user_state?.selected_choice && ansNums.includes(Number(q.user_state.selected_choice))) {
      correct++;
    }
  }
  const score = total > 0 ? Math.round((correct / total) * 1000) / 10 : 0;

  await saveExamSession({
    subject_row_id: state.currentPaper.subject_row_id,
    exam_title: state.currentPaper.exam_title,
    subject_name: state.currentPaper.subject_name,
    year: state.currentPaper.year,
    total_count: total,
    correct_count: correct,
    score,
    elapsed_seconds: state.timerSeconds,
  });

  renderSolveStream();
  renderOMR();
  refreshStats();

  els.resultDialogBody.replaceChildren();
  const summary = document.createElement("p");
  summary.textContent = `${state.currentPaper.year}년 ${state.currentPaper.subject_name} 모의고사 채점이 완료되었습니다.`;
  const scoreP = document.createElement("p");
  scoreP.className = "tabular-nums";
  scoreP.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = `총 ${total}문항 중 ${correct}문항 정답 (${score}점) · 소요 시간 ${formatTime(state.timerSeconds)}`;
  scoreP.appendChild(strong);
  els.resultDialogBody.append(summary, scoreP);

  els.resultDialog.showModal();
}

/* ==================== 검색 / 오답노트 / 북마크 뷰 ==================== */
async function loadQueryView(mode) {
  const titles = {
    search: ["키워드 · 법령 검색", "전체 기출문제 DB에서 발문, 지문, 선지, 인용 법령명으로 검색합니다."],
    wrong: ["오답노트", "틀린 문항이 SQLite DB에서 자동으로 수집됩니다. 다시 풀고 정복하세요."],
    bookmarked: ["북마크 문항", "중요 표시한 문항과 개인 학습 메모를 모아볼 수 있습니다."],
  };
  const [title, desc] = titles[mode];
  els.queryViewTitle.textContent = title;
  els.queryViewDesc.textContent = desc;

  const data = await searchQuestions({
    q: els.searchInput.value.trim(),
    exam_type: els.filterExamType.value,
    grade: els.filterGrade.value,
    subject: els.filterSubject.value,
    mode,
    limit: state.queryLimit,
    offset: state.queryOffset,
  });

  state.queryTotal = data.total;
  els.queryResultCount.textContent = `${data.total.toLocaleString()}건`;
  els.queryStream.replaceChildren();

  if (data.items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = mode === "wrong"
      ? "아직 오답노트에 기록된 문항이 없습니다. 시험지를 풀면 자동으로 저장됩니다."
      : mode === "bookmarked"
        ? "북마크한 문항이 없습니다."
        : "검색 조건에 일치하는 문항이 없습니다.";
    els.queryStream.appendChild(empty);
  } else {
    for (const q of data.items) {
      els.queryStream.appendChild(buildQuestionCard(q, { showPaperTag: true }));
    }
  }

  const totalPages = Math.max(1, Math.ceil(data.total / state.queryLimit));
  const curPage = Math.floor(state.queryOffset / state.queryLimit) + 1;
  els.pageIndicator.textContent = `${curPage} / ${totalPages}`;
  els.btnPrevPage.disabled = curPage <= 1;
  els.btnNextPage.disabled = curPage >= totalPages;
}

/* ==================== 학습 통계 대시보드 ==================== */
async function loadDashboard() {
  await refreshStats();
  const { sessions } = await fetchSessions();
  const s = state.stats;

  const solved = s.solved_count || 0;
  const correct = s.correct_count || 0;
  const acc = solved > 0 ? `${Math.round((correct / solved) * 100)}%` : "-";

  els.dashboardKpis.replaceChildren();
  const kpis = [
    ["DB 수록 고유 시험지", `${(s.unique_papers || 0).toLocaleString()}종`],
    ["DB 수록 고유 문항", `${(s.unique_questions || 0).toLocaleString()}문항`],
    ["법제처 MCP 검증 문항", `${(s.law_verified_questions || 0).toLocaleString()}문항`],
    ["누적 풀이 / 정답률", `${solved.toLocaleString()}문항 (${acc})`],
    ["모의고사 응시 횟수", `${(s.session_count || 0).toLocaleString()}회`],
  ];
  for (const [label, val] of kpis) {
    const card = document.createElement("div");
    card.className = "kpi-card";
    const l = document.createElement("div");
    l.className = "kpi-label";
    l.textContent = label;
    const v = document.createElement("div");
    v.className = "kpi-value tabular-nums";
    v.textContent = val;
    card.append(l, v);
    els.dashboardKpis.appendChild(card);
  }

  els.sessionTableBody.replaceChildren();
  if (sessions.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "아직 저장된 실전 모의고사 응시 기록이 없습니다.";
    tr.appendChild(td);
    els.sessionTableBody.appendChild(tr);
    return;
  }

  for (const row of sessions) {
    const tr = document.createElement("tr");
    for (const text of [
      row.created_at,
      `${row.year} ${row.exam_title}`,
      row.subject_name,
      `${row.correct_count} / ${row.total_count}`,
      `${row.score}점`,
      formatTime(row.elapsed_seconds),
    ]) {
      const td = document.createElement("td");
      td.className = "tabular-nums";
      td.textContent = text;
      tr.appendChild(td);
    }
    els.sessionTableBody.appendChild(tr);
  }
}

/* ==================== 이벤트 바인딩 & 초기화 ==================== */
function setupDialogLightDismissFallback() {
  const dialog = els.resultDialog;
  if (!("closedBy" in HTMLDialogElement.prototype)) {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) dialog.close();
    });
  }
  els.btnCloseResultDialog.addEventListener("click", () => dialog.close());
  els.btnConfirmResultDialog.addEventListener("click", () => dialog.close());
}

async function init() {
  setupDialogLightDismissFallback();
  await refreshStats();
  syncFilterOptions();
  await loadPaperList();

  els.btnToggleSidebar.addEventListener("click", () => {
    els.sidebar.classList.toggle("is-open");
  });

  for (const tab of els.navTabs) {
    tab.addEventListener("click", async () => {
      const view = tab.dataset.view;
      switchView(view);
      if (view === "papers") await loadPaperList();
      else if (["search", "wrong", "bookmarked"].includes(view)) {
        state.queryOffset = 0;
        await loadQueryView(view);
      } else if (view === "dashboard") {
        await loadDashboard();
      }
    });
  }

  for (const sel of [els.filterExamType, els.filterGrade, els.filterSeries, els.filterYear, els.filterSubject]) {
    sel.addEventListener("change", async () => {
      syncFilterOptions();
      if (state.currentView === "papers") await loadPaperList();
      else if (["search", "wrong", "bookmarked"].includes(state.currentView)) {
        state.queryOffset = 0;
        await loadQueryView(state.currentView);
      }
    });
  }

  els.btnResetFilters.addEventListener("click", async () => {
    els.filterExamType.value = "";
    els.filterGrade.value = "";
    els.filterSeries.value = "";
    els.filterYear.value = "";
    els.filterSubject.value = "";
    syncFilterOptions();
    if (state.currentView === "papers") await loadPaperList();
  });

  els.btnBackToPapers.addEventListener("click", () => {
    switchView("papers");
    loadPaperList();
  });

  for (const btn of els.modeBtns) {
    btn.addEventListener("click", () => {
      state.solveMode = btn.dataset.solveMode;
      state.examSubmitted = false;
      for (const b of els.modeBtns) b.classList.toggle("is-active", b === btn);
      els.btnSubmitExam.hidden = state.solveMode !== "exam";
      renderSolveStream();
      renderOMR();
    });
  }

  els.btnSubmitExam.addEventListener("click", submitExam);

  els.searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    state.queryOffset = 0;
    const mode = ["wrong", "bookmarked"].includes(state.currentView) ? state.currentView : "search";
    await loadQueryView(mode);
  });

  els.btnPrevPage.addEventListener("click", async () => {
    state.queryOffset = Math.max(0, state.queryOffset - state.queryLimit);
    await loadQueryView(state.currentView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  els.btnNextPage.addEventListener("click", async () => {
    state.queryOffset += state.queryLimit;
    await loadQueryView(state.currentView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

init().catch((err) => {
  console.error(err);
  els.paperGrid.textContent = `초기화 오류: ${err.message}`;
});

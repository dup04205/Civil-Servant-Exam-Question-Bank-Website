import {
  fetchFilters,
  fetchPaperDetail,
  fetchPapers,
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
  currentStep: "select", // select | solve | review | wrong
  selectedExamType: "국가직",
  selectedGrade: "9급",
  selectedSeries: "",
  currentPaper: null,
  questions: [],
  reviewFilter: "all",   // all | wrong | correct
  wrongMode: "wrong",    // wrong | bookmarked | all
  wrongOffset: 0,
  wrongLimit: 20,
  timerSeconds: 0,
  timerId: null,
};

const els = {
  btnHome: document.getElementById("btnHome"),
  stepBtns: document.querySelectorAll(".step-btn"),
  navWrongCount: document.getElementById("navWrongCount"),
  headerContext: document.getElementById("headerContext"),
  // Step sections
  stepSelect: document.getElementById("stepSelect"),
  stepSolve: document.getElementById("stepSolve"),
  stepReview: document.getElementById("stepReview"),
  stepWrong: document.getElementById("stepWrong"),
  // Step 1: Select
  segmentBtns: document.querySelectorAll(".segment-btn"),
  seriesCountLabel: document.getElementById("seriesCountLabel"),
  seriesGrid: document.getElementById("seriesGrid"),
  paperPickerBlock: document.getElementById("paperPickerBlock"),
  selectedSeriesTitle: document.getElementById("selectedSeriesTitle"),
  pickerYear: document.getElementById("pickerYear"),
  pickerSubject: document.getElementById("pickerSubject"),
  paperList: document.getElementById("paperList"),
  // Step 2: Solve
  btnBackToSelect: document.getElementById("btnBackToSelect"),
  solveTitle: document.getElementById("solveTitle"),
  solveMeta: document.getElementById("solveMeta"),
  solveTimer: document.getElementById("solveTimer"),
  solveProgress: document.getElementById("solveProgress"),
  btnGoReview: document.getElementById("btnGoReview"),
  btnGoReviewBottom: document.getElementById("btnGoReviewBottom"),
  btnResetPaperAnswers: document.getElementById("btnResetPaperAnswers"),
  solveQuestionList: document.getElementById("solveQuestionList"),
  solveOmrNums: document.getElementById("solveOmrNums"),
  // Step 3: Review
  reviewPaperName: document.getElementById("reviewPaperName"),
  reviewScoreText: document.getElementById("reviewScoreText"),
  reviewFilterBtns: document.querySelectorAll("[data-review-filter]"),
  btnGoWrongFromReview: document.getElementById("btnGoWrongFromReview"),
  btnGoWrongBottom: document.getElementById("btnGoWrongBottom"),
  btnBackToSolve: document.getElementById("btnBackToSolve"),
  reviewQuestionList: document.getElementById("reviewQuestionList"),
  // Step 4: Wrong
  wrongSearchForm: document.getElementById("wrongSearchForm"),
  wrongSearchInput: document.getElementById("wrongSearchInput"),
  wrongModeBtns: document.querySelectorAll("[data-wrong-mode]"),
  wrongTotalCount: document.getElementById("wrongTotalCount"),
  wrongQuestionList: document.getElementById("wrongQuestionList"),
  btnWrongPrev: document.getElementById("btnWrongPrev"),
  btnWrongNext: document.getElementById("btnWrongNext"),
  wrongPageLabel: document.getElementById("wrongPageLabel"),
  // Dialog
  scoreDialog: document.getElementById("scoreDialog"),
  scoreDialogBody: document.getElementById("scoreDialogBody"),
  btnCloseScoreDialog: document.getElementById("btnCloseScoreDialog"),
  btnConfirmScoreDialog: document.getElementById("btnConfirmScoreDialog"),
};

/* ==================== 공통 유틸 ==================== */
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
  els.solveTimer.textContent = "00:00";
  state.timerId = setInterval(() => {
    state.timerSeconds++;
    els.solveTimer.textContent = formatTime(state.timerSeconds);
  }, 1000);
}

function cleanUserText(text) {
  if (!text) return "";
  return text
    .replace(/\[법제처 국가법령정보센터\(MCP\)\s*법령 검증\]/g, "[관련 법령]")
    .replace(/법제처\(migrated-claude_korean_law\)\s*검증 보완/g, "공식 정답")
    .replace(/\(법령ID:\s*\d+,\s*MST:\s*\d+,\s*/g, "(");
}

function parseAnswerNums(ansStr) {
  return (ansStr || "")
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);
}

function isQuestionCorrect(q) {
  const sel = q.user_state?.selected_choice;
  if (!sel) return false;
  return parseAnswerNums(q.answer).includes(Number(sel));
}

function setStep(stepName) {
  state.currentStep = stepName;
  if (stepName !== "solve") stopTimer();

  els.stepBtns.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.step === stepName);
  });

  els.stepSelect.classList.toggle("is-active", stepName === "select");
  els.stepSolve.classList.toggle("is-active", stepName === "solve");
  els.stepReview.classList.toggle("is-active", stepName === "review");
  els.stepWrong.classList.toggle("is-active", stepName === "wrong");

  if (state.currentPaper) {
    els.headerContext.textContent = `${state.currentPaper.year} ${state.currentPaper.exam_type} ${state.currentPaper.grade} · ${state.currentPaper.subject_name}`;
  } else if (state.selectedSeries) {
    els.headerContext.textContent = `${state.selectedExamType} ${state.selectedGrade} · ${state.selectedSeries}`;
  } else {
    els.headerContext.textContent = "직렬을 선택해 시작하세요";
  }

  window.scrollTo({ top: 0, behavior: "instant" });
}

async function refreshGlobalCounts() {
  const data = await fetchFilters();
  state.hierarchy = data.hierarchy;
  els.navWrongCount.textContent = String(data.stats?.wrong_count || 0);
}

/* ==================== 1단계: 직렬 선택 ==================== */
function renderSeriesGrid() {
  const seriesMap = state.hierarchy?.[state.selectedExamType]?.[state.selectedGrade] || {};
  const seriesNames = Object.keys(seriesMap).sort((a, b) => {
    if (a.startsWith("00_")) return -1;
    if (b.startsWith("00_")) return 1;
    return a.localeCompare(b, "ko");
  });

  els.seriesCountLabel.textContent = `${seriesNames.length}개 직렬`;
  els.seriesGrid.replaceChildren();

  for (const name of seriesNames) {
    const info = seriesMap[name];
    const displayName = name.replace(/^00_/, "").replaceAll("_", " · ");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `series-card ${state.selectedSeries === name ? "is-selected" : ""}`;
    btn.addEventListener("click", () => selectSeries(name));

    const title = document.createElement("span");
    title.className = "series-name";
    title.textContent = displayName;

    const meta = document.createElement("span");
    meta.className = "series-meta tabular-nums";
    meta.textContent = `${info.subjects.length}과목 · ${info.years[info.years.length - 1]}–${info.years[0]}`;

    btn.append(title, meta);
    els.seriesGrid.appendChild(btn);
  }
}

async function selectSeries(seriesName) {
  state.selectedSeries = seriesName;
  renderSeriesGrid();

  const info = state.hierarchy?.[state.selectedExamType]?.[state.selectedGrade]?.[seriesName];
  if (!info) return;

  const displayName = seriesName.replace(/^00_/, "").replaceAll("_", " · ");
  els.selectedSeriesTitle.textContent = `${state.selectedExamType} ${state.selectedGrade} · ${displayName} 시험지`;
  els.headerContext.textContent = `${state.selectedExamType} ${state.selectedGrade} · ${displayName}`;

  populateSelect(els.pickerYear, info.years, "전체 연도");
  populateSelect(els.pickerSubject, info.subjects, "전체 과목");

  els.paperPickerBlock.hidden = false;
  await loadSeriesPapers();
  els.paperPickerBlock.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function populateSelect(selectEl, items, defaultLabel) {
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
}

async function loadSeriesPapers() {
  const { papers } = await fetchPapers({
    exam_type: state.selectedExamType,
    grade: state.selectedGrade,
    series: state.selectedSeries,
    year: els.pickerYear.value,
    subject: els.pickerSubject.value,
  });

  els.paperList.replaceChildren();
  if (papers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-box";
    empty.textContent = "선택한 조건의 시험지가 없습니다.";
    els.paperList.appendChild(empty);
    return;
  }

  for (const p of papers) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "paper-row";
    row.addEventListener("click", () => openPaperToSolve(p.subject_row_id));

    const left = document.createElement("div");
    left.className = "paper-row-left";

    const yr = document.createElement("span");
    yr.className = "paper-year tabular-nums";
    yr.textContent = `${p.year}`;

    const subj = document.createElement("span");
    subj.className = "paper-subject";
    subj.textContent = p.subject_name;

    const booklet = document.createElement("span");
    booklet.className = "paper-booklet";
    booklet.textContent = `${p.booklet_type || "대표"}책형 · ${p.total_questions}문항`;

    left.append(yr, subj, booklet);

    const right = document.createElement("div");
    right.className = "paper-row-right tabular-nums";

    const status = document.createElement("span");
    status.textContent = p.solved_count > 0 ? `이전 기록 ${p.correct_count}/${p.total_questions}` : "";

    const go = document.createElement("span");
    go.className = "paper-go";
    go.textContent = "문제 풀기 →";

    right.append(status, go);
    row.append(left, right);
    els.paperList.appendChild(row);
  }
}

/* ==================== 2단계: 문제 풀기 ==================== */
async function openPaperToSolve(subjectRowId) {
  const data = await fetchPaperDetail(subjectRowId);
  state.currentPaper = data.paper;
  state.questions = data.questions;

  els.solveTitle.textContent = `${data.paper.year}년 ${data.paper.subject_name}`;
  els.solveMeta.textContent = `${data.paper.exam_type} ${data.paper.grade} · ${data.paper.booklet_type || "대표"}책형 · ${data.questions.length}문항`;

  setStep("solve");
  renderSolveQuestions();
  renderSolveOmr();
  startTimer();
}

function renderSolveQuestions() {
  els.solveQuestionList.replaceChildren();
  for (const q of state.questions) {
    els.solveQuestionList.appendChild(buildQuestionBlock(q, { mode: "solve" }));
  }
}

function renderSolveOmr() {
  els.solveOmrNums.replaceChildren();
  let answered = 0;

  for (const q of state.questions) {
    const hasSel = Boolean(q.user_state?.selected_choice);
    if (hasSel) answered++;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `omr-num-btn tabular-nums ${hasSel ? "is-answered" : ""}`;
    btn.textContent = String(q.q_no);
    btn.addEventListener("click", () => {
      document.getElementById(`solve-q-${q.q_no}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    els.solveOmrNums.appendChild(btn);
  }

  els.solveProgress.textContent = `${answered} / ${state.questions.length}`;
}

async function finishSolveAndGoReview() {
  stopTimer();

  const total = state.questions.length;
  let correct = 0;
  let answered = 0;

  for (const q of state.questions) {
    if (q.user_state?.selected_choice) {
      answered++;
      if (isQuestionCorrect(q)) correct++;
    }
  }

  const score = total > 0 ? Math.round((correct / total) * 1000) / 10 : 0;

  if (state.currentPaper) {
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
  }

  await refreshGlobalCounts();

  state.reviewFilter = "all";
  els.reviewFilterBtns.forEach((b) => b.classList.toggle("is-active", b.dataset.reviewFilter === "all"));

  els.reviewPaperName.textContent = `${state.currentPaper.year}년 ${state.currentPaper.exam_type} ${state.currentPaper.grade} · ${state.currentPaper.subject_name}`;
  els.reviewScoreText.textContent = `${score}점 (${correct} / ${total} 정답 · ${formatTime(state.timerSeconds)})`;

  setStep("review");
  renderReviewQuestions();

  els.scoreDialogBody.replaceChildren();
  const p1 = document.createElement("p");
  p1.textContent = `총 ${total}문항 중 ${answered}문항을 풀었고, ${correct}문항을 맞혔습니다.`;
  const p2 = document.createElement("p");
  p2.className = "tabular-nums";
  const strong = document.createElement("strong");
  strong.textContent = `점수 ${score}점 · 소요 시간 ${formatTime(state.timerSeconds)}`;
  p2.appendChild(strong);
  els.scoreDialogBody.append(p1, p2);
  els.scoreDialog.showModal();
}

/* ==================== 3단계: 해설 보기 ==================== */
function renderReviewQuestions() {
  els.reviewQuestionList.replaceChildren();

  if (!state.currentPaper || state.questions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-box";
    empty.textContent = "먼저 1단계에서 직렬과 시험지를 선택해 주세요.";
    els.reviewQuestionList.appendChild(empty);
    return;
  }

  const filtered = state.questions.filter((q) => {
    if (state.reviewFilter === "wrong") return !isQuestionCorrect(q);
    if (state.reviewFilter === "correct") return isQuestionCorrect(q);
    return true;
  });

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-box";
    empty.textContent = "해당 조건의 문항이 없습니다.";
    els.reviewQuestionList.appendChild(empty);
    return;
  }

  for (const q of filtered) {
    els.reviewQuestionList.appendChild(buildQuestionBlock(q, { mode: "review" }));
  }
}

/* ==================== 4단계: 오답노트 ==================== */
async function loadWrongList() {
  const data = await searchQuestions({
    q: els.wrongSearchInput.value.trim(),
    mode: state.wrongMode,
    limit: state.wrongLimit,
    offset: state.wrongOffset,
  });

  els.wrongTotalCount.textContent = `${data.total.toLocaleString()}문항`;
  els.wrongQuestionList.replaceChildren();

  if (data.items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-box";
    empty.textContent =
      state.wrongMode === "wrong"
        ? "틀린 문항이 아직 없습니다. 문제를 풀면 오답이 자동으로 여기에 모입니다."
        : state.wrongMode === "bookmarked"
          ? "북마크한 문항이 없습니다."
          : "검색 결과가 없습니다.";
    els.wrongQuestionList.appendChild(empty);
  } else {
    for (const q of data.items) {
      els.wrongQuestionList.appendChild(buildQuestionBlock(q, { mode: "wrong", showPaperTag: true }));
    }
  }

  const totalPages = Math.max(1, Math.ceil(data.total / state.wrongLimit));
  const curPage = Math.floor(state.wrongOffset / state.wrongLimit) + 1;
  els.wrongPageLabel.textContent = `${curPage} / ${totalPages}`;
  els.btnWrongPrev.disabled = curPage <= 1;
  els.btnWrongNext.disabled = curPage >= totalPages;
}

/* ==================== 통일된 문항 렌더링 컴포넌트 ==================== */
function buildQuestionBlock(q, { mode = "solve", showPaperTag = false } = {}) {
  const item = document.createElement("article");
  item.className = "q-item";
  if (mode === "solve") item.id = `solve-q-${q.q_no}`;

  // 1. 상단 메타
  const top = document.createElement("div");
  top.className = "q-top";

  const topLeft = document.createElement("div");
  topLeft.className = "q-top-left";

  const noEl = document.createElement("span");
  noEl.className = "q-no tabular-nums";
  noEl.textContent = String(q.q_no).padStart(2, "0");
  topLeft.appendChild(noEl);

  if (showPaperTag && q.paper_meta) {
    const ctx = document.createElement("span");
    ctx.className = "q-context-tag";
    ctx.textContent = `${q.paper_meta.year} ${q.paper_meta.exam_type} ${q.paper_meta.grade} · ${q.paper_meta.subject_name}`;
    topLeft.appendChild(ctx);
  }

  if (mode === "review" || mode === "wrong") {
    const sel = q.user_state?.selected_choice;
    const judge = document.createElement("span");
    const ok = isQuestionCorrect(q);
    judge.className = `q-judge-tag ${ok ? "is-correct" : "is-wrong"}`;
    judge.textContent = !sel ? "미응답" : ok ? "정답" : "오답";
    topLeft.appendChild(judge);
  }

  const bookmarkBtn = document.createElement("button");
  bookmarkBtn.type = "button";
  bookmarkBtn.className = `q-bookmark-btn ${q.user_state?.is_bookmarked ? "is-active" : ""}`;
  bookmarkBtn.textContent = q.user_state?.is_bookmarked ? "북마크됨" : "북마크";
  bookmarkBtn.addEventListener("click", async () => {
    const next = !q.user_state.is_bookmarked;
    q.user_state.is_bookmarked = next;
    bookmarkBtn.classList.toggle("is-active", next);
    bookmarkBtn.textContent = next ? "북마크됨" : "북마크";
    await saveAttempt({ question_id: q.question_id, is_bookmarked: next });
  });

  top.append(topLeft, bookmarkBtn);
  item.appendChild(top);

  // 2. 발문
  const stemEl = document.createElement("h3");
  stemEl.className = "q-stem";
  stemEl.appendChild(renderInlineFragment(q.stem));
  item.appendChild(stemEl);

  // 3. 지문 (통일 문단/표)
  if (q.passage) {
    const passageBox = document.createElement("div");
    passageBox.className = "q-passage";
    renderStructuredContent(q.passage, passageBox, false);
    item.appendChild(passageBox);
  }

  // 4. <보기>
  if (q.sub_passage) {
    const bogiBox = document.createElement("div");
    bogiBox.className = "q-bogi-box";
    const bogiHead = document.createElement("div");
    bogiHead.className = "q-bogi-header";
    bogiHead.textContent = "보 기";
    bogiBox.appendChild(bogiHead);
    renderStructuredContent(q.sub_passage, bogiBox, true);
    item.appendChild(bogiBox);
  }

  // 5. 선지
  const choicesWrap = document.createElement("div");
  choicesWrap.className = "q-choices";
  const ansNums = parseAnswerNums(q.answer);
  const showAnswerState = mode === "review" || (mode === "wrong" && Boolean(q._revealed));

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

    if (showAnswerState) {
      if (isAns) {
        btn.classList.add("is-correct");
        markSpan.textContent = isSelected ? "정답 (내 선택)" : "정답";
      } else if (isSelected) {
        btn.classList.add("is-wrong");
        markSpan.textContent = "내 선택";
      }
    } else if (isSelected) {
      btn.classList.add("is-selected");
    }

    btn.append(noSpan, textSpan, markSpan);

    if (mode === "solve" || mode === "wrong") {
      btn.addEventListener("click", async () => {
        const correctFlag = ansNums.includes(ch.no) ? 1 : 0;
        q.user_state.selected_choice = String(ch.no);
        q.user_state.is_correct = correctFlag;
        if (mode === "wrong") q._revealed = true;

        await saveAttempt({
          question_id: q.question_id,
          selected_choice: String(ch.no),
          is_correct: correctFlag,
        });

        const fresh = buildQuestionBlock(q, { mode, showPaperTag });
        item.replaceWith(fresh);
        if (mode === "solve") renderSolveOmr();
        refreshGlobalCounts();
      });
    }

    choicesWrap.appendChild(btn);
  }
  item.appendChild(choicesWrap);

  // 6. 해설 영역 (3단계 해설에서는 항상 표시, 4단계 오답에서는 다시 풀거나 토글 시 표시)
  if (mode === "review" || mode === "wrong") {
    const expPanel = buildExplanationPanel(q);
    if (mode === "wrong" && !q._revealed) {
      expPanel.hidden = true;
      const revealBtn = document.createElement("button");
      revealBtn.type = "button";
      revealBtn.className = "btn-outline";
      revealBtn.style.marginTop = "12px";
      revealBtn.textContent = "해설 보기";
      revealBtn.addEventListener("click", () => {
        expPanel.hidden = !expPanel.hidden;
        revealBtn.textContent = expPanel.hidden ? "해설 보기" : "해설 접기";
      });
      item.append(revealBtn, expPanel);
    } else {
      item.appendChild(expPanel);
    }
  }

  return item;
}

function buildExplanationPanel(q) {
  const panel = document.createElement("div");
  panel.className = "exp-panel";
  const exp = q.explanation || {};

  const ansLine = document.createElement("div");
  ansLine.className = "exp-answer-line";
  const ansText = document.createElement("span");
  ansText.textContent = `정답 ${q.answer}번`;
  const repeatText = document.createElement("span");
  repeatText.style.fontSize = "12px";
  repeatText.style.fontWeight = "500";
  repeatText.style.color = "var(--ink-muted)";
  repeatText.textContent = exp.repeat_count > 1 ? exp.repeat_str : "";
  ansLine.append(ansText, repeatText);
  panel.appendChild(ansLine);

  if (exp.overall_commentary) {
    const overall = document.createElement("div");
    overall.className = "exp-overall";
    overall.textContent = cleanUserText(exp.overall_commentary);
    panel.appendChild(overall);
  }

  if (exp.law_refs && exp.law_refs.length > 0) {
    const laws = document.createElement("div");
    laws.className = "exp-laws";
    const title = document.createElement("div");
    title.className = "exp-laws-title";
    title.textContent = "관련 법령";
    laws.appendChild(title);
    for (const lr of exp.law_refs) {
      const row = document.createElement("div");
      row.className = "exp-law-row";
      row.textContent = `• 「${lr.name}」 (시행 ${lr.effective_date}) — ${lr.note}`;
      laws.appendChild(row);
    }
    panel.appendChild(laws);
  }

  if (exp.choice_explanations && exp.choice_explanations.length > 0) {
    const list = document.createElement("div");
    list.className = "exp-choices";
    for (const ce of exp.choice_explanations) {
      const row = document.createElement("div");
      row.className = "exp-choice-row";
      const strong = document.createElement("strong");
      const jLabel = ce.judgment.startsWith("[") ? ce.judgment : `[${ce.judgment}]`;
      strong.textContent = `${getCircledNumber(ce.no)} ${jLabel} `;
      row.append(strong, document.createTextNode(ce.commentary));
      list.appendChild(row);
    }
    panel.appendChild(list);
  }

  const memoRow = document.createElement("div");
  memoRow.className = "memo-row";
  const memoInput = document.createElement("input");
  memoInput.type = "text";
  memoInput.value = q.user_state?.memo || "";
  memoInput.placeholder = "개인 메모를 남겨두면 자동 저장됩니다";
  const memoBtn = document.createElement("button");
  memoBtn.type = "button";
  memoBtn.className = "btn-outline";
  memoBtn.textContent = "메모 저장";
  memoBtn.addEventListener("click", async () => {
    q.user_state.memo = memoInput.value;
    await saveAttempt({ question_id: q.question_id, memo: memoInput.value });
    memoBtn.textContent = "저장됨";
    setTimeout(() => { memoBtn.textContent = "메모 저장"; }, 1200);
  });
  memoRow.append(memoInput, memoBtn);
  panel.appendChild(memoRow);

  return panel;
}

/* ==================== 이벤트 & 초기화 ==================== */
function setupDialog() {
  const dialog = els.scoreDialog;
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
  els.btnCloseScoreDialog.addEventListener("click", () => dialog.close());
  els.btnConfirmScoreDialog.addEventListener("click", () => dialog.close());
}

async function init() {
  setupDialog();
  await refreshGlobalCounts();
  renderSeriesGrid();

  // 상단 홈 & 4단계 네비게이션
  els.btnHome.addEventListener("click", (e) => {
    e.preventDefault();
    setStep("select");
  });

  els.stepBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = btn.dataset.step;
      if ((target === "solve" || target === "review") && !state.currentPaper) {
        setStep("select");
        return;
      }
      setStep(target);
      if (target === "review") renderReviewQuestions();
      if (target === "wrong") {
        state.wrongOffset = 0;
        await loadWrongList();
      }
    });
  });

  // 1단계: 시험구분/직급 세그먼트
  els.segmentBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedExamType = btn.dataset.exam;
      state.selectedGrade = btn.dataset.grade;
      state.selectedSeries = "";
      els.segmentBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
      els.paperPickerBlock.hidden = true;
      renderSeriesGrid();
    });
  });

  els.pickerYear.addEventListener("change", loadSeriesPapers);
  els.pickerSubject.addEventListener("change", loadSeriesPapers);

  // 2단계: 문제 풀기 버튼
  els.btnBackToSelect.addEventListener("click", () => setStep("select"));
  els.btnGoReview.addEventListener("click", finishSolveAndGoReview);
  els.btnGoReviewBottom.addEventListener("click", finishSolveAndGoReview);

  els.btnResetPaperAnswers.addEventListener("click", async () => {
    for (const q of state.questions) {
      if (q.user_state?.selected_choice) {
        q.user_state.selected_choice = "";
        q.user_state.is_correct = null;
        await saveAttempt({ question_id: q.question_id, selected_choice: "", is_correct: null });
      }
    }
    renderSolveQuestions();
    renderSolveOmr();
    refreshGlobalCounts();
  });

  // 3단계: 해설 필터 & 오답 이동
  els.reviewFilterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.reviewFilter = btn.dataset.reviewFilter;
      els.reviewFilterBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
      renderReviewQuestions();
    });
  });

  els.btnBackToSolve.addEventListener("click", () => {
    setStep("solve");
    renderSolveQuestions();
    renderSolveOmr();
  });

  const goWrongHandler = async () => {
    state.wrongMode = "wrong";
    state.wrongOffset = 0;
    els.wrongModeBtns.forEach((b) => b.classList.toggle("is-active", b.dataset.wrongMode === "wrong"));
    setStep("wrong");
    await loadWrongList();
  };
  els.btnGoWrongFromReview.addEventListener("click", goWrongHandler);
  els.btnGoWrongBottom.addEventListener("click", goWrongHandler);

  // 4단계: 오답노트
  els.wrongModeBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.wrongMode = btn.dataset.wrongMode;
      state.wrongOffset = 0;
      els.wrongModeBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
      await loadWrongList();
    });
  });

  els.wrongSearchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    state.wrongOffset = 0;
    await loadWrongList();
  });

  els.btnWrongPrev.addEventListener("click", async () => {
    state.wrongOffset = Math.max(0, state.wrongOffset - state.wrongLimit);
    await loadWrongList();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  els.btnWrongNext.addEventListener("click", async () => {
    state.wrongOffset += state.wrongLimit;
    await loadWrongList();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

init().catch((err) => {
  console.error(err);
});

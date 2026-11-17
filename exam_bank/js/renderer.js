/**
 * 문제 본문 문단·표·보기·인라인 서식 통일 렌더러
 * - innerHTML을 사용하지 않고 안전한 DOM 노드로만 조립 (XSS 원천 차단)
 * - 모든 과목/연도/시험지의 문단 간격, 표, 보기(ㄱ·ㄴ·ㄷ·ㄹ), 밑줄, 첨자, 빈칸, 수식 스타일을 통일
 */

const CIRCLED_NUMS = ["①", "②", "③", "④", "⑤"];

export function getCircledNumber(n) {
  return CIRCLED_NUMS[n - 1] || `${n}.`;
}

/**
 * 인라인 텍스트(<u>, <i>, ^(sup), _(sub), [   ], $latex$, [이미지: ...])를
 * 통일된 스타일의 DOM Fragment로 변환합니다.
 */
export function renderInlineFragment(text) {
  const frag = document.createDocumentFragment();
  if (!text) return frag;

  // 토큰 정규식: <u>...</u> | <i>...</i> | ^(...) | _(...) | [   ] | $...$ | [이미지: ...]
  const tokenRe = /(<u>[\s\S]*?<\/u>|<i>[\s\S]*?<\/i>|\^\([^)]+\)|_\([^)]+\)|\[\s{2,}\]|\$[^$]+\$|\[이미지:[^\]]+\])/g;
  let lastIdx = 0;
  let match;

  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIdx) {
      frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
    }
    const tok = match[0];

    if (tok.startsWith("<u>") && tok.endsWith("</u>")) {
      const span = document.createElement("span");
      span.className = "q-underline";
      span.appendChild(renderInlineFragment(tok.slice(3, -4)));
      frag.appendChild(span);
    } else if (tok.startsWith("<i>") && tok.endsWith("</i>")) {
      const em = document.createElement("em");
      em.className = "q-italic";
      em.appendChild(renderInlineFragment(tok.slice(3, -4)));
      frag.appendChild(em);
    } else if (tok.startsWith("^(") && tok.endsWith(")")) {
      const sup = document.createElement("sup");
      sup.textContent = tok.slice(2, -1);
      frag.appendChild(sup);
    } else if (tok.startsWith("_(") && tok.endsWith(")")) {
      const sub = document.createElement("sub");
      sub.textContent = tok.slice(2, -1);
      frag.appendChild(sub);
    } else if (/^\[\s{2,}\]$/.test(tok)) {
      const blank = document.createElement("span");
      blank.className = "q-blank";
      blank.textContent = "\u00A0";
      frag.appendChild(blank);
    } else if (tok.startsWith("$") && tok.endsWith("$")) {
      const math = document.createElement("code");
      math.className = "q-math";
      math.textContent = formatReadableMath(tok.slice(1, -1));
      frag.appendChild(math);
    } else if (tok.startsWith("[이미지:")) {
      const imgBadge = document.createElement("span");
      imgBadge.className = "q-img-tag";
      imgBadge.textContent = tok;
      frag.appendChild(imgBadge);
    } else {
      frag.appendChild(document.createTextNode(tok));
    }
    lastIdx = tokenRe.lastIndex;
  }

  if (lastIdx < text.length) {
    frag.appendChild(document.createTextNode(text.slice(lastIdx)));
  }
  return frag;
}

function formatReadableMath(latex) {
  return latex
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\pm/g, "±")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\rightarrow/g, "→")
    .replace(/\\sim/g, "~")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 마크다운 표 블록(| col1 | col2 |)을 responsive-table 가이드 준수 테이블 DOM으로 변환합니다.
 */
function buildUnifiedTable(tableLines) {
  const parseRow = (line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  const rows = tableLines
    .filter((ln) => !/^\s*\|[\s\-:|]+\|\s*$/.test(ln))
    .map(parseRow);

  const wrapper = document.createElement("div");
  wrapper.className = "table-wrapper";
  wrapper.setAttribute("tabindex", "0");
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-label", "제시문 도표");

  if (rows.length === 0) return wrapper;

  const table = document.createElement("table");
  table.className = "data-table";

  const thead = document.createElement("thead");
  const headTr = document.createElement("tr");
  for (const h of rows[0]) {
    const th = document.createElement("th");
    th.appendChild(renderInlineFragment(h));
    headTr.appendChild(th);
  }
  thead.appendChild(headTr);
  table.appendChild(thead);

  if (rows.length > 1) {
    const tbody = document.createElement("tbody");
    for (let i = 1; i < rows.length; i++) {
      const tr = document.createElement("tr");
      for (const cell of rows[i]) {
        const td = document.createElement("td");
        td.appendChild(renderInlineFragment(cell));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  wrapper.appendChild(table);
  return wrapper;
}

/**
 * 지문/사례/보기 텍스트를 문단, 표, 상자 라벨, ㄱ·ㄴ·ㄷ·ㄹ 항목으로 정규화하여 렌더링합니다.
 */
export function renderStructuredContent(rawText, container, isBogi = false) {
  if (!rawText) return;
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  const lines = normalized.split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }

    // 1. 마크다운 표 블록 감지
    if (line.startsWith("|") && line.includes("|", 1)) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      container.appendChild(buildUnifiedTable(tableLines));
      continue;
    }

    // 2. [상 황], [조 건], [보기/상자], [사 례] 등 라벨 줄 통일 처리
    const boxLabelMatch = line.match(/^\[([가-힣A-Za-z0-9\s/]+)\]$/);
    if (boxLabelMatch) {
      const labelText = boxLabelMatch[1].replace(/\s+/g, " ").trim();
      if (!isBogi || (labelText !== "보기" && labelText !== "보 기" && labelText !== "보기/상자")) {
        const badge = document.createElement("div");
        badge.className = "q-box-label";
        badge.textContent = labelText;
        container.appendChild(badge);
      }
      i++;
      continue;
    }

    // 3. ㄱ. ㄴ. ㄷ. ㄹ. ㅁ. 보기 항목 행 통일 정렬
    const bogiMatch = line.match(/^([ㄱㄴㄷㄹㅁㅂ])\s*[.．)）:：]?\s+(.+)$/);
    if (bogiMatch) {
      const row = document.createElement("div");
      row.className = "q-bogi-row";
      const sym = document.createElement("span");
      sym.className = "q-bogi-sym";
      sym.textContent = `${bogiMatch[1]}.`;
      const body = document.createElement("div");
      body.appendChild(renderInlineFragment(bogiMatch[2].trim()));
      row.append(sym, body);
      container.appendChild(row);
      i++;
      continue;
    }

    // 4. 일반 본문 문단 (<p>)
    const p = document.createElement("p");
    p.appendChild(renderInlineFragment(line));
    container.appendChild(p);
    i++;
  }
}

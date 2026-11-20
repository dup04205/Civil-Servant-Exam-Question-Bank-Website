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
 * 프로그래밍 코드 라인인지 판별합니다.
 */
function isCodeLine(line) {
  const t = line.trim();
  if (!t) return false;
  return (
    /^#(include|define|ifdef|ifndef|endif)\b/.test(t) ||
    /^(int|void|char|float|double|long|short|struct|typedef|class|public|private|protected|static|using|namespace|return|break|continue|switch|case|default|import|from|def|elif|else|try|except|finally|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|FROM|WHERE|GROUP BY|ORDER BY)\b/.test(t) ||
    /\b(printf|scanf|cout|cin|System\.out|println|print|malloc|free|sizeof)\s*\(/.test(t) ||
    /^(for|while|if|do)\s*\(/.test(t) ||
    /^[{}];?$/.test(t) ||
    /;\s*$/.test(t)
  );
}

/**
 * 한 줄로 붙었거나 들여쓰기가 소실된 C/Java/Python/SQL 코드를
 * 줄바꿈 및 중괄호·콜론 깊이 기반 들여쓰기로 정돈합니다.
 */
function formatCodeLines(rawLines) {
  // 1단계: 한 줄에 붙은 중괄호/세미콜론 분리 (예: "{ int *ip;" -> "{\nint *ip;")
  const expanded = [];
  for (const raw of rawLines) {
    let line = raw.replace(/\t/g, "    ");
    const trimmed = line.trim();
    if (!trimmed) {
      expanded.push("");
      continue;
    }
    // '{' 뒤에 코드가 바로 붙어 있는 경우 분리 (배열 초기화 "= {1, 2, 3}" 제외)
    if (/^\{\s+\S/.test(trimmed) && !/=\s*\{/.test(trimmed)) {
      expanded.push("{");
      expanded.push(trimmed.slice(1).trim());
      continue;
    }
    // 한 줄에 여러 문장이 세미콜론으로 붙어 있고 for(...) 헤더가 아닌 경우 분리
    if (
      !/^\s*for\s*\(/.test(trimmed) &&
      (trimmed.match(/;/g) || []).length >= 2 &&
      trimmed.length > 45
    ) {
      const parts = trimmed.split(/;\s*/).filter(Boolean);
      for (let idx = 0; idx < parts.length; idx++) {
        const suffix = idx < parts.length - 1 || trimmed.endsWith(";") ? ";" : "";
        expanded.push(parts[idx] + suffix);
      }
      continue;
    }
    expanded.push(line);
  }

  // 2단계: 이미 원본 들여쓰기가 살아있는지 확인 (Python 등)
  const hasExistingIndent = expanded.some((l) => /^\s{2,}\S/.test(l));
  if (hasExistingIndent) {
    return expanded;
  }

  // 3단계: 중괄호({}) 또는 Python 콜론(:) 기반 자동 들여쓰기 복원
  const usesBraces = expanded.some((l) => /[{}]/.test(l));
  const formatted = [];
  let depth = 0;

  for (const raw of expanded) {
    const t = raw.trim();
    if (!t) {
      formatted.push("");
      continue;
    }

    if (usesBraces) {
      const leadingClose = (t.match(/^\}+/) || [""])[0].length;
      if (leadingClose > 0) {
        depth = Math.max(0, depth - leadingClose);
      }
      formatted.push("    ".repeat(depth) + t);
      const opens = (t.match(/\{/g) || []).length;
      const closes = (t.match(/\}/g) || []).length - leadingClose;
      depth = Math.max(0, depth + opens - closes);
    } else {
      // Python / 의사코드 스타일
      if (/^(elif|else|except|finally)\b/.test(t)) {
        depth = Math.max(0, depth - 1);
      } else if (/^(def|class)\b/.test(t)) {
        depth = 0;
      }
      formatted.push("    ".repeat(depth) + t);
      if (/:\s*$/.test(t)) {
        depth++;
      } else if (/^return\b/.test(t) && depth > 0) {
        depth = Math.max(0, depth - 1);
      }
    }
  }
  return formatted;
}

function buildCodeBlock(codeLines) {
  const pre = document.createElement("pre");
  pre.className = "q-code-block";
  const code = document.createElement("code");
  const formatted = formatCodeLines(codeLines);
  formatted.forEach((ln, idx) => {
    code.appendChild(renderInlineFragment(ln));
    if (idx < formatted.length - 1) {
      code.appendChild(document.createTextNode("\n"));
    }
  });
  pre.appendChild(code);
  return pre;
}

/**
 * 지문/보기 맨 마지막 줄에 짝짓기형 선지 열 헤더(예: <u>(가) (나) (다)</u>)가 붙어 있는 경우
 * 상자 밖(선지 바로 위)으로 분리하기 위해 추출합니다.
 */
export function splitTrailingChoiceHeader(rawText) {
  if (!rawText) return { body: rawText, choiceHeader: "" };
  const lines = rawText.replace(/\r\n/g, "\n").trimEnd().split("\n");
  if (lines.length < 2) return { body: rawText, choiceHeader: "" };

  const lastLine = lines[lines.length - 1].trim();
  const unwrapped = lastLine.replace(/^<u>([\s\S]*?)<\/u>$/, "$1").trim();
  // 2~5개의 짧은 기호 열 헤더 패턴: (가) (나) (다), ㄱ ㄴ ㄷ, A B C 등
  const isHeaderPattern =
    /^(\([가-하]\)|[ㄱ-ㅎ]|[A-E])(\s+(\([가-하]\)|[ㄱ-ㅎ]|[A-E])){1,4}$/.test(unwrapped);

  if (isHeaderPattern) {
    return {
      body: lines.slice(0, -1).join("\n").trimEnd(),
      choiceHeader: lastLine,
    };
  }
  return { body: rawText, choiceHeader: "" };
}

/**
 * 지문/사례/보기 텍스트를 문단, 표, 코드 블록, 상자 라벨, ㄱ·ㄴ·ㄷ·ㄹ 및 ○·• 목록 항목으로 정규화하여 렌더링합니다.
 */
export function renderStructuredContent(rawText, container, isBogi = false) {
  if (!rawText) return;
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  const lines = normalized.split("\n");

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();
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

    // 3. 프로그래밍 코드 블록 감지 (연속 2줄 이상 코드이거나 #include / int main / def 등 명시적 코드 시작)
    if (isCodeLine(line)) {
      const codeLines = [];
      let j = i;
      let codeCount = 0;
      while (j < lines.length) {
        const cur = lines[j];
        const curTrim = cur.trim();
        if (!curTrim) {
          // 빈 줄 뒤에도 코드가 이어지면 포함
          if (j + 1 < lines.length && isCodeLine(lines[j + 1])) {
            codeLines.push("");
            j++;
            continue;
          }
          break;
        }
        if (curTrim.startsWith("|") || /^\[[가-힣A-Za-z0-9\s/]+\]$/.test(curTrim)) break;
        if (isCodeLine(curTrim) || /^\s{2,}/.test(cur) || /[{}();=]/.test(curTrim)) {
          codeLines.push(cur);
          if (isCodeLine(curTrim)) codeCount++;
          j++;
        } else {
          break;
        }
      }
      if (codeCount >= 2 || /^#(include|define)\b|^(int|void)\s+main\b|^def\s+\w+\(/.test(line)) {
        container.appendChild(buildCodeBlock(codeLines));
        i = j;
        continue;
      }
    }

    // 4. ㄱ·ㄴ·ㄷ·ㄹ 및 ○·•·※·(가)·가. 등 보기/목록 항목 행 통일 정렬 (내어쓰기)
    const bogiMatch = line.match(/^([ㄱㄴㄷㄹㅁㅂ])\s*[.．)）:：]?\s+(.+)$/);
    const bulletMatch = line.match(/^([○◦•·▪▫□■◎◈※\-–—])\s+(.+)$/);
    const labelMatch = line.match(/^(\([가-하]\)|[가-하]\.)\s+(.+)$/);

    const isMultiItemInline =
      labelMatch && /\s+(\([나-하]\)|[나-하]\.)\s+/.test(labelMatch[2]);

    if (bogiMatch || bulletMatch || (labelMatch && !isMultiItemInline)) {
      const symText = bogiMatch
        ? `${bogiMatch[1]}.`
        : bulletMatch
          ? bulletMatch[1]
          : labelMatch[1];
      const bodyText = (
        bogiMatch ? bogiMatch[2] : bulletMatch ? bulletMatch[2] : labelMatch[2]
      ).trim();

      const row = document.createElement("div");
      row.className = "q-bogi-row";
      const sym = document.createElement("span");
      sym.className = bulletMatch ? "q-bogi-sym is-bullet" : "q-bogi-sym";
      sym.textContent = symText;
      const body = document.createElement("div");
      body.className = "q-bogi-text";
      body.appendChild(renderInlineFragment(bodyText));
      row.append(sym, body);
      container.appendChild(row);
      i++;
      continue;
    }

    // 5. 일반 본문 문단 (<p>)
    const p = document.createElement("p");
    p.appendChild(renderInlineFragment(line));
    container.appendChild(p);
    i++;
  }
}

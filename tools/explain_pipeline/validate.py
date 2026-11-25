"""검증 JSON 점검. python3 validate.py TASK PID   (TASK = full | bogi)
work/verified/PID.json 구조:
 {"PID-Q1": {"overall_commentary": "출제 영역: 과목 · 주제\\n정답은 ②이다. ...",
             "choices": {"1": "...", ...},
             "bogi": {"ㄱ": {"ox": "O", "text": "..."}, ...}}}   # bogi는 보기 문항만
 - full: needs_rewrite 문항은 overall_commentary·choices 필수, 보기 문항은 bogi 필수
 - bogi: 보기 문항의 bogi만 필수 (다른 키는 넣지 않음)
"""
import sys, json, os, re
from common import *

def check(task, pid):
    P = json.load(open(os.path.join(WORK, 'papers', pid + '.json'), encoding='utf-8'))
    V = json.load(open(os.path.join(WORK, 'verified', pid + '.json'), encoding='utf-8'))
    err = []
    qs = {q['id']: q for q in P['questions']}
    for k in V:
        if k not in qs: err.append(k + ': 시험지에 없는 문항 ID')
    def txtcheck(where, t):
        if not isinstance(t, str) or len(t.strip()) < 15: err.append(where + ': 본문이 비었거나 너무 짧음'); return
        if re.match(r'\s*(\[[OX]\]|\(정답\)|[OX]\s*[.:)])', t): err.append(where + ': 판정 태그를 본문 앞에 붙이지 말 것')
        for b in BANNED:
            if b in t: err.append(where + ': 금지 용어 ' + b)
        for g in GENERIC:
            if g in t: err.append(where + ': 일반 문구 ' + g)
    for qid, q in qs.items():
        v = V.get(qid)
        need_main = task == 'full' and q['needs_rewrite']
        need_bogi = bool(q['bogi'])
        if (need_main or need_bogi) and v is None: err.append(qid + ': 누락'); continue
        if v is None: continue
        if task == 'bogi' and set(v) - {'bogi'}: err.append(qid + ': bogi 작업에는 bogi 키만 허용')
        if need_main or 'overall_commentary' in v:
            oc = v.get('overall_commentary', '')
            txtcheck(qid + ' overall', oc)
            if not oc.startswith('출제 영역: '): err.append(qid + ': overall은 "출제 영역: "으로 시작')
            ans = q['answer']; circ = ''.join(CIRC.get(a.strip(), a) for a in re.split('[,·]', ans))
            if ('정답은 ' + circ) not in oc and ('정답은 ' + CIRC.get(ans[:1], '?')) not in oc:
                err.append(qid + ': overall에 "정답은 ' + circ + '이다" 없음 (공식 정답 ' + ans + ')')
        if need_main or 'choices' in v:
            ch = v.get('choices', {})
            for n in q['choices']:
                txtcheck(qid + ' 선지' + n, ch.get(n))
        if need_bogi:
            bg = v.get('bogi', {})
            for b in q['bogi']:
                x = bg.get(b['symbol'])
                if not isinstance(x, dict): err.append(qid + ' 보기' + b['symbol'] + ': 누락'); continue
                if x.get('ox') not in ('O', 'X'): err.append(qid + ' 보기' + b['symbol'] + ': ox는 O 또는 X')
                txtcheck(qid + ' 보기' + b['symbol'], x.get('text'))
    return err

if __name__ == '__main__':
    e = check(sys.argv[1], sys.argv[2])
    print('\n'.join(e) if e else 'OK'); sys.exit(1 if e else 0)

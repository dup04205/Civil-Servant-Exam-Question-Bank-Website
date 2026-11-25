"""검증 JSON을 해당 시험지의 모든 해설 XML(직렬 공유 포함)에 반영하고 progress.json 갱신.
python3 apply.py TASK PID [PID...]   (validate.py 통과한 것만 반영)
"""
import sys, json, os, re
from xml.sax.saxutils import escape
from common import *
from validate import check

def judgment(polarity, ox):
    if '옳지 않은' in polarity and '조합' in polarity: return '[X] (정답)' if ox == 'X' else '[O]'
    if '조합' in polarity: return '[O] (정답)' if ox == 'O' else '[X]'
    return '[' + ox + ']'

def patch_block(b, v):
    pol = re.search(r'polarity="([^"]*)"', b).group(1).replace('&lt;', '<').replace('&gt;', '>')
    if 'overall_commentary' in v:
        b = re.sub(r'<overall_commentary>.*?</overall_commentary>',
                   lambda m: '<overall_commentary>' + escape(v['overall_commentary']) + '</overall_commentary>', b, count=1, flags=re.S)
    for n, t in v.get('choices', {}).items():
        b = re.sub(r'(<choice_explanation no="' + n + r'"[^>]*>.*?<commentary>).*?(</commentary>)',
                   lambda m: m.group(1) + escape(t) + m.group(2), b, count=1, flags=re.S)
    for sym, x in v.get('bogi', {}).items():
        def rep(m):
            head = re.sub(r'judgment="[^"]*"', 'judgment="' + judgment(pol, x['ox']) + '"', m.group(1))
            return head + m.group(2) + escape(x['text']) + m.group(3)
        b = re.sub(r'(<bogi_item symbol="' + sym + r'"[^>]*>)(.*?<commentary>).*?(</commentary>)', rep, b, count=1, flags=re.S)
    return b

def apply(task, pid):
    e = check(task, pid)
    if e: print(pid, 'FAIL'); print('\n'.join(e[:20])); return False
    V = json.load(open(os.path.join(WORK, 'verified', pid + '.json'), encoding='utf-8'))
    for f in index()[pid]['files']:
        s = open(f, encoding='utf-8').read()
        def rb(m):
            qid = re.search(r'id="([^"]+)"', m.group(0)).group(1)
            return patch_block(m.group(0), V[qid]) if qid in V else m.group(0)
        s2 = re.sub(r'<question_explanation .*?</question_explanation>', rb, s, flags=re.S)
        import xml.etree.ElementTree as ET; ET.fromstring(s2.encode('utf-8'))   # 파싱 검증
        open(f, 'w', encoding='utf-8').write(s2)
    p = load_progress(); p.setdefault(task, []).append(pid)
    if task == 'full': p.setdefault('bogi', []).append(pid)   # full 작업은 보기도 함께 처리
    save_progress(p); print(pid, 'applied to', len(index()[pid]['files']), 'files'); return True

if __name__ == '__main__':
    ok = all([apply(sys.argv[1], pid) for pid in sys.argv[2:]]); sys.exit(0 if ok else 1)

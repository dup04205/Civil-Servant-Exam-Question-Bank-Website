"""작업 대기열 생성 + 시험지별 입력 JSON 추출.
python3 extract.py queue            -> work/queue.json (task, subject, pid) 목록 출력
python3 extract.py paper PID [...]  -> work/papers/PID.json
"""
import sys, os, re, json
import xml.etree.ElementTree as ET
from common import *

def txt(e): return ' '.join(''.join(e.itertext()).split()) if e is not None else ''

def build_queue():
    idx = index(); prog = load_progress(); q = []
    for pid, e in idx.items():
        s = open(e['files'][0], encoding='utf-8').read(); bl = blocks(s)
        if e['subject'] not in LAW and pid not in prog['full']:
            g = sum(1 for b in bl if any(x in strip_bogi(b) for x in GENERIC))
            if g > 0:
                q.append({'task': 'full', 'subject': e['subject'], 'pid': pid, 'generic_q': g, 'n': len(bl)}); continue
        if '<bogi_item' in s and pid not in prog['bogi'] and pid not in prog['full']:
            q.append({'task': 'bogi', 'subject': e['subject'], 'pid': pid, 'n_bogi': s.count('<bogi_item')})
    # 순서: 일부 남은 과목(full, generic 일부) -> 미착수(full) -> 보기 재처리(bogi, 법 과목 먼저)
    q.sort(key=lambda x: (x['task'] != 'full', x.get('generic_q', 99) >= x.get('n', 0), x['subject'] not in LAW, x['subject'], x['pid']))
    os.makedirs(WORK, exist_ok=True)
    json.dump(q, open(os.path.join(WORK, 'queue.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    return q

def extract(pid):
    e = index()[pid]; hf = e['files'][0]; qf = hf.replace('_해설.xml', '.xml')
    h = ET.parse(hf).getroot(); q = ET.parse(qf).getroot(); md = q.find('metadata')
    hx = {x.get('id'): x for x in h.iter('question_explanation')}
    out = {'prb_id': pid, 'meta': {k: md.findtext(k) for k in ['exam_type','grade','series','year','subject_name','exam_title']},
           'files': [os.path.relpath(f, BASE) for f in e['files']], 'questions': []}
    for qq in q.iter('question'):
        qid = qq.get('id'); he = hx[qid]
        flat = strip_bogi(ET.tostring(he, encoding='unicode'))
        d = {'id': qid, 'needs_rewrite': any(x in flat for x in GENERIC), 'no': int(qq.get('no')), 'polarity': he.find('question_type').get('polarity'),
             'stem': txt(qq.find('stem')),
             'passage': ' / '.join(txt(p) for p in qq.iter('passage')),
             'bogi': [{'symbol': b.get('symbol'), 'statement': txt(b.find('statement')), 'current_judgment': b.get('judgment')}
                      for b in he.iter('bogi_item')],
             'choices': {c.get('no'): txt(c) for c in qq.iter('choice')},
             'answer': (qq.findtext('answer') or '').strip(),
             'formulas': [txt(f) for f in qq.iter('formula')][:30],
             'has_image': qq.find('.//image') is not None,
             'existing': {'overall': he.findtext('overall_commentary'),
                          'choices': {c.get('no'): c.findtext('commentary') for c in he.iter('choice_explanation')}}}
        if not (d['needs_rewrite'] or d['bogi']): continue          # 작업 불필요 문항 제외
        if d['needs_rewrite']: d.pop('existing')                      # 다시 쓸 문항은 기존 해설 불필요
        if not d['bogi']: d.pop('bogi')
        if not d['formulas']: d.pop('formulas')
        if not d['passage']: d.pop('passage')
        out['questions'].append(d)
    os.makedirs(os.path.join(WORK, 'papers'), exist_ok=True)
    p = os.path.join(WORK, 'papers', pid + '.json')
    json.dump(out, open(p, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':')); return p

if __name__ == '__main__':
    if sys.argv[1] == 'queue':
        q = build_queue(); import collections
        c = collections.Counter((x['task'], x['subject']) for x in q)
        for k, v in c.items(): print(k[0], k[1], v)
        print('total', len(q), 'full', sum(1 for x in q if x['task']=='full'), 'bogi', sum(1 for x in q if x['task']=='bogi'))
    else:
        for pid in sys.argv[2:]: print(extract(pid))

"""대기열에서 꺼내 추출: python3 take.py 과목 N  -> PID 목록 출력 (work/queue.json에서 제거)"""
import sys, json, os, subprocess
from common import WORK
q = json.load(open(os.path.join(WORK, 'queue.json'), encoding='utf-8'))
subj, n = sys.argv[1], int(sys.argv[2])
b = [x['pid'] for x in q if x['subject'] == subj][:n]
json.dump([x for x in q if x['pid'] not in b], open(os.path.join(WORK, 'queue.json'), 'w', encoding='utf-8'), ensure_ascii=False)
from extract import extract
for p in b: extract(p)
print(' '.join(b))

"""공통 설정: 경로, 법 과목 목록, 일반 문구 판정."""
import os, re, json, glob, collections
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
BASE = os.path.join(REPO, '공무원_기출문제')
WORK = os.environ.get('PIPE_WORK', os.path.join(HERE, 'work'))   # papers/, verified/ (git 미추적)
PROGRESS = os.path.join(HERE, 'progress.json')
LAW = {'형법총론','형사소송법개론','노동법개론','공직선거법','세법','관세법','노동법','국제법개론','방재관계법규',
       '국제법','헌법','행정법총론','행정법','세법개론','지방세법','관세법개론','형법','형사소송법'}
GENERIC = ('관련 법령:','법리 및 이론에 부합','실제 기준과 다르게','잘못 결합된 조합','정확히 부합하는 보기 조합',
           '제시된 요건과 결론이 타당하므로','평가하는 문제로','핵심 정리 지문으로','부합하는 옳은 설명이다',
           '어긋나는 서술에 해당한다','관련 이론·법리','내용과 일치하므로 옳다','내용과 배치되므로 옳지 않다')
BANNED = ('MCP','MST','법령ID','DB ','SQLite','데이터베이스에서')
CIRC = {'1':'①','2':'②','3':'③','4':'④','5':'⑤'}

def subj_of(path): return os.path.basename(path)[:-len('_해설.xml')]
def pid_of(s):
    m = re.search(r'<subject_row_id>(.*?)</subject_row_id>', s); return m.group(1) if m else None

def index():
    """pid -> {'subject':, 'files':[해설 xml 경로...]}"""
    idx = collections.OrderedDict()
    for f in sorted(glob.glob(BASE + '/**/*_해설.xml', recursive=True)):
        s = open(f, encoding='utf-8').read(); pid = pid_of(s)
        if not pid: continue
        e = idx.setdefault(pid, {'subject': subj_of(f), 'files': []}); e['files'].append(f)
    return idx

def blocks(s):
    return re.findall(r'<question_explanation .*?</question_explanation>', s, re.S)

def strip_bogi(b): return re.sub(r'<bogi_analysis>.*?</bogi_analysis>', '', b, flags=re.S)

def load_progress():
    if os.path.exists(PROGRESS): return json.load(open(PROGRESS, encoding='utf-8'))
    return {'full': [], 'bogi': []}
def save_progress(p):
    for k in p: p[k] = sorted(set(p[k]))
    json.dump(p, open(PROGRESS, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

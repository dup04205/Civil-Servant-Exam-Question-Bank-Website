# 기출해설 고도화 인계 문서

이 폴더만으로 남은 작업을 이어갈 수 있다. 진행 기록은 `progress.json`(커밋됨)이 기준이다.

## 남은 작업 확인
```bash
cd tools/explain_pipeline
python3 extract.py queue        # work/queue.json 생성, 과목별 남은 수 출력
```
- `full`: 일반 문구 해설이 남은 시험지 → 해당 문항 전체 해설 + 보기 해설 작성
- `bogi`: 총평·선지는 완료됐지만 〈보기〉 ㄱ·ㄴ·ㄷ 해설이 자동 생성 문구인 시험지 → 보기 해설만 재작성 (법 과목이 앞에 정렬됨)

## 1종 처리 절차
1. `python3 extract.py paper PID` → `work/papers/PID.json`
2. `AGENT_GUIDE.md` 규칙대로 `work/verified/PID.json` 작성 (`./law.sh`로 조문·판례 확인)
3. `python3 validate.py TASK PID` 가 OK일 때까지 수정
4. `python3 apply.py TASK PID` → 직렬 공유 파일까지 모두 반영, progress.json 갱신
5. 5종마다 커밋·푸시:
   `git add 공무원_기출문제 tools/explain_pipeline && git commit -m "feat: {과목} … 기출해설 …" && git push origin main`

## 참고
- 정답표와 풀이가 어긋난 문항은 `review.md`에 추가한다.
- 법령 조회 도구는 https://mcp.gomdori.app/law (구 주소 korean-law-mcp.fly.dev는 2026-11-17 종료). 클라우드 세션이면 이 호스트 접근 허용 필요.
- 저장소에는 문항 이미지 파일이 없다.
- 정답은 문항 XML의 `<answer>`(공식 정답표)가 기준이며 바꾸지 않는다.

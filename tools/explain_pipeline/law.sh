#!/bin/bash
# 법령·판례 조회: ./law.sh 도구명 'JSON인자'
#  ./law.sh search_law '{"query":"형사소송법"}'                       -> 법령 식별번호(mst) 확인
#  ./law.sh get_law_text '{"mst":"290185","jo":"제10조"}'              -> 조문 본문
#  ./law.sh search_decisions '{"domain":"precedent","query":"2004도74"}'  -> 대법원 판례 (헌재: domain constitutional)
#  ./law.sh get_decision_text '{"domain":"precedent","id":"606165"}'
curl -sS --max-time 90 -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  "${LAW_ENDPOINT:-https://mcp.gomdori.app/law}" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}" | python3 -c '
import sys,json
d=sys.stdin.read()
if d.lstrip().startswith(("event","data")): d="".join(l[5:] for l in d.splitlines() if l.startswith("data:"))
j=json.loads(d); r=j.get("result",{})
for c in r.get("content",[]): print(c.get("text",""))
if "error" in j: print(j["error"])'

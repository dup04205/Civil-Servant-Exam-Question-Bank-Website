#!/bin/bash
# 반영+커밋+푸시: ./ship.sh TASK "커밋 메시지" PID [PID...]
set -e; cd "$(dirname "$0")"; T=$1; M=$2; shift 2
python3 apply.py $T "$@"
cd ../..; git add 공무원_기출문제 tools/explain_pipeline
git -c user.name="${GIT_NAME:-S.Jin_Lee}" -c user.email="${GIT_EMAIL:-116756108+dup04205@users.noreply.github.com}" commit -q -m "$M" -m "${COMMIT_TRAILER:-}"
git -c push.negotiate=true push origin main 2>&1 | tail -1

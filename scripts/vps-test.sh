#!/bin/zsh
# runs the repo's tests on the VPS (hooks keep node --test off the Mac). usage: vps-test.sh [grep filter for output tail lines]
cd /Users/domininclynch/Developer/frankendom-v2 || exit 1
COPYFILE_DISABLE=1 tar --no-xattrs --exclude=.git --exclude=.serena --exclude='*.mp4' --exclude='*.png' -czf - . 2>/dev/null \
  | ssh -o BatchMode=yes -o ConnectTimeout=8 -i ~/.ssh/binance_futures_tool root@49.12.7.18 \
    'rm -rf /root/f2v-dev-run && mkdir -p /root/f2v-dev-run && tar xzf - -C /root/f2v-dev-run 2>/dev/null && cd /root/f2v-dev-run && npm test 2>&1' \
  > /private/tmp/claude-501/-Users-domininclynch-Developer-frankendom-v2/76f559f2-09ee-4872-ac96-8a021bdccd2a/scratchpad/vps-test.out
grep -E "^(not ok|ok|# (tests|pass|fail))|error:|expected|actual|message" /private/tmp/claude-501/-Users-domininclynch-Developer-frankendom-v2/76f559f2-09ee-4872-ac96-8a021bdccd2a/scratchpad/vps-test.out | head -${1:-60}

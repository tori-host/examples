#!/bin/bash
# Say something once, where someone will see it: an open issue with this
# title gets a comment, otherwise a new issue is opened. A red scheduled run
# every half hour teaches everyone to ignore red runs; an issue stays open
# until someone closes it.
#
#   .github/scripts/issue.sh "<title>" "<body>"     (GH_TOKEN, GITHUB_REPOSITORY)
set -euo pipefail
title=$1 body=$2
existing=$(gh issue list --repo "$GITHUB_REPOSITORY" --state open --search "in:title \"$title\"" --json number,title \
  --jq "map(select(.title == \"$title\")) | .[0].number // empty")
if [ -n "$existing" ]; then
  gh issue comment "$existing" --repo "$GITHUB_REPOSITORY" --body "$body"
else
  gh issue create --repo "$GITHUB_REPOSITORY" --title "$title" --body "$body"
fi

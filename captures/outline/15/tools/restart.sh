#!/bin/sh
# usage: restart.sh <scratch dir> <port>: starts the scratch server again on the data seed.mjs made. Never port 4399.
S=$1; P=$2; [ "$P" = 4399 ] && exit 1
cd /Users/unixsuperhero/proj/tuios-inbox
HOME=$S/home PORT=$P TUIOS_INBOX_DATA=$S/data TUIOS_INBOX_SPOOL=$S/data/events TUIOS_BIN=$S/tuios TUIOS_INBOX_GH=$S/gh TUIOS_INBOX_OPEN=$S/open TUIOS_INBOX_COLLECTORS=$S/data/none.json PI_CODING_AGENT_DIR=$S/omp exec bun server.mjs

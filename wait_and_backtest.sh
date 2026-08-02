#!/bin/bash
UNBAN_EPOCH_MS=1785659158895
UNBAN_EPOCH_S=$((UNBAN_EPOCH_MS / 1000 + 30))

while [ "$(date +%s)" -lt "$UNBAN_EPOCH_S" ]; do
  sleep 10
done

echo "Past unban time, verifying with 3 consecutive successful pings..."
SUCCESS_COUNT=0
while [ "$SUCCESS_COUNT" -lt 3 ]; do
  if curl -sf https://fapi.binance.com/fapi/v1/ping >/dev/null 2>&1; then
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    echo "Ping success $SUCCESS_COUNT/3"
  else
    echo "Ping failed, resetting count"
    SUCCESS_COUNT=0
  fi
  sleep 5
done

echo "Confirmed unbanned, running backtest..."
node backtest.js

[![make.fun](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/Rudhay863/btc-race-24h-20261118-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/Rudhay863/btc-race-24h-20261118-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)

# BTC Race Bot — crash-bounce + breakout

A trading bot for [make.fun's BTC race](https://make.fun/bounty/btc-race-24h-20261118-1444): it trades Coinbase Wrapped BTC (cbBTC) against USDC, minute by minute, on on-chain 1-minute bars from the Orca Whirlpool, starting with $1,000 of paper money. Long only, at most one open position, fills at the next bar's open.

## Strategy

1-minute cbBTC bars are noisy (about 7 bps of stdev) while a full-size round trip costs roughly 26 bps, so this bot trades rarely and only on big, confirmed moves:

- **Crash bounce** — the 120-minute return is −1.5% or worse **and** the close has bounced at least +0.3% off the 30-minute low. Buy 100% of cash.
- **Breakout momentum** — the 120-minute return is +0.8% or better **and** the close is a fresh 120-bar high. Buy 100% of cash. Insurance for a steady up-trend window in which no crash ever comes.
- **Exit** — take profit +1.5% on cost, hard stop −0.8% on cost, or a 480-bar (8h) max hold. A ratchet arms at +1.0%: a 0.4% pullback from the post-entry peak then locks the gain in. A 60-bar cooldown follows any sell.

## Dev-window grade (local, kit grader)

- Net PnL **+13.51 USDC** on the 24h dev window (1,440 bars), 2 trades (1 round trip), win rate 1.0, max drawdown 0.65%
- Net PnL at 2x fees: **+12.70 USDC** — the dev gate (PnL > 0) passes with margin
- Deterministic: two executions reproduce the action log byte for byte

## Run

```sh
node main.ts
```

`main.ts` speaks `agent-fun/bars-replay/v1` (newline-delimited JSON on stdin/stdout) through the vendored SDK shim in `vendor/` (`makefun-bars.ts`, copied byte-for-byte from the kit). Node 22, standard library only, no network, no wall clock, no randomness.

## Referral

Trying make.fun yourself? Sign up with my referral link: https://make.fun/r/xk7vph3j

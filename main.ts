/**
 * Crash-bounce + breakout bot for btc-race-24h-20261118-1444.
 *
 * Own design, from the kit spec + the dev window's shape (a -2.8% day: a sharp
 * early crash, a slow +1.9% recovery, then choppy sideways drift).
 *
 * Idea: 1-minute cbBTC bars are noisy (stdev ~7 bps) while a full-size round
 * trip costs ~26 bps, so frequent trading bleeds out. This bot trades rarely
 * and only on big, confirmed moves:
 *
 *   ENTRY 1 - crash bounce: the 120-minute return is -1.5% or worse AND the
 *   close has bounced at least +0.3% off the 30-minute low (the fall is
 *   pausing, not still accelerating). Buy 100% of cash.
 *   ENTRY 2 - breakout momentum: the 120-minute return is +0.8% or better
 *   AND the close is a fresh 120-bar high (a real breakout, not a
 *   mid-recovery re-entry). Buy 100% of cash. This leg is insurance for a
 *   steady up-trend window in which no crash ever comes.
 *
 *   EXIT - take profit +1.5% on cost, hard stop -0.8% on cost, or a
 *   480-bar (8h) max hold, whichever comes first. A ratchet arms once the
 *   trade is +1.0% in profit: a 0.4% pullback from the post-entry peak then
 *   locks the gain in, so a recovery that stalls between +1.0% and +1.5%
 *   still banks a profit instead of riding back to the stop. A 60-bar
 *   cooldown after any sell keeps the bot from churning straight back in.
 *
 * All decisions are pure functions of the bar closes seen so far (integer
 * basis points on bigints, no floats, no wall clock, no randomness), so two
 * runs on the same data produce byte-identical action logs.
 */

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYM = 'CBBTC';

// Strategy parameters (basis points / bars).
const LOOKBACK = 120; // 120-minute window for the drop / momentum return
const DROP_BPS = 150n; // crash: 120m return <= -1.5%
const CONF_BPS = 30n; // bounce: close >= 30m low * (1 + 0.3%)
const MOM_BPS = 80n; // breakout: 120m return >= +0.8% at a fresh 120-bar high
const TP_BPS = 150n; // take profit +1.5% on cost
const SL_BPS = 80n; // hard stop -0.8% on cost
const ARM_BPS = 100n; // ratchet arms once the trade is +1.0% on cost
const TRAIL_BPS = 40n; // ...then a 0.4% pullback from the post-entry peak locks it in
const HOLD_BARS = 480; // max hold 8 hours
const COOL_BARS = 60; // cooldown after any sell
const LOW_WINDOW = 30; // bounce confirmation window (bars)
const NO_ENTRY_AFTER = 1380; // stop opening new trades in the last 60 scored bars
const MAX_SLIP_BPS = 200; // max slippage vs latest close (fills move ~2 bps + impact)

class Bot {
  private closes: bigint[] = []; // closes seen, in price units, oldest first
  private scored = 0; // scored bars seen (excludes warmup)
  private entrySeq: number | null = null; // seq of the bar the buy filled on
  private peakSinceEntry: bigint | null = null; // highest close since entry (ratchet)
  private lastSellSeq: number | null = null;
  private buyN = 0;
  private sellN = 0;

  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    // Fold this batch's CBBTC bar into history (a batch may carry none).
    let barHere = null;
    for (const b of batch.bars) {
      if (b.symbol === SYM) {
        barHere = b;
        break;
      }
    }
    if (barHere !== null) {
      this.closes.push(BigInt(barHere.c));
      if (!state.warmingUp) this.scored += 1;
    }

    // Note our fills: set entry / cooldown markers from what filled.
    for (const f of batch.fills) {
      if (f.status !== 'filled' || f.symbol !== SYM) continue;
      if (f.side === 'buy') {
        this.entrySeq = state.seq;
        this.peakSinceEntry = barHere !== null ? BigInt(barHere.c) : null;
      } else if (f.side === 'sell') {
        this.lastSellSeq = state.seq;
        this.entrySeq = null;
        this.peakSinceEntry = null;
      }
    }

    if (state.warmingUp || barHere === null) return [];

    const pos = state.positions.get(SYM);
    const close = BigInt(barHere.c);
    const n = this.closes.length;

    // --- holding: check exits ---
    if (pos !== undefined && pos.qty > 0n) {
      const cost = pos.cost;
      const value = state.value(SYM, pos.qty);
      const retBps = cost > 0n ? ((value - cost) * 10000n) / cost : 0n;
      if (this.peakSinceEntry === null || close > this.peakSinceEntry) {
        this.peakSinceEntry = close;
      }
      const holdBars = this.entrySeq !== null ? state.seq - this.entrySeq : 0;
      // Ratchet: once +1.0% in profit, a 0.4% pullback from the post-entry
      // peak locks the gain in instead of riding it back to the stop or the
      // hold cap. (The fixed take-profit still ends the normal case first.)
      const ratchetHit =
        retBps >= ARM_BPS &&
        this.peakSinceEntry !== null &&
        close * 10000n < this.peakSinceEntry * (10000n - TRAIL_BPS);
      if (ratchetHit || retBps >= TP_BPS || retBps <= -SL_BPS || holdBars >= HOLD_BARS) {
        this.sellN += 1;
        return [{
          side: 'sell',
          client_id: `s${this.sellN}`,
          symbol: SYM,
          qty: pos.qty,
          max_slippage_bps: MAX_SLIP_BPS,
        }];
      }
      return [];
    }

    // --- flat: check entries ---
    if (this.scored >= NO_ENTRY_AFTER) return [];
    if (this.lastSellSeq !== null && state.seq - this.lastSellSeq < COOL_BARS) return [];
    if (n <= LOOKBACK) return [];

    const close120Ago = this.closes[n - 1 - LOOKBACK];
    const ret120Bps = ((close - close120Ago) * 10000n) / close120Ago;
    let low30 = this.closes[n - LOW_WINDOW];
    for (let i = n - LOW_WINDOW + 1; i < n; i++) {
      if (this.closes[i] < low30) low30 = this.closes[i];
    }
    let high120 = this.closes[n - LOOKBACK];
    for (let i = n - LOOKBACK + 1; i < n; i++) {
      if (this.closes[i] > high120) high120 = this.closes[i];
    }

    const crashBounce = ret120Bps <= -DROP_BPS && close * 10000n >= low30 * (10000n + CONF_BPS);
    const breakout = ret120Bps >= MOM_BPS && close >= high120;

    if (crashBounce || breakout) {
      const cash = state.cash;
      if (cash <= 0n) return [];
      this.buyN += 1;
      return [{
        side: 'buy',
        client_id: `b${this.buyN}`,
        symbol: SYM,
        notional_quote_units: cash,
        max_slippage_bps: MAX_SLIP_BPS,
      }];
    }
    return [];
  }
}

await runBars(new Bot());

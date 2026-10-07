"use client";

import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useReducedMotion } from "@/lib/motion";
import { placeOrder, sellableQty, type EngineState } from "@/lib/trading/engine";
import { quoteFromLive } from "@/lib/trading/market";
import { flowReducer, IDLE_FLOW, parseQty, type Receipt } from "@/lib/trading/orderFlow";
import type { PersistShape } from "@/lib/trading/persist";
import type { Quote, Side } from "@/lib/trading/types";
import { findSymbol } from "@/lib/trading/universe";

export type PriceState = "ok" | "loading" | "error";

/**
 * Drives the buy/sell flow. The steps come from the pure reducer in lib/trading/orderFlow; this hook adds the
 * parts that touch the world: fetching a price for a stock that has none yet, placing the order against the
 * latest engine state, saving the buying reason, and reporting what was filled.
 */
export function useOrderFlow({
  engineRef,
  quotes,
  mergeQuotes,
  setStore,
  replayOn,
  onFilled,
}: {
  engineRef: MutableRefObject<EngineState>;
  quotes: Map<string, Quote>;
  mergeQuotes: (list: Quote[]) => void;
  setStore: Dispatch<SetStateAction<PersistShape>>;
  replayOn: boolean;
  /** Called once an order has filled; `closedTrades` is how many trades that fill completed. */
  onFilled: (receipt: Receipt, closedTrades: number) => void;
}) {
  const [flow, dispatch] = useReducer(flowReducer, IDLE_FLOW);
  const reduce = useReducedMotion();
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;
  const timer = useRef(0);
  const [price, setPrice] = useState<{ symbol: string; state: PriceState }>({ symbol: "", state: "ok" });
  const [retry, setRetry] = useState(0);

  const symbol = flow.symbol;
  const hasQuote = symbol ? (quotes.get(symbol)?.last ?? 0) > 0 : true;

  // A stock opened from search or the heat map may not be in the 20-second quote pull yet: fetch just that one.
  useEffect(() => {
    if (!symbol || hasQuote) {
      setPrice({ symbol: symbol ?? "", state: "ok" });
      return;
    }
    const ac = new AbortController();
    setPrice({ symbol, state: "loading" });
    api
      .marketQuotes([symbol], ac.signal)
      .then((data) => {
        if (ac.signal.aborted) return;
        const list = (data.quotes || []).filter((q) => q.last > 0).map((q) => quoteFromLive(q.symbol, q));
        if (list.length) {
          mergeQuotes(list);
          setPrice({ symbol, state: "ok" });
        } else setPrice({ symbol, state: "error" });
      })
      .catch(() => {
        if (!ac.signal.aborted) setPrice({ symbol, state: "error" });
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, hasQuote, retry]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const open = useCallback((sym: string, side: Side) => dispatch({ type: "open", symbol: sym, side, qty: findSymbol(sym).lotSize }), []);
  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    dispatch({ type: "close" });
  }, []);

  const confirm = useCallback(
    (thesis: { why: string; expected: string } | null) => {
      if (flow.step !== "review" || !flow.symbol) return;
      const { symbol: sym, side } = flow;
      const qty = parseQty(flow.qtyText);
      dispatch({ type: "confirm" });
      timer.current = window.setTimeout(
        () => {
          const quote = quotesRef.current.get(sym);
          if (!quote || !(quote.last > 0)) {
            dispatch({ type: "failed", message: `Price unavailable for ${findSymbol(sym).name} right now.` });
            return;
          }
          const before = engineRef.current;
          const result = placeOrder(before, { symbol: sym, side, qty, replay: replayOn }, quote);
          if (result.error) {
            // The refusal is kept in the order list so it can be seen under Orders.
            setStore((s) => ({ ...s, engine: result.state }));
            dispatch({ type: "failed", message: result.error });
            return;
          }
          const made = result.state.trades.slice(0, result.state.trades.length - before.trades.length);
          const fill = result.state.fills[0];
          const receipt: Receipt = {
            side,
            symbol: sym,
            name: findSymbol(sym).name,
            qty,
            price: fill.price,
            value: fill.gross,
            charges: fill.charges.total,
            total: fill.net,
            realized: side === "sell" ? made.reduce((a, t) => a + t.pnl, 0) : null,
            cashAfter: result.state.account.cash,
            time: fill.time,
          };
          setStore((s) => {
            const theses = { ...s.theses };
            const journals = { ...s.journals };
            if (side === "buy" && thesis) theses[sym] = thesis;
            if (made.length && theses[sym]) {
              for (const t of made) journals[t.id] = { why: theses[sym].why, expected: theses[sym].expected, actual: "", learned: "" };
            }
            if (sellableQty(result.state, sym) <= 0) delete theses[sym];
            return { ...s, engine: result.state, theses, journals, bottomCollapsed: made.length ? false : s.bottomCollapsed };
          });
          dispatch({ type: "filled", receipt });
          onFilled(receipt, made.length);
        },
        reduce ? 0 : 240,
      );
    },
    [engineRef, flow, onFilled, reduce, replayOn, setStore],
  );

  return {
    flow,
    open,
    close,
    confirm,
    setSide: useCallback((side: Side) => dispatch({ type: "side", side }), []),
    setQty: useCallback((text: string) => dispatch({ type: "qty", text }), []),
    review: useCallback((ok: boolean) => dispatch({ type: "review", ok }), []),
    back: useCallback(() => dispatch({ type: "back" }), []),
    priceState: (!symbol || hasQuote ? "ok" : price.symbol === symbol ? price.state : "loading") as PriceState,
    retryPrice: useCallback(() => setRetry((n) => n + 1), []),
  };
}


import { Strategy, SymbolData, MarketDataPoint, PriceType, RebalanceFrequency } from "../types";
import { StorageService } from "./storage";

export interface SimTrade {
    date: string;
    ticker: string;
    type: 'BUY' | 'SELL';
    value: number;
    shares: number;
    price: number;
}

export interface SimResultPoint {
    date: string;
    value: number;
    benchmarkValue: number;
    riskOn: number;
    riskOff: number;
    rebalanced: boolean;
}

export interface DetailedSimResult {
    series: SimResultPoint[];
    trades: SimTrade[];
    regimeSwitches: { date: string, from: number, to: number }[];
}

export const StrategyEngine = {
    async runSimulation(
        strategy: Strategy,
        symbols: SymbolData[],
        startDate?: string,
        endDate?: string
    ): Promise<DetailedSimResult> {
        const benchmarkTicker = symbols.find(s => s.id === strategy.benchmarkSymbolId)?.ticker || 'SPY';
        
        const resolveTicker = (id: string) => {
            if (id.startsWith('STRAT:')) return id;
            return symbols.find(s => s.id === id)?.ticker || '';
        };

        const riskOnTickers = strategy.riskOnComponents.map(c => resolveTicker(c.symbolId));
        const riskOffTickers = strategy.riskOffComponents.map(c => resolveTicker(c.symbolId));
        const allTickers = Array.from(new Set([benchmarkTicker, ...riskOnTickers, ...riskOffTickers])).filter(t => t);

        const marketDataMap: Record<string, Map<string, MarketDataPoint>> = {};
        let datesSet = new Set<string>();

        // 1. Data Loading & Sub-Strategy Materialization
        for (const t of allTickers) {
            let data: MarketDataPoint[] | null = await StorageService.getMarketData(t);
            if (!data && t.startsWith('STRAT:')) {
                const subId = t.replace('STRAT:', '');
                const subStrat = StorageService.getStrategies().find(s => s.id === subId);
                if (subStrat) {
                    const subSim = await this.runSimulation(subStrat, symbols);
                    data = subSim.series.map(p => ({
                        date: p.date, open: p.value, high: p.value, low: p.value, close: p.value, volume: 0
                    }));
                    await StorageService.saveMarketData(t, data);
                }
            }

            if (!data || data.length === 0) throw new Error(`Missing history for ${t}`);
            const map = new Map<string, MarketDataPoint>();
            data.forEach(d => { map.set(d.date, d); datesSet.add(d.date); });
            marketDataMap[t] = map;
        }

        const sortedDates = Array.from(datesSet).sort();
        
        // 2. Range Alignment
        let firstCommonIdx = 0;
        for (let i = 0; i < sortedDates.length; i++) {
            if (allTickers.every(t => marketDataMap[t].has(sortedDates[i]))) {
                firstCommonIdx = i;
                break;
            }
        }

        let sIdx = startDate ? sortedDates.findIndex(d => d >= startDate) : firstCommonIdx;
        if (sIdx < firstCommonIdx) sIdx = firstCommonIdx;
        let eIdx = endDate ? sortedDates.findIndex(d => d >= endDate) : sortedDates.length - 1;
        if (eIdx === -1) eIdx = sortedDates.length - 1;

        const simDates = sortedDates.slice(sIdx, eIdx + 1);
        if (simDates.length < 5) throw new Error("Simulation range is too narrow for analysis.");

        // 3. Helpers
        const getSafePrice = (ticker: string, date: string): number => {
            const p = marketDataMap[ticker]?.get(date);
            return (p && p.close > 0) ? p.close : 0;
        };

        const getExecutionPrice = (t: string, d: string): number => {
            const p = marketDataMap[t]?.get(d);
            if (!p) return getSafePrice(t, d);
            if (strategy.pricePreference === PriceType.OPEN) return p.open > 0 ? p.open : p.close;
            if (strategy.pricePreference === PriceType.AVG) return (p.high + p.low + p.close) / 3;
            return p.close;
        };

        const primaryTicker = riskOnTickers[0];
        const getMA = (period: number, date: string) => {
            const idx = sortedDates.indexOf(date);
            if (idx < period || idx === -1) return null;
            let sum = 0, count = 0;
            for (let i = 1; i <= period; i++) {
                const p = getSafePrice(primaryTicker, sortedDates[idx - i]);
                if (p > 0) { sum += p; count++; }
            }
            return count === period ? sum / period : null;
        };

        const getMomentum = (period: number, date: string): number | null => {
            const idx = sortedDates.indexOf(date);
            if (idx <= period || idx === -1) return null;
            const pNow = getSafePrice(primaryTicker, sortedDates[idx - 1]);
            const pThen = getSafePrice(primaryTicker, sortedDates[idx - 1 - period]);
            return (pNow > 0 && pThen > 0) ? (pNow / pThen) - 1 : null;
        };

        const isRebalanceDay = (date: string, index: number, freq: RebalanceFrequency): boolean => {
            if (index === 0) return true;
            const curr = new Date(date);
            const prev = new Date(simDates[index - 1]);

            switch(freq) {
                case RebalanceFrequency.DAILY: return true;
                case RebalanceFrequency.WEEKLY: return curr.getDay() < prev.getDay();
                case RebalanceFrequency.BIWEEKLY: {
                    const epoch = new Date('1970-01-04'); // A Sunday
                    const diff = curr.getTime() - epoch.getTime();
                    const weekIdx = Math.floor(diff / (7 * 24 * 3600 * 1000));
                    const prevWeekIdx = Math.floor((prev.getTime() - epoch.getTime()) / (7 * 24 * 3600 * 1000));
                    // Trigger if a new week starts AND the absolute week counter is even
                    return (weekIdx !== prevWeekIdx) && (weekIdx % 2 === 0);
                }
                case RebalanceFrequency.MONTHLY: return curr.getMonth() !== prev.getMonth();
                case RebalanceFrequency.BIMONTHLY: return curr.getMonth() !== prev.getMonth() && (curr.getMonth() % 2 === 0);
                case RebalanceFrequency.QUARTERLY: return Math.floor(curr.getMonth() / 3) !== Math.floor(prev.getMonth() / 3);
                case RebalanceFrequency.SEMIANNUALLY: return Math.floor(curr.getMonth() / 6) !== Math.floor(prev.getMonth() / 6);
                case RebalanceFrequency.ANNUALLY: return curr.getFullYear() !== prev.getFullYear();
                default: return false;
            }
        };

        // 4. Simulation Engine
        let nav = strategy.initialCapital;
        let cash = nav;
        let holdings: Record<string, number> = {};
        let simResult: SimResultPoint[] = [];
        let trades: SimTrade[] = [];
        let regimeSwitches: { date: string, from: number, to: number }[] = [];
        let lastLoggedRegime = -1;
        let targetWeights: Record<string, number> = {};
        let pendingRebalanceDay: number | null = null;
        const bmStart = getSafePrice(benchmarkTicker, simDates[0]);

        for (let i = 0; i < simDates.length; i++) {
            const date = simDates[i];
            
            // A. Update NAV (Mark-to-Market)
            let currentVal = cash;
            Object.entries(holdings).forEach(([t, q]) => {
                const p = getSafePrice(t, date);
                currentVal += q * p;
            });
            nav = currentVal;
            if (isNaN(nav) || !isFinite(nav)) nav = strategy.initialCapital;

            const bmPrice = getSafePrice(benchmarkTicker, date);
            const bmNav = (bmPrice / (bmStart || 1)) * strategy.initialCapital;

            // B. Signal Calculation (Regime Detection)
            let riskOnW = 0;
            const activeRuleId = strategy.rules?.[0]?.ruleId || 'rule_2';
            const pPrevClose = getSafePrice(primaryTicker, simDates[i-1] || simDates[i]);

            if (activeRuleId === 'rule_4') {
                const ma200 = getMA(200, date), mom126 = getMomentum(126, date), mom63 = getMomentum(63, date);
                if (ma200 && pPrevClose > ma200) riskOnW += 0.4;
                if (mom126 !== null && mom126 > 0) riskOnW += 0.3;
                if (mom63 !== null && mom63 > 0) riskOnW += 0.3;
            } else if (activeRuleId === 'rule_3') {
                const ma200 = getMA(200, date), ma50 = getMA(50, date);
                if (ma200 && pPrevClose > ma200) riskOnW += 0.6;
                if (ma50 && pPrevClose > ma50) riskOnW += 0.4;
            } else if (activeRuleId === 'rule_1') {
                const ma50 = getMA(50, date), ma75 = getMA(75, date), ma100 = getMA(100, date);
                if (ma50 && pPrevClose > ma50) riskOnW += 0.5;
                if (ma75 && pPrevClose > ma75) riskOnW += 0.25;
                if (ma100 && pPrevClose > ma100) riskOnW += 0.25;
            } else {
                const ma25 = getMA(25, date), ma50 = getMA(50, date), ma100 = getMA(100, date);
                if (ma25 && pPrevClose > ma25) riskOnW += 0.25;
                if (ma50 && pPrevClose > ma50) riskOnW += 0.5;
                if (ma100 && pPrevClose > ma100) riskOnW += 0.25;
            }

            if (lastLoggedRegime !== -1 && Math.abs(riskOnW - lastLoggedRegime) > 0.01) {
                regimeSwitches.push({ date, from: lastLoggedRegime, to: riskOnW });
            }
            lastLoggedRegime = riskOnW;

            // C. Rebalancing Trigger
            if (isRebalanceDay(date, i, strategy.rebalanceFreq)) {
                const newTargets: Record<string, number> = {};
                strategy.riskOnComponents.forEach(c => newTargets[resolveTicker(c.symbolId)] = (newTargets[resolveTicker(c.symbolId)] || 0) + (riskOnW * (c.allocation / 100)));
                strategy.riskOffComponents.forEach(c => newTargets[resolveTicker(c.symbolId)] = (newTargets[resolveTicker(c.symbolId)] || 0) + ((1 - riskOnW) * (c.allocation / 100)));
                targetWeights = newTargets;
                if (pendingRebalanceDay === null) {
                    pendingRebalanceDay = i + (strategy.executionDelay || 0);
                }
            }

            // D. Execute Rebalance (Optimized for transaction costs)
            let rebalancedThisDay = false;
            if (pendingRebalanceDay !== null && i >= pendingRebalanceDay) {
                rebalancedThisDay = true;
                const costMultiplier = (1 + (strategy.transactionCostPct + strategy.slippagePct) / 100);
                const sellMultiplier = (1 - (strategy.transactionCostPct + strategy.slippagePct) / 100);
                
                // SELL Phase: Liquidate overweight assets to generate cash
                Object.keys(holdings).forEach(t => {
                    const price = getExecutionPrice(t, date);
                    if (price <= 0) return;
                    const targetVal = (targetWeights[t] || 0) * nav;
                    const currentVal = (holdings[t] || 0) * price;
                    if (currentVal > targetVal + 1) {
                        const sellValRaw = currentVal - targetVal;
                        const qty = sellValRaw / price;
                        const cost = sellValRaw * (1 - sellMultiplier);
                        const netCash = sellValRaw - cost;
                        holdings[t] -= qty;
                        cash += netCash;
                        nav -= cost;
                        trades.push({ date, ticker: t, type: 'SELL', value: sellValRaw, shares: qty, price });
                    }
                });

                // BUY Phase: Reinvest available cash into underweight assets
                // We must solve: targetVal_including_fees = cash_available
                Object.keys(targetWeights).forEach(t => {
                    const price = getExecutionPrice(t, date);
                    if (price <= 0) return;
                    const targetVal = targetWeights[t] * nav;
                    const currentVal = (holdings[t] || 0) * price;
                    if (targetVal > currentVal + 1) {
                        let buyValDesired = targetVal - currentVal;
                        let totalCostForDesired = buyValDesired * (costMultiplier - 1);
                        
                        // If we don't have enough cash for desired buy + its fees, reduce buy amount
                        if (buyValDesired + totalCostForDesired > cash) {
                            buyValDesired = cash / costMultiplier;
                        }

                        if (buyValDesired > 1) {
                            const cost = buyValDesired * (costMultiplier - 1);
                            const qty = buyValDesired / price;
                            holdings[t] = (holdings[t] || 0) + qty;
                            cash -= (buyValDesired + cost);
                            nav -= cost;
                            trades.push({ date, ticker: t, type: 'BUY', value: buyValDesired, shares: qty, price });
                        }
                    }
                });
                pendingRebalanceDay = null;
            }

            simResult.push({
                date, value: nav, benchmarkValue: bmNav,
                riskOn: Number((riskOnW * 100).toFixed(2)), 
                riskOff: Number(((1 - riskOnW) * 100).toFixed(2)),
                rebalanced: rebalancedThisDay
            });
        }
        return { series: simResult, trades, regimeSwitches };
    }
};

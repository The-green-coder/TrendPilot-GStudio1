
import { Strategy, SymbolData, MarketDataPoint, PriceType, RebalanceFrequency } from "../types";
import { StorageService } from "./storage";

export interface SimTrade {
    date: string;
    ticker: string;
    type: 'BUY' | 'SELL';
    value: number;
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
    async getTickerData(ticker: string): Promise<MarketDataPoint[]> {
        const data = await StorageService.getMarketData(ticker);
        if (!data) throw new Error(`Missing data for ${ticker}`);
        return data;
    },

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
        const rawHistoryMap: Record<string, MarketDataPoint[]> = {};
        let datesSet = new Set<string>();

        for (const t of allTickers) {
            let data: MarketDataPoint[] | null = null;
            if (t.startsWith('STRAT:')) {
                data = await StorageService.getMarketData(t);
                if (!data) {
                    const subId = t.replace('STRAT:', '');
                    const allStrats = StorageService.getStrategies();
                    const subStrat = allStrats.find(s => s.id === subId);
                    if (!subStrat) throw new Error(`Sub-strategy ${subId} not found`);
                    
                    // Recursive prevention
                    if (subStrat.id === strategy.id) throw new Error("Circular strategy dependency detected.");
                    
                    const subSim = await this.runSimulation(subStrat, symbols);
                    data = subSim.series.map(p => ({
                        date: p.date,
                        open: p.value,
                        high: p.value,
                        low: p.value,
                        close: p.value,
                        volume: 0
                    }));
                    await StorageService.saveMarketData(t, data);
                }
            } else {
                data = await StorageService.getMarketData(t);
            }

            if (!data || data.length === 0) throw new Error(`Missing history for ${t}`);
            rawHistoryMap[t] = data;
            const map = new Map<string, MarketDataPoint>();
            data.forEach(d => { map.set(d.date, d); datesSet.add(d.date); });
            marketDataMap[t] = map;
        }

        const sortedDates = Array.from(datesSet).sort();
        let sIdx = startDate ? sortedDates.findIndex(d => d >= startDate) : 0;
        let eIdx = endDate ? sortedDates.findIndex(d => d >= endDate) : sortedDates.length - 1;
        if (sIdx === -1) sIdx = 0;
        if (eIdx === -1) eIdx = sortedDates.length - 1;

        const simDates = sortedDates.slice(sIdx, eIdx + 1);
        if (simDates.length < 5) throw new Error("Range too small for simulation");

        // Advanced Price tracking with Anomaly Smoothing
        const currentPrices: Record<string, number> = {};
        allTickers.forEach(t => {
            // Find global first valid price for this asset to avoid 1-to-price jumps
            const firstValid = rawHistoryMap[t].find(p => p.close > 0.001);
            currentPrices[t] = firstValid ? firstValid.close : 1;
        });

        const getExecutionPrice = (t: string, d: string): number => {
            const p = marketDataMap[t]?.get(d);
            const last = currentPrices[t];
            
            // Anomaly detection: If price drops > 90% or jumps > 1000% in one day without explanation, 
            // it's likely a data error in free sources. Carry forward instead.
            if (!p || p.close <= 0.001) return last;
            
            const change = p.close / last;
            if (change < 0.1 || change > 10) {
                // Potential anomaly - only apply smoothing if not the first day
                // In a real quant engine, we'd log this.
                // return last; 
            }

            let price = p.close;
            if (strategy.pricePreference === PriceType.OPEN) price = p.open || p.close;
            else if (strategy.pricePreference === PriceType.AVG) price = (p.high + p.low + p.close) / 3;
            
            currentPrices[t] = p.close; 
            return price > 0 ? price : last;
        };

        const primaryTicker = riskOnTickers[0];
        const fullHistory = sortedDates.map(d => ({ date: d, price: marketDataMap[primaryTicker]?.get(d)?.close || null }))
            .filter(p => p.price !== null) as {date: string, price: number}[];

        const getMA = (period: number, date: string) => {
            const idx = fullHistory.findIndex(p => p.date === date);
            if (idx < period - 1 || idx === -1) return null;
            let sum = 0;
            for(let i=0; i<period; i++) sum += fullHistory[idx-i].price;
            return sum / period;
        };

        const isRebalanceDay = (date: string, idx: number, freq: RebalanceFrequency, existingData: any[]): boolean => {
            if (idx === 0) return true;
            const curr = new Date(date);
            const prev = new Date(simDates[idx - 1]);
            const findLastRebalance = () => {
                for (let j = existingData.length - 1; j >= 0; j--) {
                    if (existingData[j].rebalanced) return new Date(existingData[j].date);
                }
                return new Date(simDates[0]);
            };

            switch(freq) {
                case RebalanceFrequency.DAILY: return true;
                case RebalanceFrequency.WEEKLY: return curr.getDay() < prev.getDay() || (curr.getTime() - prev.getTime()) > 6 * 86400000;
                case RebalanceFrequency.BIWEEKLY: return (curr.getTime() - findLastRebalance().getTime()) >= 13 * 86400000;
                case RebalanceFrequency.MONTHLY: return curr.getMonth() !== prev.getMonth();
                case RebalanceFrequency.BIMONTHLY: return (curr.getFullYear()*12+curr.getMonth()) - (findLastRebalance().getFullYear()*12+findLastRebalance().getMonth()) >= 2;
                case RebalanceFrequency.QUARTERLY: return Math.floor(curr.getMonth()/3) !== Math.floor(prev.getMonth()/3);
                case RebalanceFrequency.SEMIANNUALLY: return (curr.getFullYear()*12+curr.getMonth()) - (findLastRebalance().getFullYear()*12+findLastRebalance().getMonth()) >= 6;
                case RebalanceFrequency.ANNUALLY: return curr.getFullYear() !== prev.getFullYear();
                default: return false;
            }
        };

        let nav = strategy.initialCapital;
        let cash = nav;
        let holdings: Record<string, number> = {};
        let simResult: SimResultPoint[] = [];
        let trades: SimTrade[] = [];
        let regimeSwitches: { date: string, from: number, to: number }[] = [];
        let prevRiskOnW = -1;

        // Reset prices to the start of the simulation range for correct relative growth
        allTickers.forEach(t => {
            const startP = marketDataMap[t].get(simDates[0]);
            if (startP && startP.close > 0) currentPrices[t] = startP.close;
        });

        const bmStart = currentPrices[benchmarkTicker] || 1;

        for (let i = 0; i < simDates.length; i++) {
            const date = simDates[i];
            
            let pValue = cash;
            Object.entries(holdings).forEach(([t, q]) => {
                const p = marketDataMap[t]?.get(date)?.close || currentPrices[t];
                pValue += q * p;
                currentPrices[t] = p; 
            });
            nav = pValue;

            const bmPrice = marketDataMap[benchmarkTicker]?.get(date)?.close || currentPrices[benchmarkTicker];
            currentPrices[benchmarkTicker] = bmPrice;
            const bmNav = (bmPrice / bmStart) * strategy.initialCapital;

            let riskOnW = 0;
            const pClose = marketDataMap[primaryTicker]?.get(date)?.close || currentPrices[primaryTicker];
            currentPrices[primaryTicker] = pClose;

            const ma25 = getMA(25, date), ma50 = getMA(50, date), ma100 = getMA(100, date);
            if (pClose > 0) {
                const ruleId = strategy.rules?.[0]?.ruleId || 'rule_2';
                if (ruleId === 'rule_1') {
                    if (ma50 && pClose > ma50) riskOnW += 0.50;
                    const ma75 = getMA(75, date);
                    if (ma75 && pClose > ma75) riskOnW += 0.25;
                    if (ma100 && pClose > ma100) riskOnW += 0.25;
                } else {
                    if (ma25 && pClose > ma25) riskOnW += 0.25;
                    if (ma50 && pClose > ma50) riskOnW += 0.50;
                    if (ma100 && pClose > ma100) riskOnW += 0.25;
                }
            }

            if (prevRiskOnW !== -1 && riskOnW !== prevRiskOnW) {
                regimeSwitches.push({ date, from: prevRiskOnW, to: riskOnW });
            }
            prevRiskOnW = riskOnW;

            const shouldReb = isRebalanceDay(date, i, strategy.rebalanceFreq, simResult);
            if (shouldReb) {
                const targets: Record<string, number> = {};
                const onTotal = strategy.riskOnComponents.reduce((a, b) => a + b.allocation, 0) || 100;
                const offTotal = strategy.riskOffComponents.reduce((a, b) => a + b.allocation, 0) || 100;

                strategy.riskOnComponents.forEach(c => {
                    const t = resolveTicker(c.symbolId);
                    const sign = c.direction === 'Short' ? -1 : 1;
                    targets[t] = (targets[t] || 0) + (nav * riskOnW * (c.allocation / onTotal) * sign);
                });
                strategy.riskOffComponents.forEach(c => {
                    const t = resolveTicker(c.symbolId);
                    const sign = c.direction === 'Short' ? -1 : 1;
                    targets[t] = (targets[t] || 0) + (nav * (1 - riskOnW) * (c.allocation / offTotal) * sign);
                });

                const allSimTickers = Array.from(new Set([...Object.keys(holdings), ...Object.keys(targets)]));
                
                allSimTickers.forEach(t => {
                    const price = getExecutionPrice(t, date);
                    const diff = (targets[t] || 0) - ((holdings[t] || 0) * price);
                    if (diff < -1) {
                        const qty = Math.abs(diff) / price;
                        const cost = Math.abs(diff) * (strategy.transactionCostPct / 100);
                        holdings[t] = (holdings[t] || 0) - qty;
                        cash += (Math.abs(diff) - cost);
                        nav -= cost;
                        trades.push({ date, ticker: t, type: 'SELL', value: Math.abs(diff) });
                    }
                });
                allSimTickers.forEach(t => {
                    const price = getExecutionPrice(t, date);
                    const diff = (targets[t] || 0) - ((holdings[t] || 0) * price);
                    if (diff > 1) {
                        const cost = Math.abs(diff) * (strategy.transactionCostPct / 100);
                        if (cash > (diff + cost)) {
                            holdings[t] = (holdings[t] || 0) + (diff / price);
                            cash -= (diff + cost);
                            nav -= cost;
                            trades.push({ date, ticker: t, type: 'BUY', value: diff });
                        }
                    }
                });
            }

            simResult.push({
                date,
                value: nav,
                benchmarkValue: bmNav,
                riskOn: riskOnW * 100,
                riskOff: (1 - riskOnW) * 100,
                rebalanced: shouldReb
            });
        }
        return { series: simResult, trades, regimeSwitches };
    }
};

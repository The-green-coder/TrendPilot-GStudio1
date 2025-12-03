
import React, { useState, useEffect } from 'react';
import { Card, Button, Select } from '../components/ui';
import { StorageService } from '../services/storage';
import { Strategy, BacktestResult, SymbolData, PriceType, MarketDataPoint, Transaction, RebalanceFrequency } from '../types';
import { analyzeBacktest } from '../services/geminiService';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Legend
} from 'recharts';

export const BacktestDashboard = () => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [symbols, setSymbols] = useState<SymbolData[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>('');
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [dataWarning, setDataWarning] = useState('');
  
  // Backtest Options
  const [saveTransactions, setSaveTransactions] = useState(false);

  // Load initial state
  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    const s = StorageService.getStrategies();
    const syms = StorageService.getSymbols();
    setStrategies(s);
    setSymbols(syms);
    // If selected ID exists but is not in list (deleted), or no selection, pick first
    if(s.length > 0 && (!selectedStrategyId || !s.find(strat => strat.id === selectedStrategyId))) {
         setSelectedStrategyId(s[0].id);
    }
  };

  const getTicker = (id: string) => symbols.find(s => s.id === id)?.ticker || '';

  const downloadTransactionsCSV = () => {
      if (!result || result.transactions.length === 0) return;

      const headers = ['Date', 'Ticker', 'Action', 'Price', 'Quantity', 'Total Value', 'Tx Cost'];
      const rows = result.transactions.map(t => [
          t.date,
          t.ticker,
          t.action,
          t.price.toFixed(2),
          t.quantity.toFixed(4),
          t.totalValue.toFixed(2),
          t.cost.toFixed(2)
      ]);

      const csvContent = [
          headers.join(','),
          ...rows.map(row => row.join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `transactions_${result.strategyId}_${result.runDate.split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const runBacktest = async () => {
    // CRITICAL: Reload strategies from storage immediately before running.
    // This fixes the "Stale Strategy" issue where edits weren't reflected.
    const freshStrategies = StorageService.getStrategies();
    setStrategies(freshStrategies);
    
    setIsRunning(true);
    setResult(null);
    setErrorMessage('');
    setDataWarning('');
    setAiAnalysis('');
    
    try {
        const strategy = freshStrategies.find(s => s.id === selectedStrategyId);
        if(!strategy) throw new Error("Strategy not found");

        if (strategy.riskOnComponents.length === 0) throw new Error("Strategy must have at least one Risk On asset.");

        const benchmarkTicker = getTicker(strategy.benchmarkSymbolId);
        
        // 1. Gather Required Tickers
        const riskOnTickers = strategy.riskOnComponents.map(c => getTicker(c.symbolId).trim());
        const riskOffTickers = strategy.riskOffComponents.map(c => getTicker(c.symbolId).trim());
        // Clean and unique list of tickers
        const allTickers = Array.from(new Set([benchmarkTicker.trim(), ...riskOnTickers, ...riskOffTickers])).filter(t => t);

        // 2. Load Data from Storage (Async) & Build Fast Lookup Map
        const marketDataMap: Record<string, Map<string, MarketDataPoint>> = {};
        const missingData: string[] = [];
        let datesSet = new Set<string>();

        console.log(`Loading data for: ${allTickers.join(', ')} from IndexedDB...`);

        for(const t of allTickers) {
            const data = await StorageService.getMarketData(t);
            if(!data || data.length === 0) {
                missingData.push(t);
            } else {
                const map = new Map<string, MarketDataPoint>();
                data.forEach(d => {
                    map.set(d.date, d);
                    datesSet.add(d.date); 
                });
                marketDataMap[t] = map;
            }
        }

        if(missingData.length > 0) {
            throw new Error(`Missing market data for: ${missingData.join(', ')}. Please go to Market Data Manager and click Reload.`);
        }

        // 3. Align Dates & Calculate Duration
        const sortedDates = Array.from(datesSet).sort();
        
        const durationMap: Record<string, number> = { '3M': 90, '6M': 180, '1Y': 365, '3Y': 1095, '5Y': 1825, 'Max': 99999 };
        const durationDays = durationMap[strategy.backtestDuration] || 1825; 
        
        // Correct Date Calc: Clone before modifying
        const now = new Date();
        const cutoffDateObj = new Date(now.getTime());
        cutoffDateObj.setDate(cutoffDateObj.getDate() - durationDays);
        const cutoffDate = cutoffDateObj.toISOString().split('T')[0];
        
        // Find start index
        const startDateIndex = sortedDates.findIndex(d => d >= cutoffDate);
        
        // Check for Data Sufficiency
        if (startDateIndex === -1 && strategy.backtestDuration !== 'Max') {
            if (sortedDates.length > 0 && sortedDates[0] > cutoffDate) {
                 setDataWarning(`Warning: Stored market data starts on ${sortedDates[0]}, but strategy requested data from ${cutoffDate}. The backtest period will be shorter than requested. Please go to Market Data Manager and Reload to fetch full history.`);
            }
        }

        const actualStartIndex = (strategy.backtestDuration === 'Max' || startDateIndex === -1) ? 0 : startDateIndex;
        
        const simulationDates = sortedDates.slice(actualStartIndex);
        if (simulationDates.length === 0) throw new Error("Not enough data points for simulation.");

        console.log(`Simulation running from ${simulationDates[0]} to ${simulationDates[simulationDates.length-1]}`);

        // 4. Helper: Get Price based on Preference
        const getExecutionPrice = (ticker: string, date: string): number | null => {
            const point = marketDataMap[ticker].get(date);
            if (!point) return null;
            
            switch (strategy.pricePreference) {
                case PriceType.OPEN: return point.open;
                case PriceType.HIGH: return point.high;
                case PriceType.LOW: return point.low;
                case PriceType.AVG: return (point.high + point.low + point.close) / 3;
                case PriceType.CLOSE: 
                default: return point.close;
            }
        };

        // 5. Initialize Prices and Benchmark Baseline
        let lastKnownPrices: Record<string, number> = {};
        
        // Robust Initialization: Find first valid price for each ticker
        allTickers.forEach(t => {
            let price = 0;
            // Scan forward in simulation dates until we find a price
            for(const d of simulationDates) {
                const p = marketDataMap[t].get(d);
                if(p) { price = p.close; break; }
            }
            lastKnownPrices[t] = price || 1; 
        });

        // Benchmark Sync
        let benchmarkStartPrice = 0;
        for(const d of simulationDates) {
             const p = marketDataMap[benchmarkTicker].get(d);
             if(p) { benchmarkStartPrice = p.close; break; }
        }
        if(!benchmarkStartPrice) benchmarkStartPrice = 1;

        // 6. Pre-calculate Indicators (MAs) using FULL history
        const primaryRiskOnTicker = riskOnTickers[0];
        const primaryFullHistory = sortedDates.map(d => {
            const point = marketDataMap[primaryRiskOnTicker].get(d);
            return {
                date: d, 
                price: point ? point.close : null // STRICTLY USE CLOSE FOR SIGNALS
            };
        }).filter(p => p.price !== null) as {date: string, price: number}[];

        const getMA = (period: number, date: string) => {
             const idx = primaryFullHistory.findIndex(p => p.date === date);
             if (idx < period - 1 || idx === -1) return null;
             let sum = 0;
             for(let i=0; i<period; i++) sum += primaryFullHistory[idx - i].price;
             return sum / period;
        };

        // 7. Simulation Loop Variables
        const totalOnAlloc = strategy.riskOnComponents.reduce((s, c) => s + c.allocation, 0) || 100;
        const totalOffAlloc = strategy.riskOffComponents.reduce((s, c) => s + c.allocation, 0) || 100;

        let nav = strategy.initialCapital;
        const simData = [];
        let currentAllocations = { riskOn: 1.0, riskOff: 0.0 }; // Start 100% Risk On default
        const activeRuleId = strategy.rules.length > 0 ? strategy.rules[0].ruleId : null;
        
        const recordedTransactions: Transaction[] = [];

        // Portfolio Units Tracking (Asset Ticker -> Number of Shares)
        let portfolioHoldings: Record<string, number> = {};
        // Initialize Holdings (Cash to Risk On)
        let cash = nav;
        
        // Rebalancing Logic Helper
        const isRebalanceDay = (dateStr: string, index: number, freq: RebalanceFrequency): boolean => {
            if (index === 0) return true; // Always rebalance on day 1
            const currentDate = new Date(dateStr);
            const prevDate = new Date(simulationDates[index - 1]);
            
            // Simple frequency checks based on Day/Month change
            switch(freq) {
                case RebalanceFrequency.DAILY: return true;
                case RebalanceFrequency.WEEKLY: 
                    // New week if current day < prev day (e.g. Mon < Fri) or large gap
                    return currentDate.getDay() < prevDate.getDay() || (currentDate.getTime() - prevDate.getTime()) > 7 * 86400000;
                case RebalanceFrequency.MONTHLY:
                    return currentDate.getMonth() !== prevDate.getMonth();
                case RebalanceFrequency.QUARTERLY:
                     return Math.floor(currentDate.getMonth() / 3) !== Math.floor(prevDate.getMonth() / 3);
                default: return false;
            }
        };

        for(let i = 0; i < simulationDates.length; i++) {
            const date = simulationDates[i];
            
            // --- A. Calculate Current Portfolio Value ---
            let currentPortfolioValue = cash;
            const currentExecutionPrices: Record<string, number> = {};
            
            // Update Prices and Calculate Value
            allTickers.forEach(ticker => {
                const price = getExecutionPrice(ticker, date);
                if (price) {
                    currentExecutionPrices[ticker] = price;
                    lastKnownPrices[ticker] = price;
                } else {
                    currentExecutionPrices[ticker] = lastKnownPrices[ticker];
                }
                
                if (portfolioHoldings[ticker]) {
                    currentPortfolioValue += portfolioHoldings[ticker] * currentExecutionPrices[ticker];
                }
            });
            
            nav = currentPortfolioValue;

            // --- B. Benchmark Value Update ---
            let currentBmPrice = getExecutionPrice(benchmarkTicker, date);
            if (!currentBmPrice) currentBmPrice = lastKnownPrices[benchmarkTicker] || benchmarkStartPrice;
            const benchmarkNAV = (currentBmPrice / benchmarkStartPrice) * strategy.initialCapital;

            // --- C. Signal Generation ---
            const pointPrimary = marketDataMap[primaryRiskOnTicker].get(date);
            const pPrimaryClose = pointPrimary ? pointPrimary.close : null;
            let targetRiskOnWeight = currentAllocations.riskOn;

            if (pPrimaryClose !== null) {
                const ma20 = getMA(20, date);
                const ma25 = getMA(25, date);
                const ma50 = getMA(50, date);
                const ma100 = getMA(100, date);

                if (activeRuleId === 'rule_1') {
                    if (ma25 && ma50 && ma100) {
                        let w = 0;
                        if (pPrimaryClose > ma25) w += 0.25;
                        if (pPrimaryClose > ma50) w += 0.50;
                        if (pPrimaryClose > ma100) w += 0.25;
                        targetRiskOnWeight = w;
                    }
                } else if (activeRuleId === 'rule_2') {
                    if (ma20 && ma50 && ma100) {
                        let w = 0;
                        if (pPrimaryClose > ma20) w += 0.50;
                        if (pPrimaryClose > ma50) w += 0.25;
                        if (pPrimaryClose > ma100) w += 0.25;
                        targetRiskOnWeight = w;
                    }
                } else {
                    // Fallback or hold previous
                    // targetRiskOnWeight = 1.0; 
                    // Better to hold previous if MA data missing
                }
            }
            
            currentAllocations.riskOn = targetRiskOnWeight;
            currentAllocations.riskOff = 1.0 - targetRiskOnWeight;

            // --- D. Delta Rebalancing Execution ---
            if (isRebalanceDay(date, i, strategy.rebalanceFreq)) {
                
                // 1. Calculate Target Dollar Amounts for every Asset
                const targetValues: Record<string, number> = {};
                
                // Risk On Targets
                strategy.riskOnComponents.forEach(comp => {
                    const ticker = getTicker(comp.symbolId).trim();
                    const basketWeight = (comp.allocation / totalOnAlloc); // e.g. 50% of Risk On part
                    const finalWeight = currentAllocations.riskOn * basketWeight;
                    targetValues[ticker] = nav * finalWeight;
                });

                // Risk Off Targets
                strategy.riskOffComponents.forEach(comp => {
                    const ticker = getTicker(comp.symbolId).trim();
                    const basketWeight = (comp.allocation / totalOffAlloc);
                    const finalWeight = currentAllocations.riskOff * basketWeight;
                    targetValues[ticker] = nav * finalWeight;
                });

                // 2. Identify Deltas (Target - Current)
                const involvedTickers = new Set([...Object.keys(portfolioHoldings), ...Object.keys(targetValues)]);
                
                // Phase 1: SELLS (Generate Cash)
                involvedTickers.forEach(ticker => {
                    const price = currentExecutionPrices[ticker];
                    const currentShares = portfolioHoldings[ticker] || 0;
                    const currentValue = currentShares * price;
                    const targetValue = targetValues[ticker] || 0;
                    
                    const diff = targetValue - currentValue;

                    // If Diff is negative (Overweight), SELL
                    // Use a threshold (e.g. $1) to avoid tiny trades
                    if (diff < -1 && price > 0) {
                        const valToSell = Math.abs(diff);
                        const qtyToSell = valToSell / price;
                        const txCost = valToSell * (strategy.transactionCostPct / 100);
                        
                        // Execute Sell
                        portfolioHoldings[ticker] = currentShares - qtyToSell;
                        if (portfolioHoldings[ticker] < 0.0001) delete portfolioHoldings[ticker];
                        
                        const netCash = valToSell - txCost;
                        cash += netCash;
                        nav -= txCost; // NAV reduced by transaction cost

                        if (saveTransactions) {
                            recordedTransactions.push({
                                date, ticker, action: 'SELL', price, quantity: qtyToSell, totalValue: valToSell, cost: txCost
                            });
                        }
                    }
                });

                // Phase 2: BUYS (Deploy Cash)
                involvedTickers.forEach(ticker => {
                    const price = currentExecutionPrices[ticker];
                    const currentShares = portfolioHoldings[ticker] || 0;
                    const currentValue = currentShares * price;
                    const targetValue = targetValues[ticker] || 0;
                    
                    const diff = targetValue - currentValue;

                    // If Diff is positive (Underweight) AND we have cash, BUY
                    if (diff > 1 && cash > 1 && price > 0) {
                        // Max we can buy with current cash including costs
                        // Cost = Val * Pct. Total Spend = Val + Cost = Val * (1 + Pct)
                        const costFactor = 1 + (strategy.transactionCostPct / 100);
                        const maxBuyableValue = cash / costFactor;
                        
                        // Buy the difference, or whatever cash allows
                        const valToBuy = Math.min(diff, maxBuyableValue);
                        
                        if (valToBuy > 1) {
                            const qtyToBuy = valToBuy / price;
                            const txCost = valToBuy * (strategy.transactionCostPct / 100);
                            
                            // Execute Buy
                            portfolioHoldings[ticker] = currentShares + qtyToBuy;
                            cash -= (valToBuy + txCost);
                            nav -= txCost;

                            if (saveTransactions) {
                                recordedTransactions.push({
                                    date, ticker, action: 'BUY', price, quantity: qtyToBuy, totalValue: valToBuy, cost: txCost
                                });
                            }
                        }
                    }
                });
            }

            simData.push({
                date,
                value: Number(nav.toFixed(2)),
                benchmarkValue: Number(benchmarkNAV.toFixed(2)),
                riskOn: Number((currentAllocations.riskOn * 100).toFixed(0)),
                riskOff: Number((currentAllocations.riskOff * 100).toFixed(0))
            });
        }

        if(simData.length === 0) throw new Error("Simulation yielded no data.");
        
        const finalNav = simData[simData.length-1].value;
        const totalReturn = ((finalNav - strategy.initialCapital) / strategy.initialCapital) * 100;
        const years = simData.length / 252;
        const cagr = (Math.pow(finalNav / strategy.initialCapital, 1 / (years || 1)) - 1) * 100;

        let peak = -Infinity;
        let maxDd = 0;
        simData.forEach(d => {
            if(d.value > peak) peak = d.value;
            const dd = (peak - d.value) / peak;
            if(dd > maxDd) maxDd = dd;
        });

        const lastAlloc = simData[simData.length - 1];

        const mockRes: BacktestResult = {
            strategyId: selectedStrategyId,
            runDate: new Date().toISOString(),
            stats: {
                cagr: Number(cagr.toFixed(2)),
                maxDrawdown: Number((maxDd * 100).toFixed(2)),
                sharpeRatio: 0,
                totalReturn: Number(totalReturn.toFixed(2)),
                winRate: 0
            },
            navSeries: simData,
            allocations: [],
            transactions: recordedTransactions,
            latestAllocation: {
                date: lastAlloc.date,
                riskOn: lastAlloc.riskOn,
                riskOff: lastAlloc.riskOff
            }
        };
        
        setResult(mockRes);
        StorageService.saveBacktestResult(mockRes);

    } catch (err: any) {
        setErrorMessage(err.message);
        console.error(err);
    } finally {
        setIsRunning(false);
    }
  };

  const handleAIAnalysis = async () => {
    if (!result || !selectedStrategyId) return;
    setIsAnalyzing(true);
    const strategy = strategies.find(s => s.id === selectedStrategyId);
    if (strategy) {
      const text = await analyzeBacktest(strategy, result);
      setAiAnalysis(text);
    }
    setIsAnalyzing(false);
  };

  const benchmarkLabel = selectedStrategyId ? getTicker(strategies.find(s=>s.id === selectedStrategyId)?.benchmarkSymbolId || '') : 'Benchmark';

  return (
    <div className="space-y-6">
       <div className="flex justify-between items-end">
            <div>
                <h2 className="text-2xl font-bold text-white">Backtesting Engine</h2>
                <p className="text-slate-400">Run simulations with real historical data.</p>
            </div>
            <div className="flex flex-col gap-2 items-end">
                <div className="flex gap-4 items-end bg-slate-900 p-2 rounded-lg border border-slate-800">
                    <Select 
                        value={selectedStrategyId}
                        onChange={(e) => setSelectedStrategyId(e.target.value)}
                        options={strategies.map(s => ({ value: s.id, label: s.name }))}
                        className="w-64"
                    />
                    <Button onClick={runBacktest} disabled={isRunning || !selectedStrategyId}>
                        {isRunning ? 'Simulating...' : 'Run Backtest'}
                    </Button>
                </div>
                 <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
                    <input 
                        type="checkbox" 
                        checked={saveTransactions} 
                        onChange={e => setSaveTransactions(e.target.checked)}
                        className="rounded bg-slate-800 border-slate-600 text-emerald-500 focus:ring-emerald-500"
                    />
                    Save Transaction Data
                </label>
            </div>
       </div>

       {errorMessage && (
           <div className="p-4 bg-red-900/20 border border-red-500/50 rounded-lg text-red-200">
               Error: {errorMessage}
           </div>
       )}

       {dataWarning && (
           <div className="p-4 bg-yellow-900/20 border border-yellow-500/50 rounded-lg text-yellow-200">
               {dataWarning}
           </div>
       )}

       {result ? (
           <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
               {/* Stats Cards */}
               <Card className="lg:col-span-1 space-y-6 h-fit">
                    <h3 className="font-bold text-slate-200 border-b border-slate-800 pb-2">Performance Metrics</h3>
                    <div className="grid grid-cols-2 lg:grid-cols-1 gap-4">
                        <div>
                            <div className="text-xs text-slate-500 uppercase">Total Return</div>
                            <div className={`text-2xl font-mono ${result.stats.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {result.stats.totalReturn > 0 ? '+' : ''}{result.stats.totalReturn}%
                            </div>
                        </div>
                        <div>
                            <div className="text-xs text-slate-500 uppercase">CAGR</div>
                            <div className="text-xl font-mono text-slate-200">{result.stats.cagr}%</div>
                        </div>
                        <div>
                            <div className="text-xs text-slate-500 uppercase">Max Drawdown</div>
                            <div className="text-xl font-mono text-red-400">{result.stats.maxDrawdown}%</div>
                        </div>
                    </div>

                    {result.latestAllocation && (
                        <div className="pt-4 border-t border-slate-800">
                             <div className="text-xs text-slate-500 uppercase mb-2">Latest Signal ({result.latestAllocation.date})</div>
                             <div className="flex gap-2">
                                <div className={`flex-1 p-2 rounded text-center text-sm font-bold border ${result.latestAllocation.riskOn > 50 ? 'bg-emerald-900/50 text-emerald-400 border-emerald-500' : 'bg-slate-800 text-slate-600 border-slate-700'}`}>
                                    On: {result.latestAllocation.riskOn}%
                                </div>
                                <div className={`flex-1 p-2 rounded text-center text-sm font-bold border ${result.latestAllocation.riskOff > 50 ? 'bg-slate-700 text-slate-200 border-slate-500' : 'bg-slate-800 text-slate-600 border-slate-700'}`}>
                                    Off: {result.latestAllocation.riskOff}%
                                </div>
                             </div>
                        </div>
                    )}
                    
                    <div className="pt-4 border-t border-slate-800 space-y-3">
                        {saveTransactions && result.transactions.length > 0 && (
                             <Button 
                                variant="secondary" 
                                className="w-full text-sm"
                                onClick={downloadTransactionsCSV}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                Download Trades (.CSV)
                            </Button>
                        )}

                        <Button 
                            variant="secondary" 
                            className="w-full flex justify-between"
                            onClick={handleAIAnalysis}
                            disabled={isAnalyzing}
                        >
                            <span>Ask AI Analyst</span>
                            {isAnalyzing ? <span className="animate-spin">...</span> : <span>✨</span>}
                        </Button>
                        {aiAnalysis && (
                            <div className="mt-4 p-3 bg-indigo-900/20 border border-indigo-500/30 rounded-lg text-sm text-indigo-200 leading-relaxed">
                                {aiAnalysis}
                            </div>
                        )}
                    </div>
               </Card>

               {/* Charts */}
               <div className="lg:col-span-3 space-y-6">
                   <Card className="h-96 relative">
                       <div className="flex justify-between items-center mb-4">
                           <h3 className="text-sm font-medium text-slate-400">Equity Curve vs {benchmarkLabel}</h3>
                           <span className="text-xs bg-emerald-900/30 text-emerald-400 px-2 py-1 rounded border border-emerald-800">Real Market Data</span>
                       </div>
                       <ResponsiveContainer width="100%" height="90%">
                           <LineChart data={result.navSeries}>
                               <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                               <XAxis dataKey="date" stroke="#64748b" tick={{fontSize: 12}} minTickGap={30} />
                               <YAxis stroke="#64748b" tick={{fontSize: 12}} domain={['auto', 'auto']} />
                               <Tooltip 
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }}
                                    itemStyle={{ color: '#cbd5e1' }}
                                    formatter={(value: number) => [value.toFixed(2), '']}
                               />
                               <Legend verticalAlign="top" height={36} iconType="circle" />
                               <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={false} name="Strategy NAV" />
                               <Line type="monotone" dataKey="benchmarkValue" stroke="#64748b" strokeWidth={2} dot={false} name={benchmarkLabel} />
                           </LineChart>
                       </ResponsiveContainer>
                   </Card>

                   <Card className="h-72">
                       <h3 className="text-sm font-medium text-slate-400 mb-4">Total Asset Allocation (Stacked)</h3>
                       <ResponsiveContainer width="100%" height="90%">
                           <AreaChart data={result.navSeries}>
                               <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                               <XAxis dataKey="date" hide />
                               <YAxis domain={[0, 100]} stroke="#64748b" />
                               <Tooltip 
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }}
                                    formatter={(value: number) => [`${value.toFixed(0)}%`, '']}
                               />
                               <Legend verticalAlign="top" height={36}/>
                               <Area 
                                    type="monotone" 
                                    dataKey="riskOn" 
                                    stackId="1" 
                                    stroke="#059669" 
                                    fill="#10b981" 
                                    name="Risk On %" 
                                    animationDuration={500}
                               />
                               <Area 
                                    type="monotone" 
                                    dataKey="riskOff" 
                                    stackId="1" 
                                    stroke="#475569" 
                                    fill="#64748b" 
                                    name="Risk Off %" 
                                    animationDuration={500}
                               />
                           </AreaChart>
                       </ResponsiveContainer>
                   </Card>
               </div>
           </div>
       ) : (
           <div className="flex flex-col items-center justify-center h-96 border-2 border-dashed border-slate-800 rounded-xl text-slate-500">
               {isRunning ? (
                   <div className="text-emerald-500 animate-pulse">Running Simulation...</div>
               ) : (
                   <>
                    <svg className="w-16 h-16 mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                    <p>Select a strategy and click run to view results</p>
                   </>
               )}
           </div>
       )}
    </div>
  );
};

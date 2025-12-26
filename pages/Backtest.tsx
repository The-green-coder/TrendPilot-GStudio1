
import React, { useState, useEffect, useMemo } from 'react';
import { Card, Button, Select } from '../components/ui';
import { StorageService } from '../services/storage';
import { Strategy, BacktestResult, SymbolData, RebalanceFrequency } from '../types';
import { StrategyEngine, SimResultPoint, SimTrade } from '../services/strategyEngine';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, AreaChart, Area
} from 'recharts';

interface ComparisonStats {
  strategy: { totalReturn: number; cagr: number; maxDD: number; volatility: number; sharpe: number; };
  benchmark: { totalReturn: number; cagr: number; maxDD: number; volatility: number; sharpe: number; };
  rolling: { tenor: string; strat: { min: number; mean: number; max: number }; bench: { min: number; mean: number; max: number } }[];
  yearlyActivity: { year: number; switches: number; totalTrades: number }[];
  yearlyReturns: { year: number; strat: number; bench: number }[];
  tenors: { tenor: string; strat: number | string; bench: number | string }[];
}

export const BacktestEngine = () => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [symbols, setSymbols] = useState<SymbolData[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>('');
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [detailedResult, setDetailedResult] = useState<{ trades: SimTrade[], regimeSwitches: any[] } | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'Chart' | 'Trades' | 'Compare'>('Chart');
  const [range, setRange] = useState<[number, number]>([0, 0]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    const s = StorageService.getStrategies();
    setStrategies(s);
    setSymbols(StorageService.getSymbols());
    if (s.length > 0 && !selectedStrategyId) setSelectedStrategyId(s[0].id);
  };

  const calculateFullStats = (slice: SimResultPoint[], trades: SimTrade[], switches: any[]): ComparisonStats => {
    const calcBase = (vals: number[]) => {
      if (vals.length < 2) return { totalReturn: 0, cagr: 0, maxDD: 0, volatility: 0, sharpe: 0 };
      const returns = [];
      for (let i = 1; i < vals.length; i++) {
        const r = (vals[i] / (vals[i - 1] || 1)) - 1;
        returns.push(isNaN(r) || !isFinite(r) ? 0 : r);
      }
      const first = vals[0], last = vals[vals.length - 1];
      const years = Math.max(0.01, vals.length / 252);
      const cagr = (Math.pow(Math.abs(last / (first || 1)), 1 / years) - 1) * 100;
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const vol = Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1) * 252) * 100;
      let peak = -Infinity, mdd = 0;
      vals.forEach(v => { if (v > peak) peak = v; const dd = (peak - v) / (peak || 1); if (dd > mdd) mdd = dd; });
      return { totalReturn: ((last - first) / (first || 1)) * 100, cagr, maxDD: mdd * 100, volatility: vol, sharpe: vol > 0 ? (cagr - 5) / vol : 0 }; 
    };

    const calcRolling = (series: number[], window: number) => {
      if (series.length < window) return { min: 0, mean: 0, max: 0 };
      const rolls = [];
      const years = window / 252;
      for (let i = window; i < series.length; i++) {
        const ret = (Math.pow(Math.abs(series[i] / (series[i - window] || 1)), 1 / years) - 1) * 100;
        if (!isNaN(ret) && isFinite(ret)) rolls.push(ret);
      }
      if (rolls.length === 0) return { min: 0, mean: 0, max: 0 };
      return {
        min: Math.min(...rolls),
        max: Math.max(...rolls),
        mean: rolls.reduce((a, b) => a + b, 0) / (rolls.length || 1)
      };
    };

    const rolling = [
      { tenor: '3M Rolling', strat: calcRolling(slice.map(p => p.value), 63), bench: calcRolling(slice.map(p => p.benchmarkValue), 63) },
      { tenor: '1Y Rolling', strat: calcRolling(slice.map(p => p.value), 252), bench: calcRolling(slice.map(p => p.benchmarkValue), 252) },
      { tenor: '3Y Rolling', strat: calcRolling(slice.map(p => p.value), 756), bench: calcRolling(slice.map(p => p.benchmarkValue), 756) }
    ];

    const yearsList = Array.from(new Set(slice.map(p => new Date(p.date).getFullYear()))).sort((a,b) => b-a);
    
    const yearlyReturns = yearsList.map(yr => {
        const yrData = slice.filter(p => new Date(p.date).getFullYear() === yr);
        if (yrData.length < 2) return { year: yr, strat: 0, bench: 0 };
        const stratRet = ((yrData[yrData.length-1].value / yrData[0].value) - 1) * 100;
        const benchRet = ((yrData[yrData.length-1].benchmarkValue / yrData[0].benchmarkValue) - 1) * 100;
        return { year: yr, strat: stratRet, bench: benchRet };
    });

    const yearlyActivity = yearsList.map(yr => {
        const yrTrades = trades.filter(t => new Date(t.date).getFullYear() === yr);
        const yrSwitches = switches.filter(s => new Date(s.date).getFullYear() === yr);
        return { year: yr, switches: yrSwitches.length, totalTrades: yrTrades.length };
    });

    const getTenorCAGR = (s: SimResultPoint[], days: number) => {
        if (s.length < days) return 'N/A';
        const subset = s.slice(-days);
        const years = days / 252;
        const res = (Math.pow(Math.abs(subset[subset.length-1].value / (subset[0].value || 1)), 1/years) - 1) * 100;
        return res.toFixed(2) + '%';
    };

    const tenors = [
        { tenor: '1 Year CAGR', strat: getTenorCAGR(slice, 252), bench: getTenorCAGR(slice.map(p=>({ ...p, value: p.benchmarkValue })), 252) },
        { tenor: '3 Year CAGR', strat: getTenorCAGR(slice, 756), bench: getTenorCAGR(slice.map(p=>({ ...p, value: p.benchmarkValue })), 756) },
        { tenor: 'Full Period CAGR', strat: calcBase(slice.map(p=>p.value)).cagr.toFixed(2) + '%', bench: calcBase(slice.map(p=>p.benchmarkValue)).cagr.toFixed(2) + '%' }
    ];

    return { 
      strategy: calcBase(slice.map(p => p.value)), 
      benchmark: calcBase(slice.map(p => p.benchmarkValue)),
      rolling,
      yearlyActivity,
      yearlyReturns,
      tenors
    };
  };

  const runBacktest = async () => {
    setIsRunning(true);
    setErrorMessage('');
    try {
        const strat = strategies.find(s => s.id === selectedStrategyId);
        if (!strat) throw new Error("Select a strategy");
        const sim = await StrategyEngine.runSimulation(strat, symbols);
        setDetailedResult({ trades: sim.trades, regimeSwitches: sim.regimeSwitches });
        setResult({
            strategyId: strat.id, runDate: new Date().toISOString(),
            stats: { cagr: 0, maxDrawdown: 0, sharpeRatio: 0, totalReturn: 0, winRate: 0 },
            navSeries: sim.series, allocations: [], transactions: []
        });
        setRange([0, sim.series.length - 1]);
    } catch (e: any) {
        setErrorMessage(e.message);
    } finally {
        setIsRunning(false);
    }
  };

  const { filteredSeries, currentStats } = useMemo(() => {
    if (!result || range[1] <= range[0] || !detailedResult) return { filteredSeries: [], currentStats: null };
    const slice = result.navSeries.slice(range[0], range[1] + 1);
    const stratStart = slice[0].value;
    const bmStart = slice[0].benchmarkValue;
    const normalized = slice.map(p => ({
      ...p,
      value: (p.value / (stratStart || 1)) * 10000,
      benchmarkValue: (p.benchmarkValue / (bmStart || 1)) * 10000
    }));
    const stats = calculateFullStats(normalized, detailedResult.trades, detailedResult.regimeSwitches);
    return { filteredSeries: normalized, currentStats: stats };
  }, [result, range, detailedResult]);

  return (
    <div className="space-y-6">
       <style>{`
         .dual-range-input::-webkit-slider-thumb {
           pointer-events: auto;
           position: relative;
           z-index: 100;
         }
       `}</style>

       <div className="flex justify-between items-end">
            <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">Backtesting Engine</h2>
                <p className="text-slate-400">Deep quant analysis with fully flexible window selection.</p>
            </div>
            <div className="flex gap-4 items-end bg-slate-900 p-3 rounded-xl border border-slate-800">
                <Select value={selectedStrategyId} onChange={e => setSelectedStrategyId(e.target.value)} options={strategies.map(s => ({ value: s.id, label: s.name }))} className="w-64" />
                <Button onClick={runBacktest} disabled={isRunning}>{isRunning ? 'Simulating...' : 'Run Analysis'}</Button>
            </div>
       </div>

       {errorMessage && <Card className="border-red-500/50 bg-red-950/20 text-red-200">{errorMessage}</Card>}

       {result && currentStats && (
           <div className="space-y-6">
               <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card><div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Total Return</div><div className="text-2xl font-mono text-emerald-400">{currentStats.strategy.totalReturn.toFixed(1)}%</div></Card>
                    <Card><div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Ann. CAGR</div><div className="text-2xl font-mono text-white">{currentStats.strategy.cagr.toFixed(1)}%</div></Card>
                    <Card><div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Max Drawdown</div><div className="text-2xl font-mono text-red-400">-{currentStats.strategy.maxDD.toFixed(1)}%</div></Card>
                    <Card><div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Sharpe Ratio</div><div className="text-2xl font-mono text-indigo-400">{currentStats.strategy.sharpe.toFixed(2)}</div></Card>
               </div>

               <div className="flex flex-col xl:flex-row justify-between items-center gap-6">
                    <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 w-full xl:w-fit shadow-lg shadow-black/20">
                        {['Chart', 'Trades', 'Compare'].map(t => (
                            <button key={t} onClick={() => setActiveTab(t as any)} className={`flex-1 xl:flex-none px-8 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === t ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>{t}</button>
                        ))}
                    </div>

                    <div className="flex-1 w-full bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-3">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            <span>Analysis Start: <span className="text-white font-mono">{filteredSeries[0]?.date}</span></span>
                            <span>Analysis End: <span className="text-white font-mono">{filteredSeries[filteredSeries.length-1]?.date}</span></span>
                        </div>
                        <div className="relative h-6 flex items-center px-2">
                            <input 
                                type="range" 
                                min={0} 
                                max={result.navSeries.length - 1} 
                                value={range[0]} 
                                onChange={e => {
                                    const val = Math.min(parseInt(e.target.value), range[1] - 1);
                                    setRange([val, range[1]]);
                                }} 
                                className="dual-range-input absolute left-2 right-2 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" 
                                style={{ pointerEvents: 'auto', zIndex: range[0] > (result.navSeries.length / 2) ? 45 : 35 }}
                            />
                            <input 
                                type="range" 
                                min={0} 
                                max={result.navSeries.length - 1} 
                                value={range[1]} 
                                onChange={e => {
                                    const val = Math.max(parseInt(e.target.value), range[0] + 1);
                                    setRange([range[0], val]);
                                }} 
                                className="dual-range-input absolute left-2 right-2 h-1.5 bg-transparent rounded-lg appearance-none cursor-pointer accent-indigo-500" 
                                style={{ pointerEvents: 'auto', zIndex: range[1] < (result.navSeries.length / 2) ? 45 : 35 }}
                            />
                        </div>
                        <div className="text-[9px] text-center text-slate-600 font-mono italic">
                            Grab either handle to slice. Performance re-baselines to 10k at your chosen start.
                        </div>
                    </div>
               </div>

               {activeTab === 'Chart' && (
                   <div className="space-y-6">
                       <Card className="h-[450px] flex flex-col p-8">
                            <div className="flex justify-between items-center mb-8">
                                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-widest">Growth Comparison (Indexed @ 10,000)</h3>
                            </div>
                            <div className="flex-1 min-h-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={filteredSeries}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis dataKey="date" tick={{fontSize: 10, fill: '#64748b'}} minTickGap={60} />
                                        <YAxis tick={{fontSize: 10, fill: '#64748b'}} domain={['auto', 'auto']} />
                                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '12px' }} />
                                        <Legend verticalAlign="top" height={36}/>
                                        <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2.5} dot={false} name="Strategy" isAnimationActive={false} />
                                        <Line type="monotone" dataKey="benchmarkValue" stroke="#64748b" strokeWidth={1.5} dot={false} strokeDasharray="4 4" name="Benchmark" isAnimationActive={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                       </Card>

                       <Card className="h-[250px] flex flex-col p-8">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-xs font-medium text-slate-400 uppercase tracking-widest">Regime Allocation (%)</h3>
                            </div>
                            <div className="flex-1 min-h-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={filteredSeries}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis dataKey="date" hide />
                                        <YAxis domain={[0, 100]} tick={{fontSize: 9, fill: '#64748b'}} width={30} unit="%" />
                                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '12px' }} formatter={(v: number) => [`${v}%`, '']} />
                                        <Legend verticalAlign="top" height={36}/>
                                        <Area type="monotone" dataKey="riskOn" stackId="1" stroke="#059669" fill="#10b981" fillOpacity={0.4} name="Risk On %" isAnimationActive={false} />
                                        <Area type="monotone" dataKey="riskOff" stackId="1" stroke="#475569" fill="#334155" fillOpacity={0.6} name="Risk Off %" isAnimationActive={false} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                       </Card>
                   </div>
               )}

               {activeTab === 'Compare' && (
                   <div className="space-y-6">
                       <Card className="p-0 overflow-hidden border-slate-800">
                           <div className="p-4 bg-slate-800/50 border-b border-slate-700 font-bold text-xs uppercase tracking-widest text-slate-200">Yearly Performance Matrix</div>
                           <table className="w-full text-left text-xs font-mono">
                               <thead className="bg-slate-900/50 text-slate-400">
                                   <tr>
                                       <th className="px-6 py-3">Calendar Year</th>
                                       <th className="px-6 py-3 text-emerald-400">Strategy Return</th>
                                       <th className="px-6 py-3 text-slate-200 font-bold">Benchmark Return</th>
                                       <th className="px-6 py-3">Alpha / Excess</th>
                                   </tr>
                               </thead>
                               <tbody className="divide-y divide-slate-800">
                                   {currentStats.yearlyReturns.map(yr => (
                                       <tr key={yr.year} className="hover:bg-slate-800/30 transition-colors">
                                           <td className="px-6 py-4 font-bold text-slate-300">{yr.year}</td>
                                           <td className={`px-6 py-4 font-bold ${yr.strat >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{yr.strat.toFixed(2)}%</td>
                                           <td className={`px-6 py-4 font-bold ${yr.bench >= 0 ? 'text-slate-200' : 'text-red-500'}`}>{yr.bench.toFixed(2)}%</td>
                                           <td className={`px-6 py-4 font-bold ${yr.strat - yr.bench >= 0 ? 'text-indigo-400' : 'text-amber-600'}`}>{(yr.strat - yr.bench).toFixed(2)}%</td>
                                       </tr>
                                   ))}
                               </tbody>
                           </table>
                       </Card>

                       <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <Card className="p-0 overflow-hidden border-slate-800">
                                <div className="p-4 bg-slate-800/50 border-b border-slate-700 font-bold text-xs uppercase tracking-widest text-slate-200">Rolling CAGR Comparison</div>
                                <table className="w-full text-left text-xs font-mono">
                                    <thead className="bg-slate-900/50 text-slate-400">
                                        <tr>
                                            <th className="px-6 py-3">Period</th>
                                            <th className="px-6 py-3 text-emerald-400">Strategy (Min/Avg/Max)</th>
                                            <th className="px-6 py-3 text-slate-200 font-bold">Benchmark (Min/Avg/Max)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800">
                                        {currentStats.rolling.map(r => (
                                            <tr key={r.tenor} className="hover:bg-slate-800/30">
                                                <td className="px-6 py-4 font-bold text-slate-300">{r.tenor}</td>
                                                <td className="px-6 py-4">
                                                    <span className="text-red-400 text-[10px]">{r.strat.min.toFixed(1)}</span> <span className="text-emerald-400 font-bold mx-1">{r.strat.mean.toFixed(1)}%</span> <span className="text-blue-400 text-[10px]">{r.strat.max.toFixed(1)}</span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="text-red-500 text-[10px]">{r.bench.min.toFixed(1)}</span> <span className="text-slate-200 font-bold mx-1">{r.bench.mean.toFixed(1)}%</span> <span className="text-indigo-400 text-[10px]">{r.bench.max.toFixed(1)}</span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </Card>

                            <Card className="p-0 overflow-hidden border-slate-800">
                                <div className="p-4 bg-slate-800/50 border-b border-slate-700 font-bold text-xs uppercase tracking-widest text-slate-200">Efficiency & Risk Profile</div>
                                <table className="w-full text-left text-xs font-mono">
                                    <thead className="bg-slate-900/50 text-slate-400">
                                        <tr><th className="px-6 py-3">Metric</th><th className="px-6 py-3 text-emerald-400">Strategy</th><th className="px-6 py-3 text-slate-200 font-bold">Benchmark</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800">
                                        <tr><td className="px-6 py-4 text-slate-400">Ann. Volatility</td><td className="px-6 py-4 text-indigo-400 font-bold">{currentStats.strategy.volatility.toFixed(2)}%</td><td className="px-6 py-4 text-slate-200 font-bold">{currentStats.benchmark.volatility.toFixed(2)}%</td></tr>
                                        <tr><td className="px-6 py-4 text-slate-400">Sharpe Ratio</td><td className="px-6 py-4 text-indigo-400 font-bold">{currentStats.strategy.sharpe.toFixed(2)}</td><td className="px-6 py-4 text-slate-200 font-bold">{currentStats.benchmark.sharpe.toFixed(2)}</td></tr>
                                        <tr><td className="px-6 py-4 text-slate-400">Max Drawdown</td><td className="px-6 py-4 text-red-400 font-bold">-{currentStats.strategy.maxDD.toFixed(1)}%</td><td className="px-6 py-4 text-slate-200 font-bold">-{currentStats.benchmark.maxDD.toFixed(1)}%</td></tr>
                                    </tbody>
                                </table>
                            </Card>
                       </div>

                       <Card className="p-0 overflow-hidden border-slate-800">
                            <div className="p-4 bg-slate-800/50 border-b border-slate-700 font-bold text-xs uppercase tracking-widest text-slate-200">Yearly Activity & Implementation</div>
                            <table className="w-full text-left text-xs font-mono">
                                <thead className="bg-slate-900/50 text-slate-400">
                                    <tr><th className="px-6 py-3">Year</th><th className="px-6 py-3 text-center">Regime Switches</th><th className="px-6 py-3 text-right">Execution Frequency (Trades)</th></tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800">
                                    {currentStats.yearlyActivity.map(y => (
                                        <tr key={y.year} className="hover:bg-slate-800/30 transition-colors">
                                            <td className="px-6 py-4 font-bold text-slate-300">{y.year}</td>
                                            <td className="px-6 py-4 text-center text-amber-500 font-bold">{y.switches}</td>
                                            <td className="px-6 py-4 text-right text-indigo-400">{y.totalTrades}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                       </Card>
                   </div>
               )}

               {activeTab === 'Trades' && detailedResult && (
                   <Card className="p-0 overflow-hidden border-slate-800 shadow-2xl">
                       <div className="overflow-x-auto">
                           <table className="w-full text-left text-xs font-mono">
                               <thead className="bg-slate-800 text-slate-400 uppercase font-bold sticky top-0">
                                   <tr>
                                       <th className="px-6 py-4">Execution Date</th>
                                       <th className="px-6 py-4">Ticker</th>
                                       <th className="px-6 py-4 text-center">Action</th>
                                       <th className="px-6 py-4 text-right">Shares</th>
                                       <th className="px-6 py-4 text-right">Price</th>
                                       <th className="px-6 py-4 text-right">Notional</th>
                                   </tr>
                               </thead>
                               <tbody className="divide-y divide-slate-800">
                                   {detailedResult.trades
                                    .filter(t => t.date >= filteredSeries[0].date && t.date <= filteredSeries[filteredSeries.length-1].date)
                                    .slice().reverse().map((t, idx) => (
                                       <tr key={idx} className="hover:bg-slate-800/40 transition-colors group">
                                           <td className="px-6 py-4 text-slate-400">{t.date}</td>
                                           <td className="px-6 py-4 text-emerald-400 font-bold group-hover:text-white transition-colors">{t.ticker}</td>
                                           <td className="px-6 py-4 text-center">
                                               <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${t.type === 'BUY' ? 'bg-emerald-900/30 text-emerald-500' : 'bg-red-900/30 text-red-500'}`}>{t.type}</span>
                                           </td>
                                           <td className="px-6 py-4 text-right text-slate-300">{t.shares.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                           <td className="px-6 py-4 text-right text-slate-300">${t.price.toFixed(2)}</td>
                                           <td className="px-6 py-4 text-right text-white font-bold">${t.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                                       </tr>
                                   ))}
                               </tbody>
                           </table>
                       </div>
                   </Card>
               )}
           </div>
       )}
    </div>
  );
};

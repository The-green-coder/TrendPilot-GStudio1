
import React, { useState, useEffect, useMemo } from 'react';
import { Card, Button, Select, Input } from '../components/ui';
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
  tenors: { label: string; stats: { strat: number; bench: number; alpha: number } }[];
}

export const BacktestEngine = () => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [symbols, setSymbols] = useState<SymbolData[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>('');
  const [selectedDuration, setSelectedDuration] = useState<string>('1Y');
  const [onlyTradeOnSignalChange, setOnlyTradeOnSignalChange] = useState(false);
  
  const [customStartDate, setCustomStartDate] = useState<string>(new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().split('T')[0]);
  const [customEndDate, setCustomEndDate] = useState<string>(new Date().toISOString().split('T')[0]);

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
    if (s.length > 0 && !selectedStrategyId) {
      setSelectedStrategyId(s[0].id);
      setSelectedDuration(s[0].backtestDuration || '1Y');
      setOnlyTradeOnSignalChange(s[0].onlyTradeOnSignalChange || false);
    }
  };

  useEffect(() => {
    const s = strategies.find(strat => strat.id === selectedStrategyId);
    if (s) setOnlyTradeOnSignalChange(s.onlyTradeOnSignalChange || false);
  }, [selectedStrategyId, strategies]);

  const calculateFullStats = (slice: SimResultPoint[], trades: SimTrade[], switches: any[]): ComparisonStats => {
    const calcBase = (vals: number[]) => {
      if (vals.length < 5) return { totalReturn: 0, cagr: 0, maxDD: 0, volatility: 0, sharpe: 0 };
      
      const returns: number[] = [];
      for (let i = 1; i < vals.length; i++) {
        let r = (vals[i] / (vals[i - 1] || 1)) - 1;
        if (r > 1) r = 1;
        if (r < -0.9) r = -0.9;
        if (isFinite(r)) returns.push(r);
      }
      
      const first = vals[0], last = vals[vals.length - 1];
      const years = Math.max(0.01, vals.length / 252);
      
      let cagr = (Math.pow(Math.abs(last / (first || 1)), 1 / years) - 1) * 100;
      if (!isFinite(cagr) || cagr > 10000) cagr = 0;

      const mean = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
      const vol = returns.length > 1 
        ? Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1) * 252) * 100
        : 0;

      let peak = -Infinity, mdd = 0;
      vals.forEach(v => { if (v > peak) peak = v; const dd = (peak - v) / (peak || 1); if (dd > mdd) mdd = dd; });
      
      return { 
        totalReturn: ((last - first) / (first || 1)) * 100, 
        cagr, 
        maxDD: mdd * 100, 
        volatility: vol, 
        sharpe: (vol > 1) ? (cagr - 5) / vol : 0 
      }; 
    };

    const calcRolling = (series: number[], window: number) => {
      if (series.length < window + 5) return { min: 0, mean: 0, max: 0 };
      const rolls: number[] = [];
      const years = window / 252;
      for (let i = window; i < series.length; i++) {
        const start = series[i - window];
        const end = series[i];
        if (start < 0.01) continue;
        const ret = (Math.pow(Math.abs(end / start), 1 / years) - 1) * 100;
        if (isFinite(ret) && Math.abs(ret) < 2000) {
            rolls.push(ret);
        }
      }
      if (rolls.length === 0) return { min: 0, mean: 0, max: 0 };
      return {
        min: Math.min(...rolls),
        max: Math.max(...rolls),
        mean: rolls.reduce((a, b) => a + b, 0) / rolls.length
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
        if (yrData.length < 10) return { year: yr, strat: 0, bench: 0 };
        const stratRet = ((yrData[yrData.length-1].value / yrData[0].value) - 1) * 100;
        const benchRet = ((yrData[yrData.length-1].benchmarkValue / yrData[0].benchmarkValue) - 1) * 100;
        return { 
            year: yr, 
            strat: isFinite(stratRet) ? stratRet : 0, 
            bench: isFinite(benchRet) ? benchRet : 0 
        };
    });

    const yearlyActivity = yearsList.map(yr => {
        const yrTrades = trades.filter(t => new Date(t.date).getFullYear() === yr);
        const yrSwitches = switches.filter(s => new Date(s.date).getFullYear() === yr);
        return { year: yr, switches: yrSwitches.length, totalTrades: yrTrades.length };
    });

    const getTenorStats = (s: SimResultPoint[], days: number) => {
        if (s.length < days + 5) return null;
        const subset = s.slice(-days);
        const start = subset[0].value;
        const end = subset[subset.length-1].value;
        const bStart = subset[0].benchmarkValue;
        const bEnd = subset[subset.length-1].benchmarkValue;
        
        if (start < 0.1 || bStart < 0.1) return null;
        
        const years = days / 252;
        const sCAGR = (Math.pow(Math.abs(end / start), 1/years) - 1) * 100;
        const bCAGR = (Math.pow(Math.abs(bEnd / bStart), 1/years) - 1) * 100;
        
        return {
            strat: sCAGR,
            bench: bCAGR,
            alpha: sCAGR - bCAGR
        };
    };

    const stratStats = calcBase(slice.map(p=>p.value));
    const benchStats = calcBase(slice.map(p=>p.benchmarkValue));

    const tenors = [
        { label: '1 Year', stats: getTenorStats(slice, 252) },
        { label: '3 Years', stats: getTenorStats(slice, 756) },
        { label: '5 Years', stats: getTenorStats(slice, 1260) },
        { label: 'Full Period', stats: { strat: stratStats.cagr, bench: benchStats.cagr, alpha: stratStats.cagr - benchStats.cagr } }
    ].filter(t => t.stats !== null) as { label: string; stats: { strat: number; bench: number; alpha: number } }[];

    return { 
      strategy: stratStats, 
      benchmark: benchStats,
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

        // Temporary override for simulation
        const runConfig = { ...strat, onlyTradeOnSignalChange };

        let startDate: string | undefined = undefined;
        let endDate: string | undefined = undefined;

        if (selectedDuration === 'Custom') {
            startDate = customStartDate;
            endDate = customEndDate;
        } else if (selectedDuration !== 'Max') {
            const daysMap: Record<string, number> = { 
                '3M': 90, '6M': 180, '1Y': 365, '2Y': 730, '3Y': 1095, '5Y': 1825, '10Y': 3650 
            };
            const d = new Date();
            d.setDate(d.getDate() - (daysMap[selectedDuration] || 365));
            startDate = d.toISOString().split('T')[0];
            endDate = new Date().toISOString().split('T')[0];
        }

        const sim = await StrategyEngine.runSimulation(runConfig, symbols, startDate, endDate);
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
    
    let stratStart = 0;
    let bmStart = 0;
    for (let i = 0; i < Math.min(slice.length, 10); i++) {
        if (slice[i].value > 1 && slice[i].benchmarkValue > 1) {
            stratStart = slice[i].value;
            bmStart = slice[i].benchmarkValue;
            break;
        }
    }
    if (!stratStart) stratStart = slice[0].value || 1;
    if (!bmStart) bmStart = slice[0].benchmarkValue || 1;

    const normalized = slice.map(p => ({
      ...p,
      value: (p.value / stratStart) * 10000,
      benchmarkValue: (p.benchmarkValue / bmStart) * 10000
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

       <div className="flex flex-col xl:flex-row justify-between items-end gap-4">
            <div className="w-full xl:w-auto">
                <h2 className="text-2xl font-bold text-white tracking-tight">Backtesting Engine</h2>
                <p className="text-slate-400 text-sm">Quant analysis with robust error-filtering for historical data.</p>
            </div>
            <div className="flex flex-wrap gap-3 items-end bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-2xl w-full xl:w-auto">
                <Select 
                    label="Strategy"
                    value={selectedStrategyId} 
                    onChange={e => setSelectedStrategyId(e.target.value)} 
                    options={strategies.map(s => ({ value: s.id, label: s.name }))} 
                    className="w-full sm:w-56" 
                />
                <Select
                    label="Duration"
                    value={selectedDuration}
                    onChange={e => setSelectedDuration(e.target.value)}
                    options={[
                        { value: '3M', label: '3 Months' },
                        { value: '6M', label: '6 Months' },
                        { value: '1Y', label: '1 Year' },
                        { value: '2Y', label: '2 Years' },
                        { value: '3Y', label: '3 Years' },
                        { value: '5Y', label: '5 Years' },
                        { value: '10Y', label: '10 Years' },
                        { value: 'Max', label: 'Max History' },
                        { value: 'Custom', label: 'Custom Range' }
                    ]}
                    className="w-full sm:w-36"
                />
                
                {selectedDuration === 'Custom' && (
                    <>
                        <Input type="date" label="From" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} className="w-full sm:w-36" />
                        <Input type="date" label="To" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} className="w-full sm:w-36" />
                    </>
                )}

                <div className="flex flex-col gap-1">
                    <label className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase cursor-pointer select-none px-1">
                        <input 
                            type="checkbox" 
                            checked={onlyTradeOnSignalChange} 
                            onChange={e => setOnlyTradeOnSignalChange(e.target.checked)}
                            className="w-3 h-3 rounded bg-slate-950 border-slate-700 text-emerald-500"
                        />
                        Signal-Only Trading
                    </label>
                    <Button onClick={runBacktest} disabled={isRunning} className="h-10 px-6 w-full sm:w-auto text-sm">
                        {isRunning ? 'Simulating...' : 'Run Analysis'}
                    </Button>
                </div>
            </div>
       </div>

       {errorMessage && <Card className="border-red-500/50 bg-red-950/20 text-red-200">{errorMessage}</Card>}

       {result && currentStats && (
           <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
               <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card className="bg-slate-900/60 border-slate-800">
                        <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Total Window Return</div>
                        <div className={`text-2xl font-mono ${currentStats.strategy.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {currentStats.strategy.totalReturn.toFixed(1)}%
                        </div>
                    </Card>
                    <Card className="bg-slate-900/60 border-slate-800">
                        <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Window Ann. CAGR</div>
                        <div className="text-2xl font-mono text-white">{currentStats.strategy.cagr.toFixed(1)}%</div>
                    </Card>
                    <Card className="bg-slate-900/60 border-slate-800">
                        <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Max Window Drawdown</div>
                        <div className="text-2xl font-mono text-red-400">-{currentStats.strategy.maxDD.toFixed(1)}%</div>
                    </Card>
                    <Card className="bg-slate-900/60 border-slate-800">
                        <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Sharpe Ratio</div>
                        <div className="text-2xl font-mono text-indigo-400">{currentStats.strategy.sharpe.toFixed(2)}</div>
                    </Card>
               </div>

               <div className="flex flex-col xl:flex-row justify-between items-center gap-6">
                    <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 w-full xl:w-fit shadow-lg shadow-black/20">
                        {['Chart', 'Trades', 'Compare'].map(t => (
                            <button key={t} onClick={() => setActiveTab(t as any)} className={`flex-1 xl:flex-none px-8 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === t ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>{t}</button>
                        ))}
                    </div>

                    <div className="flex-1 w-full bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-3">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            <span>Slicer Start: <span className="text-white font-mono">{filteredSeries[0]?.date}</span></span>
                            <span>Slicer End: <span className="text-white font-mono">{filteredSeries[filteredSeries.length-1]?.date}</span></span>
                        </div>
                        <div className="relative h-6 flex items-center px-2">
                            <input type="range" min={0} max={result.navSeries.length - 1} value={range[0]} onChange={e => setRange([Math.min(parseInt(e.target.value), range[1]-1), range[1]])} className="dual-range-input absolute left-2 right-2 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" style={{ pointerEvents: 'auto', zIndex: 40 }} />
                            <input type="range" min={0} max={result.navSeries.length - 1} value={range[1]} onChange={e => setRange([range[0], Math.max(parseInt(e.target.value), range[0]+1)])} className="dual-range-input absolute left-2 right-2 h-1.5 bg-transparent rounded-lg appearance-none cursor-pointer accent-indigo-500" style={{ pointerEvents: 'auto', zIndex: 40 }} />
                        </div>
                        <div className="text-[9px] text-center text-slate-600 font-mono italic uppercase tracking-tighter">Adjust handles to re-baseline chart to 10k at chosen start date.</div>
                    </div>
               </div>

               {activeTab === 'Chart' && (
                   <div className="space-y-6">
                       <Card className="h-[450px] flex flex-col p-8 bg-slate-900/40 border-slate-800 shadow-xl">
                            <div className="flex justify-between items-center mb-8">
                                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-widest">Growth Comparison (Indexed @ 10,000)</h3>
                                <div className="text-[10px] text-slate-500 uppercase font-mono tracking-tighter">Window Points: {filteredSeries.length}</div>
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

                       <Card className="h-[250px] flex flex-col p-8 bg-slate-900/40 border-slate-800 shadow-xl">
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
                   <div className="space-y-6 animate-in fade-in duration-300">
                       <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                           <Card className="p-0 overflow-hidden border-slate-800 bg-slate-900/40 shadow-xl">
                               <div className="p-4 bg-slate-800/50 border-b border-slate-700 font-bold text-xs uppercase tracking-widest text-slate-200">Window Performance Matrix</div>
                               <table className="w-full text-left text-xs font-mono">
                                   <thead className="bg-slate-900/50 text-slate-400">
                                       <tr><th className="px-6 py-3">Year</th><th className="px-6 py-3 text-emerald-400">Strat</th><th className="px-6 py-3 text-slate-200">Bench</th><th className="px-6 py-3">Alpha</th></tr>
                                   </thead>
                                   <tbody className="divide-y divide-slate-800">
                                       {currentStats.yearlyReturns.map(yr => (
                                           <tr key={yr.year} className="hover:bg-slate-800/30">
                                               <td className="px-6 py-4 font-bold text-slate-300">{yr.year}</td>
                                               <td className={`px-6 py-4 font-bold ${yr.strat >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{yr.strat.toFixed(2)}%</td>
                                               <td className={`px-6 py-4 font-bold ${yr.bench >= 0 ? 'text-slate-200' : 'text-red-500'}`}>{yr.bench.toFixed(2)}%</td>
                                               <td className={`px-6 py-4 font-bold ${yr.strat - yr.bench >= 0 ? 'text-indigo-400' : 'text-amber-600'}`}>{(yr.strat - yr.bench).toFixed(2)}%</td>
                                           </tr>
                                       ))}
                                   </tbody>
                               </table>
                           </Card>

                           <Card className="p-0 overflow-hidden border-slate-800 bg-slate-900/40 shadow-xl">
                               <div className="p-4 bg-slate-800/50 border-b border-slate-700 font-bold text-xs uppercase tracking-widest text-slate-200">Tenor Variance Summary</div>
                               <table className="w-full text-left text-xs font-mono">
                                   <thead className="bg-slate-900/50 text-slate-400">
                                       <tr>
                                           <th className="px-6 py-3">Tenor</th>
                                           <th className="px-6 py-3 text-emerald-400">Strategy</th>
                                           <th className="px-6 py-3 text-slate-200">Benchmark</th>
                                           <th className="px-6 py-3">Alpha</th>
                                       </tr>
                                   </thead>
                                   <tbody className="divide-y divide-slate-800">
                                       {currentStats.tenors.map(t => (
                                           <tr key={t.label} className="hover:bg-slate-800/30">
                                               <td className="px-6 py-4 font-bold text-slate-300">{t.label}</td>
                                               <td className="px-6 py-4 text-emerald-400 font-bold">{t.stats.strat.toFixed(2)}%</td>
                                               <td className="px-6 py-4 text-slate-400">{t.stats.bench.toFixed(2)}%</td>
                                               <td className={`px-6 py-4 font-bold ${t.stats.alpha >= 0 ? 'text-indigo-400' : 'text-amber-600'}`}>
                                                   {t.stats.alpha >= 0 ? '+' : ''}{t.stats.alpha.toFixed(2)}%
                                               </td>
                                           </tr>
                                       ))}
                                   </tbody>
                               </table>
                           </Card>
                       </div>

                       <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <Card className="p-0 overflow-hidden border-slate-800 bg-slate-900/40 shadow-xl">
                                <div className="p-4 bg-slate-800/50 border-b border-slate-700 font-bold text-xs uppercase tracking-widest text-slate-200">Rolling CAGR Comparison (Sanitized)</div>
                                <table className="w-full text-left text-xs font-mono">
                                    <thead className="bg-slate-900/50 text-slate-400">
                                        <tr><th className="px-6 py-3">Period</th><th className="px-6 py-3 text-emerald-400">Strategy (Min/Avg/Max)</th><th className="px-6 py-3 text-slate-200">Benchmark (Min/Avg/Max)</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800">
                                        {currentStats.rolling.map(r => (
                                            <tr key={r.tenor} className="hover:bg-slate-800/30">
                                                <td className="px-6 py-4 font-bold text-slate-300">{r.tenor}</td>
                                                <td className="px-6 py-4"><span className="text-red-400 text-[10px]">{r.strat.min.toFixed(1)}</span> <span className="text-emerald-400 font-bold mx-1">{r.strat.mean.toFixed(1)}%</span> <span className="text-blue-400 text-[10px]">{r.strat.max.toFixed(1)}</span></td>
                                                <td className="px-6 py-4"><span className="text-red-500 text-[10px]">{r.bench.min.toFixed(1)}</span> <span className="text-slate-200 font-bold mx-1">{r.bench.mean.toFixed(1)}%</span> <span className="text-indigo-400 text-[10px]">{r.bench.max.toFixed(1)}</span></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </Card>
                            <Card className="p-0 overflow-hidden border-slate-800 bg-slate-900/40 shadow-xl">
                                <div className="p-4 bg-slate-800/50 border-b border-slate-700 font-bold text-xs uppercase tracking-widest text-slate-200">Window Risk Profile</div>
                                <table className="w-full text-left text-xs font-mono">
                                    <thead className="bg-slate-900/50 text-slate-400">
                                        <tr><th className="px-6 py-3">Metric</th><th className="px-6 py-3 text-emerald-400">Strategy</th><th className="px-6 py-3 text-slate-200">Benchmark</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800">
                                        <tr><td className="px-6 py-4 text-slate-400">Ann. Volatility</td><td className="px-6 py-4 text-indigo-400 font-bold">{currentStats.strategy.volatility.toFixed(2)}%</td><td className="px-6 py-4 text-slate-200 font-bold">{currentStats.benchmark.volatility.toFixed(2)}%</td></tr>
                                        <tr><td className="px-6 py-4 text-slate-400">Sharpe Ratio</td><td className="px-6 py-4 text-indigo-400 font-bold">{currentStats.strategy.sharpe.toFixed(2)}</td><td className="px-6 py-4 text-slate-200 font-bold">{currentStats.benchmark.sharpe.toFixed(2)}</td></tr>
                                        <tr><td className="px-6 py-4 text-slate-400">Max Drawdown</td><td className="px-6 py-4 text-red-400 font-bold">-{currentStats.strategy.maxDD.toFixed(1)}%</td><td className="px-6 py-4 text-slate-200 font-bold">-{currentStats.benchmark.maxDD.toFixed(1)}%</td></tr>
                                    </tbody>
                                </table>
                            </Card>
                       </div>
                   </div>
               )}

               {activeTab === 'Trades' && detailedResult && (
                   <Card className="p-0 overflow-hidden border-slate-800 shadow-2xl bg-slate-900/40">
                       <div className="overflow-x-auto">
                           <table className="w-full text-left text-xs font-mono">
                               <thead className="bg-slate-800 text-slate-400 uppercase font-bold sticky top-0">
                                   <tr><th className="px-6 py-4">Date</th><th className="px-6 py-4">Ticker</th><th className="px-6 py-4 text-center">Action</th><th className="px-6 py-4 text-right">Shares</th><th className="px-6 py-4 text-right">Price</th><th className="px-6 py-4 text-right">Notional</th></tr>
                               </thead>
                               <tbody className="divide-y divide-slate-800">
                                   {detailedResult.trades
                                    .filter(t => t.date >= filteredSeries[0].date && t.date <= filteredSeries[filteredSeries.length-1].date)
                                    .slice().reverse().map((t, idx) => (
                                       <tr key={idx} className="hover:bg-slate-800/40 transition-colors group">
                                           <td className="px-6 py-4 text-slate-400">{t.date}</td>
                                           <td className="px-6 py-4 text-emerald-400 font-bold">{t.ticker}</td>
                                           <td className="px-6 py-4 text-center"><span className={`px-2 py-0.5 rounded font-bold text-[10px] ${t.type === 'BUY' ? 'bg-emerald-900/30 text-emerald-500' : 'bg-red-900/30 text-red-500'}`}>{t.type}</span></td>
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

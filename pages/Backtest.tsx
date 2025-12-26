
import React, { useState, useEffect, useMemo } from 'react';
import { Card, Button, Select } from '../components/ui';
import { StorageService } from '../services/storage';
import { Strategy, BacktestResult, SymbolData } from '../types';
import { StrategyEngine, SimResultPoint, SimTrade } from '../services/strategyEngine';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area
} from 'recharts';

interface ComparisonStats {
  strategy: { totalReturn: number; cagr: number; maxDD: number; volatility: number; sharpe: number; };
  benchmark: { totalReturn: number; cagr: number; maxDD: number; volatility: number; sharpe: number; };
}

interface RollingStats {
    min: number;
    max: number;
    mean: number;
}

interface RollingReturnItem {
    tenor: string;
    strategy: RollingStats;
    benchmark: RollingStats;
}

interface TenorComparison {
    label: string;
    strategy: number | null;
    benchmark: number | null;
}

interface YearlyStat {
    year: number;
    switches: number;
    buys: number;
    sells: number;
}

const STANDARD_TENORS = ['3M', '6M', '1Y', '2Y', '3Y', '4Y', '5Y', '10Y', 'Max'];

export const BacktestEngine = () => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [symbols, setSymbols] = useState<SymbolData[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>('');
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [detailedResult, setDetailedResult] = useState<{ trades: SimTrade[], regimeSwitches: any[] } | null>(null);
  const [compStats, setCompStats] = useState<ComparisonStats | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  
  const [rangeMode, setRangeMode] = useState<'Standard' | 'Custom'>('Standard');
  const [selectedStandardTenor, setSelectedStandardTenor] = useState<string>('1Y');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    const s = StorageService.getStrategies();
    const syms = StorageService.getSymbols();
    setStrategies(s);
    setSymbols(syms);
    if(s.length > 0 && !selectedStrategyId) setSelectedStrategyId(s[0].id);
  };

  const calculateCAGR = (startVal: number, endVal: number, days: number): number => {
      if (days <= 0 || startVal <= 0) return 0;
      const years = days / 252;
      return (Math.pow(endVal / startVal, 1 / years) - 1) * 100;
  };

  const calculateStats = (sim: SimResultPoint[]): ComparisonStats => {
    const calc = (series: number[]) => {
      if (series.length < 2) return { totalReturn: 0, cagr: 0, maxDD: 0, volatility: 0, sharpe: 0 };
      const returns = [];
      for (let i = 1; i < series.length; i++) {
          const r = (series[i] / (series[i - 1] || 1)) - 1;
          if (isFinite(r) && r > -0.9 && r < 3) returns.push(r);
      }
      
      const first = series[0];
      const last = series[series.length - 1];
      const totalReturn = ((last - first) / (first || 1)) * 100;
      const years = series.length / 252;
      const cagr = (Math.pow(last / (first || 1), 1 / (years || 1)) - 1) * 100;
      
      const mean = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
      const variance = returns.length > 1 ? returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1) : 0;
      const vol = Math.sqrt(variance * 252) * 100;
      
      let peak = -Infinity, mdd = 0;
      series.forEach(v => { if (v > peak) peak = v; const dd = (peak - v) / (peak || 1); if (dd > mdd) mdd = dd; });
      
      return { 
          totalReturn: Number(totalReturn.toFixed(2)), 
          cagr: Number(cagr.toFixed(2)), 
          maxDD: Number((mdd * 100).toFixed(2)), 
          volatility: Number(vol.toFixed(2)), 
          sharpe: Number((vol > 0 ? cagr / vol : 0).toFixed(2)) 
      };
    };
    return { strategy: calc(sim.map(p => p.value)), benchmark: calc(sim.map(p => p.benchmarkValue)) };
  };

  const tenorComparisons = useMemo((): TenorComparison[] => {
      if (!result) return [];
      const series = result.navSeries;
      const tenors = [
          { label: '1 Year', days: 252 },
          { label: '3 Year', days: 756 },
          { label: '5 Year', days: 1260 },
          { label: 'Selected Period', days: series.length }
      ];

      return tenors.map(t => {
          if (series.length < t.days && t.label !== 'Selected Period') return { label: t.label, strategy: null, benchmark: null };
          
          const window = Math.min(t.days, series.length);
          const startIdx = series.length - window;
          const endIdx = series.length - 1;
          
          const sCAGR = calculateCAGR(series[startIdx].value, series[endIdx].value, window);
          const bCAGR = calculateCAGR(series[startIdx].benchmarkValue, series[endIdx].benchmarkValue, window);
          
          return { label: t.label, strategy: sCAGR, benchmark: bCAGR };
      });
  }, [result]);

  const rollingReturns = useMemo((): RollingReturnItem[] => {
      if (!result) return [];
      const series = result.navSeries;

      const getRollingStats = (window: number) => {
          if (series.length < window + 1) return null;
          
          const sReturns: number[] = [];
          const bReturns: number[] = [];
          
          for (let i = window; i < series.length; i++) {
              const sRet = (series[i].value / (series[i - window].value || 1)) - 1;
              const bRet = (series[i].benchmarkValue / (series[i - window].benchmarkValue || 1)) - 1;
              
              if (isFinite(sRet) && isFinite(bRet)) {
                  sReturns.push(sRet);
                  bReturns.push(bRet);
              }
          }

          if (sReturns.length === 0) return null;

          const years = window / 252;
          const toCAGR = (val: number) => (Math.pow(1 + val, 1 / years) - 1) * 100;

          const calc = (rets: number[]): RollingStats => {
              const min = Math.min(...rets);
              const max = Math.max(...rets);
              const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
              return {
                  min: toCAGR(min),
                  max: toCAGR(max),
                  mean: toCAGR(mean)
              };
          };

          return {
              strategy: calc(sReturns),
              benchmark: calc(bReturns)
          };
      };

      return [
          { tenor: '3M', window: 63 },
          { tenor: '6M', window: 126 },
          { tenor: '1Y', window: 252 },
          { tenor: '2Y', window: 504 },
          { tenor: '3Y', window: 756 }
      ].map(t => {
          const stats = getRollingStats(t.window);
          return stats ? { tenor: t.tenor, ...stats } : null;
      }).filter(x => x !== null) as RollingReturnItem[];
  }, [result]);

  const yearlyStats = useMemo((): YearlyStat[] => {
      if (!result || !detailedResult) return [];
      const statsMap: Record<number, YearlyStat> = {};
      
      result.navSeries.forEach(p => {
          const year = new Date(p.date).getFullYear();
          if (!statsMap[year]) statsMap[year] = { year, switches: 0, buys: 0, sells: 0 };
      });

      detailedResult.regimeSwitches.forEach(s => {
          const year = new Date(s.date).getFullYear();
          if (statsMap[year]) statsMap[year].switches++;
      });

      detailedResult.trades.forEach(t => {
          const year = new Date(t.date).getFullYear();
          if (statsMap[year]) {
              if (t.type === 'BUY') statsMap[year].buys++;
              else statsMap[year].sells++;
          }
      });

      return Object.values(statsMap).sort((a, b) => a.year - b.year);
  }, [result, detailedResult]);

  const runBacktest = async () => {
    setIsRunning(true);
    setErrorMessage('');
    setResult(null);
    try {
        const strat = strategies.find(s => s.id === selectedStrategyId);
        if (!strat) throw new Error("Select a strategy");

        let startD: string | undefined;
        if (rangeMode === 'Standard' && selectedStandardTenor !== 'Max') {
            const daysMap: any = { '3M': 90, '6M': 180, '1Y': 365, '2Y': 730, '3Y': 1095, '4Y': 1460, '5Y': 1825, '10Y': 3650 };
            const date = new Date();
            date.setDate(date.getDate() - (daysMap[selectedStandardTenor] || 365));
            startD = date.toISOString().split('T')[0];
        } else if (rangeMode === 'Custom') {
            startD = customStart;
        }

        const sim = await StrategyEngine.runSimulation(strat, symbols, startD, rangeMode === 'Custom' ? customEnd : undefined);
        const stats = calculateStats(sim.series);
        setCompStats(stats);
        setDetailedResult({ trades: sim.trades, regimeSwitches: sim.regimeSwitches });
        
        const finalRes: BacktestResult = {
            strategyId: strat.id,
            runDate: new Date().toISOString(),
            stats: { cagr: stats.strategy.cagr, maxDrawdown: stats.strategy.maxDD, sharpeRatio: stats.strategy.sharpe, totalReturn: stats.strategy.totalReturn, winRate: 0 },
            navSeries: sim.series,
            allocations: [],
            transactions: [],
            latestAllocation: { date: sim.series[sim.series.length-1].date, riskOn: sim.series[sim.series.length-1].riskOn, riskOff: sim.series[sim.series.length-1].riskOff }
        };
        setResult(finalRes);
        StorageService.saveBacktestResult(finalRes);
    } catch (e: any) {
        setErrorMessage(e.message);
    } finally {
        setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
       <div className="flex justify-between items-end flex-wrap gap-4">
            <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">Backtesting Engine</h2>
                <p className="text-slate-400 font-medium italic">Advanced performance analytics with Min/Mean/Max rolling returns.</p>
            </div>
            <div className="flex gap-4 items-end bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-2xl">
                <Select label="Strategy" value={selectedStrategyId} onChange={(e) => setSelectedStrategyId(e.target.value)} options={strategies.map(s => ({ value: s.id, label: s.name }))} className="w-64" />
                <div className="flex flex-col gap-1.5 min-w-[120px]">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Range Mode</label>
                    <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                        <button onClick={() => setRangeMode('Standard')} className={`flex-1 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all ${rangeMode === 'Standard' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>Std</button>
                        <button onClick={() => setRangeMode('Custom')} className={`flex-1 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all ${rangeMode === 'Custom' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>Custom</button>
                    </div>
                </div>

                {rangeMode === 'Standard' ? (
                    <div className="w-24"><Select label="Tenor" value={selectedStandardTenor} onChange={e => setSelectedStandardTenor(e.target.value)} options={STANDARD_TENORS.map(t => ({ value: t, label: t }))} /></div>
                ) : (
                    <div className="flex gap-2">
                        <div className="w-32"><label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Start</label><input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500" /></div>
                        <div className="w-32"><label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">End</label><input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500" /></div>
                    </div>
                )}
                <Button onClick={runBacktest} disabled={isRunning || !selectedStrategyId} className="h-10 px-6 font-bold">{isRunning ? '...' : 'RUN'}</Button>
            </div>
       </div>

       {errorMessage && <div className="p-4 bg-red-900/20 border border-red-500/50 rounded-lg text-red-200 shadow-xl">Error: {errorMessage}</div>}

       {result && compStats && (
           <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
               <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                   <Card className="lg:col-span-1 space-y-6">
                        <div className="space-y-6">
                          <h3 className="font-bold text-slate-200 border-b border-slate-800 pb-2 uppercase text-xs tracking-widest">Performance</h3>
                          <div className="space-y-4">
                              <div><div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Strategy Return</div><div className={`text-3xl font-mono font-bold ${result.stats.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{result.stats.totalReturn}%</div></div>
                              <div className="grid grid-cols-2 gap-4">
                                  <div><div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">CAGR</div><div className="text-lg font-mono text-slate-200">{result.stats.cagr}%</div></div>
                                  <div><div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Max DD</div><div className="text-lg font-mono text-red-400">-{result.stats.maxDrawdown}%</div></div>
                              </div>
                          </div>
                        </div>
                        {result.latestAllocation && (
                            <div className="pt-6 border-t border-slate-800 space-y-4">
                                <h4 className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Current Signal</h4>
                                <div className="flex gap-1 h-2.5 rounded-full overflow-hidden bg-slate-800">
                                    <div className="bg-emerald-500 h-full" style={{ width: `${result.latestAllocation.riskOn}%` }}></div>
                                    <div className="bg-slate-600 h-full" style={{ width: `${result.latestAllocation.riskOff}%` }}></div>
                                </div>
                                <div className="flex justify-between text-[10px] font-mono uppercase font-bold">
                                    <span className="text-emerald-400">On: {result.latestAllocation.riskOn.toFixed(0)}%</span>
                                    <span className="text-slate-500">Off: {result.latestAllocation.riskOff.toFixed(0)}%</span>
                                </div>
                            </div>
                        )}
                   </Card>
                   <div className="lg:col-span-3 h-full">
                       <Card className="p-0 overflow-hidden flex flex-col h-full min-h-[400px]">
                           <div className="px-6 py-4 flex justify-between items-center bg-slate-900/50 border-b border-slate-800">
                                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-widest">Equity Curve</h3>
                                <div className="flex gap-4">
                                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500"></span><span className="text-[9px] text-slate-400 uppercase font-bold">Strategy</span></div>
                                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-slate-600"></span><span className="text-[9px] text-slate-400 uppercase font-bold">Benchmark</span></div>
                                </div>
                           </div>
                           <div className="flex-1 w-full p-4">
                               <ResponsiveContainer width="100%" height="100%">
                                   <LineChart data={result.navSeries}>
                                       <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                       <XAxis dataKey="date" tick={{fontSize: 9}} minTickGap={50} stroke="#475569" />
                                       <YAxis tick={{fontSize: 9}} stroke="#475569" domain={['auto', 'auto']} />
                                       <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }} />
                                       <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                                       <Line type="monotone" dataKey="benchmarkValue" stroke="#475569" strokeWidth={1.5} dot={false} strokeDasharray="5 5" isAnimationActive={false} />
                                   </LineChart>
                               </ResponsiveContainer>
                           </div>
                       </Card>
                   </div>
               </div>

               {/* Rolling Return Stats Table */}
               <Card className="p-0 overflow-hidden">
                   <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
                       <h3 className="text-xs font-bold text-slate-200 uppercase tracking-widest">Rolling Returns Analysis (CAGR)</h3>
                       <span className="text-[9px] text-slate-500 font-mono">ANNUALIZED MIN / MEAN / MAX</span>
                   </div>
                   <table className="w-full text-xs text-left">
                       <thead className="bg-slate-900/50 text-slate-500 uppercase font-bold tracking-widest border-b border-slate-800">
                           <tr>
                               <th className="px-6 py-4 font-bold">Tenor</th>
                               <th className="px-6 py-4 font-bold text-emerald-400 border-l border-slate-800/50">Strategy (Min/Mean/Max)</th>
                               <th className="px-6 py-4 font-bold border-l border-slate-800/50">Benchmark (Min/Mean/Max)</th>
                           </tr>
                       </thead>
                       <tbody className="divide-y divide-slate-800/50">
                           {rollingReturns.map(item => (
                               <tr key={item.tenor} className="hover:bg-slate-900/30">
                                   <td className="px-6 py-4 text-slate-400 font-bold">{item.tenor} Window</td>
                                   <td className="px-6 py-4 border-l border-slate-800/50">
                                       <div className="flex justify-between font-mono">
                                           <span className="text-red-400/80">{item.strategy.min.toFixed(1)}%</span>
                                           <span className="text-emerald-400 font-bold">{item.strategy.mean.toFixed(1)}%</span>
                                           <span className="text-emerald-300/80">{item.strategy.max.toFixed(1)}%</span>
                                       </div>
                                   </td>
                                   <td className="px-6 py-4 border-l border-slate-800/50">
                                       <div className="flex justify-between font-mono text-slate-500">
                                           <span className="text-red-900/80">{item.benchmark.min.toFixed(1)}%</span>
                                           <span className="text-slate-200">{item.benchmark.mean.toFixed(1)}%</span>
                                           <span className="text-slate-400/80">{item.benchmark.max.toFixed(1)}%</span>
                                       </div>
                                   </td>
                               </tr>
                           ))}
                           {rollingReturns.length === 0 && (
                               <tr><td colSpan={3} className="px-6 py-12 text-center text-slate-600 italic">Insufficient data for rolling analysis. Requires at least 3 months of data.</td></tr>
                           )}
                       </tbody>
                   </table>
               </Card>

               <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                   {/* CAGR Comparison Table */}
                   <Card className="p-0 overflow-hidden">
                       <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
                           <h3 className="text-xs font-bold text-slate-200 uppercase tracking-widest">CAGR Comparison (Tenors)</h3>
                           <span className="text-[9px] text-slate-500 font-mono">ANNUALIZED RETURNS %</span>
                       </div>
                       <table className="w-full text-xs text-left">
                           <thead className="bg-slate-900/50 text-slate-500 uppercase font-bold tracking-widest border-b border-slate-800">
                               <tr>
                                   <th className="px-6 py-4 font-bold">Tenor</th>
                                   <th className="px-6 py-4 font-bold text-emerald-400">Strategy</th>
                                   <th className="px-6 py-4 font-bold">Benchmark</th>
                               </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-800/50">
                               {tenorComparisons.map(t => (
                                   <tr key={t.label} className="hover:bg-slate-900/30">
                                       <td className="px-6 py-4 text-slate-400">{t.label} CAGR</td>
                                       <td className="px-6 py-4 font-mono font-bold text-emerald-400">{t.strategy !== null ? `${t.strategy.toFixed(2)}%` : 'N/A'}</td>
                                       <td className="px-6 py-4 font-mono text-slate-200">{t.benchmark !== null ? `${t.benchmark.toFixed(2)}%` : 'N/A'}</td>
                                   </tr>
                               ))}
                           </tbody>
                       </table>
                   </Card>

                   {/* Yearly Activity Table */}
                   <Card className="p-0 overflow-hidden">
                       <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
                           <h3 className="text-xs font-bold text-slate-200 uppercase tracking-widest">Yearly Activity Analysis</h3>
                           <div className="text-[10px] text-slate-500 font-mono font-bold uppercase">
                               {yearlyStats.reduce((a, b) => a + b.switches, 0)} Switches • {yearlyStats.reduce((a, b) => a + (b.buys + b.sells), 0)} Trades
                           </div>
                       </div>
                       <table className="w-full text-xs text-left">
                           <thead className="bg-slate-900/50 text-slate-500 uppercase font-bold tracking-widest border-b border-slate-800">
                               <tr>
                                   <th className="px-6 py-4 font-bold">Year</th>
                                   <th className="px-6 py-4 font-bold text-center">Switches</th>
                                   <th className="px-6 py-4 font-bold text-center text-emerald-400">Buys</th>
                                   <th className="px-6 py-4 font-bold text-center text-red-400">Sells</th>
                                   <th className="px-6 py-4 font-bold text-right">Total</th>
                               </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-800/50">
                               {yearlyStats.map(stat => (
                                   <tr key={stat.year} className="hover:bg-slate-900/30">
                                       <td className="px-6 py-4 font-bold text-slate-200">{stat.year}</td>
                                       <td className="px-6 py-4 text-center font-mono text-slate-400">{stat.switches}</td>
                                       <td className="px-6 py-4 text-center font-mono text-emerald-400">{stat.buys}</td>
                                       <td className="px-6 py-4 text-center font-mono text-red-400">{stat.sells}</td>
                                       <td className="px-6 py-4 text-right font-mono text-slate-200 font-bold">{stat.buys + stat.sells}</td>
                                   </tr>
                               ))}
                               <tr className="bg-slate-900/60 font-bold border-t-2 border-slate-700">
                                   <td className="px-6 py-4 text-white">TOTAL</td>
                                   <td className="px-6 py-4 text-center font-mono text-white">{yearlyStats.reduce((a, b) => a + b.switches, 0)}</td>
                                   <td className="px-6 py-4 text-center font-mono text-emerald-400">{yearlyStats.reduce((a, b) => a + b.buys, 0)}</td>
                                   <td className="px-6 py-4 text-center font-mono text-red-400">{yearlyStats.reduce((a, b) => a + b.sells, 0)}</td>
                                   <td className="px-6 py-4 text-right font-mono text-slate-200">{yearlyStats.reduce((a, b) => a + b.buys + b.sells, 0)}</td>
                               </tr>
                           </tbody>
                       </table>
                   </Card>
               </div>

               <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                   {/* Risk Metrics Table */}
                   <Card className="p-0 overflow-hidden">
                       <div className="px-6 py-4 bg-slate-900 border-b border-slate-800">
                           <h3 className="text-xs font-bold text-slate-200 uppercase tracking-widest">Risk Metrics Comparison</h3>
                       </div>
                       <table className="w-full text-xs text-left">
                           <thead className="bg-slate-900/50 text-slate-500 uppercase font-bold tracking-widest border-b border-slate-800">
                               <tr>
                                   <th className="px-6 py-4 font-bold">Metrics</th>
                                   <th className="px-6 py-4 font-bold text-emerald-400">Strategy</th>
                                   <th className="px-6 py-4 font-bold">Benchmark</th>
                               </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-800/50">
                               <tr><td className="px-6 py-4 text-slate-400">Ann. Volatility</td><td className="px-6 py-4 font-mono font-bold text-slate-200">{compStats.strategy.volatility}%</td><td className="px-6 py-4 font-mono">{compStats.benchmark.volatility}%</td></tr>
                               <tr><td className="px-6 py-4 text-slate-400">Sharpe Ratio</td><td className="px-6 py-4 font-mono font-bold text-indigo-400">{compStats.strategy.sharpe}</td><td className="px-6 py-4 font-mono">{compStats.benchmark.sharpe}</td></tr>
                               <tr><td className="px-6 py-4 text-slate-400">Max Drawdown</td><td className="px-6 py-4 font-mono font-bold text-red-400">-{compStats.strategy.maxDD}%</td><td className="px-6 py-4 font-mono text-red-500">-{compStats.benchmark.maxDD}%</td></tr>
                           </tbody>
                       </table>
                   </Card>

                   {/* Regime Exposure Area Chart */}
                   <Card className="p-0 overflow-hidden">
                        <div className="px-6 py-3 bg-slate-900 border-b border-slate-800 flex justify-between">
                            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Regime Exposure Over Time</h3>
                            <div className="text-[9px] text-slate-600 font-mono">ON: GREEN | OFF: GREY</div>
                        </div>
                        <div className="h-48 w-full p-2">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={result.navSeries}>
                                    <Area type="monotone" dataKey="riskOn" stackId="1" stroke="#065f46" fill="#10b981" fillOpacity={0.6} isAnimationActive={false} />
                                    <Area type="monotone" dataKey="riskOff" stackId="1" stroke="#334155" fill="#475569" fillOpacity={0.6} isAnimationActive={false} />
                                    <XAxis dataKey="date" hide />
                                    <YAxis hide domain={[0, 100]} />
                                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </Card>
               </div>
           </div>
       )}
    </div>
  );
};

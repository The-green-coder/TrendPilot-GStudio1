import React, { useEffect, useState } from 'react';
import { Card, Button } from '../components/ui';
import { StorageService } from '../services/storage';
import { Strategy, BacktestResult, SymbolData } from '../types';
import { Link } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

export const Dashboard = () => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [symbols, setSymbols] = useState<SymbolData[]>([]);
  const [lastResult, setLastResult] = useState<BacktestResult | null>(null);
  const [dbStatus, setDbStatus] = useState({ symbols: 0, strategies: 0, results: 0 });

  useEffect(() => {
    const s = StorageService.getStrategies();
    const sym = StorageService.getSymbols();
    const results = StorageService.getBacktestResults();

    setStrategies(s);
    setSymbols(sym);
    setDbStatus({
        symbols: sym.length,
        strategies: s.length,
        results: results.length
    });

    if (results.length > 0) {
        setLastResult(results[results.length - 1]);
    }
  }, []);

  return (
    <div className="space-y-8">
      <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">System Dashboard</h2>
          <p className="text-slate-400 mt-2">Overview of strategies, assets, and performance.</p>
      </div>

      {/* System Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="flex items-center justify-between border-l-4 border-l-emerald-500">
              <div>
                  <div className="text-slate-400 text-sm uppercase font-semibold">Strategies Defined</div>
                  <div className="text-3xl font-bold text-white mt-1">{dbStatus.strategies}</div>
              </div>
              <div className="bg-emerald-900/20 p-3 rounded-full text-emerald-400">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
              </div>
          </Card>
          <Card className="flex items-center justify-between border-l-4 border-l-indigo-500">
              <div>
                  <div className="text-slate-400 text-sm uppercase font-semibold">Universe Size</div>
                  <div className="text-3xl font-bold text-white mt-1">{dbStatus.symbols}</div>
              </div>
              <div className="bg-indigo-900/20 p-3 rounded-full text-indigo-400">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
          </Card>
          <Card className="flex items-center justify-between border-l-4 border-l-blue-500">
              <div>
                  <div className="text-slate-400 text-sm uppercase font-semibold">Backtests Run</div>
                  <div className="text-3xl font-bold text-white mt-1">{dbStatus.results}</div>
              </div>
              <div className="bg-blue-900/20 p-3 rounded-full text-blue-400">
                 <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
              </div>
          </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Quick Actions */}
          <div className="space-y-6">
              <h3 className="text-xl font-semibold text-slate-200">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-4">
                  <Link to="/strategies" className="block">
                    <Card className="hover:bg-slate-800 transition-colors h-full flex flex-col items-center justify-center p-8 gap-4 text-center cursor-pointer border-dashed border-2 border-slate-700">
                        <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400">
                            <span className="text-2xl">+</span>
                        </div>
                        <span className="font-medium">New Strategy</span>
                    </Card>
                  </Link>
                  <Link to="/backtest" className="block">
                    <Card className="hover:bg-slate-800 transition-colors h-full flex flex-col items-center justify-center p-8 gap-4 text-center cursor-pointer border-dashed border-2 border-slate-700">
                         <div className="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center text-blue-400">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                        <span className="font-medium">Run Simulation</span>
                    </Card>
                  </Link>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                  <h3 className="font-semibold text-slate-200 mb-4">Available Strategies</h3>
                  <div className="space-y-3">
                      {strategies.slice(0, 5).map(s => (
                          <div key={s.id} className="flex justify-between items-center p-3 bg-slate-950 rounded border border-slate-800">
                              <span className="text-sm font-medium text-emerald-400">{s.name}</span>
                              <span className="text-xs text-slate-500">{s.rebalanceFreq} • {s.backtestDuration}</span>
                          </div>
                      ))}
                      {strategies.length === 0 && <p className="text-sm text-slate-500">No strategies configured.</p>}
                  </div>
              </div>
          </div>

          {/* Last Run Summary */}
          <div className="space-y-6">
              <h3 className="text-xl font-semibold text-slate-200">Last Backtest Result</h3>
              {lastResult ? (
                  <Card className="space-y-6">
                      <div className="flex justify-between items-start">
                          <div>
                              <div className="text-sm text-slate-500">Strategy ID: {lastResult.strategyId}</div>
                              <div className="text-xs text-slate-600">{new Date(lastResult.runDate).toLocaleString()}</div>
                          </div>
                          <div className={`text-2xl font-mono font-bold ${lastResult.stats.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {lastResult.stats.totalReturn > 0 ? '+' : ''}{lastResult.stats.totalReturn}%
                          </div>
                      </div>

                      <div className="h-48 w-full">
                           <ResponsiveContainer width="100%" height="100%">
                               <LineChart data={lastResult.navSeries}>
                                   <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={false} />
                                   <XAxis dataKey="date" hide />
                                   <Tooltip 
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }}
                                        itemStyle={{ color: '#cbd5e1' }}
                                        labelStyle={{ display: 'none' }}
                                   />
                               </LineChart>
                           </ResponsiveContainer>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-center text-sm">
                          <div className="bg-slate-950 p-2 rounded">
                              <div className="text-slate-500 text-xs">CAGR</div>
                              <div className="text-slate-200 font-mono">{lastResult.stats.cagr}%</div>
                          </div>
                          <div className="bg-slate-950 p-2 rounded">
                              <div className="text-slate-500 text-xs">Drawdown</div>
                              <div className="text-red-400 font-mono">{lastResult.stats.maxDrawdown}%</div>
                          </div>
                          <div className="bg-slate-950 p-2 rounded">
                              <div className="text-slate-500 text-xs">NAV</div>
                              <div className="text-emerald-400 font-mono">{lastResult.navSeries[lastResult.navSeries.length-1].value.toFixed(0)}</div>
                          </div>
                      </div>
                  </Card>
              ) : (
                  <Card className="flex items-center justify-center h-64 text-slate-500 italic">
                      No recent backtest results available.
                  </Card>
              )}
          </div>
      </div>
    </div>
  );
};
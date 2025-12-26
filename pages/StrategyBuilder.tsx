
import React, { useState, useEffect, useMemo } from 'react';
import { Card, Button, Input, Select } from '../components/ui';
import { StorageService } from '../services/storage';
import { SymbolData, Strategy, StrategyComponent, RebalanceFrequency, PriceType, Rule } from '../types';
import { AVAILABLE_RULES } from '../constants';
import { StrategyEngine } from '../services/strategyEngine';

export const StrategyBuilder = () => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [symbols, setSymbols] = useState<SymbolData[]>([]);
  const [view, setView] = useState<'LIST' | 'EDITOR'>('LIST');
  const [isSyncing, setIsSyncing] = useState<string | null>(null);

  const [form, setForm] = useState<Partial<Strategy>>({
    name: '',
    type: 'Single',
    rebalanceFreq: RebalanceFrequency.WEEKLY,
    pricePreference: PriceType.CLOSE,
    initialCapital: 10000,
    transactionCostPct: 0.1,
    slippagePct: 0.1,
    executionDelay: 1,
    backtestDuration: '1Y',
    benchmarkSymbolId: '',
    riskOnComponents: [],
    riskOffComponents: [],
    rules: [],
    onlyTradeOnSignalChange: false
  });

  useEffect(() => {
    loadStrategies();
    const syms = StorageService.getSymbols();
    setSymbols(syms);
    if (syms.length > 0 && !form.benchmarkSymbolId) {
        setForm(prev => ({ ...prev, benchmarkSymbolId: syms[0].id }));
    }
  }, []);

  const loadStrategies = () => {
    setStrategies(StorageService.getStrategies());
  };

  const handleMaterialize = async (strat: Strategy) => {
    setIsSyncing(strat.id);
    try {
        const sim = await StrategyEngine.runSimulation(strat, symbols);
        const mData = sim.series.map(p => ({
            date: p.date,
            open: p.value,
            high: p.value,
            low: p.value,
            close: p.value,
            volume: 0
        }));
        await StorageService.saveMarketData(`STRAT:${strat.id}`, mData);
        alert(`Pricing data generated for ${strat.name}`);
    } catch (e: any) {
        alert("Sync failed: " + e.message);
    } finally {
        setIsSyncing(null);
    }
  };

  const assetOptions = useMemo(() => {
    const opts = symbols.map(s => ({ value: s.id, label: `(SYM) ${s.ticker} - ${s.name}` }));
    const filteredStrats = strategies.filter(s => s.id !== form.id);
    const stratOpts = filteredStrats.map(s => ({ value: `STRAT:${s.id}`, label: `(STRAT) ${s.name}` }));
    return [...opts, ...stratOpts];
  }, [symbols, strategies, form.id]);

  const riskOnSum = useMemo(() => (form.riskOnComponents || []).reduce((a, b) => a + b.allocation, 0), [form.riskOnComponents]);
  const riskOffSum = useMemo(() => (form.riskOffComponents || []).reduce((a, b) => a + b.allocation, 0), [form.riskOffComponents]);

  const normalizeWeights = (type: 'riskOn' | 'riskOff') => {
      const listKey = type === 'riskOn' ? 'riskOnComponents' : 'riskOffComponents';
      const components = [...(form[listKey] || [])];
      const sum = components.reduce((a, b) => a + b.allocation, 0);
      if (sum === 0) return;
      const normalized = components.map(c => ({ ...c, allocation: Number(((c.allocation / sum) * 100).toFixed(2)) }));
      setForm({ ...form, [listKey]: normalized });
  };

  const handleEdit = (strategy: Strategy) => {
      setForm({ ...strategy });
      setView('EDITOR');
  };

  const handleClone = (strategy: Strategy) => {
      const { id, ...rest } = strategy;
      setForm({
          ...rest,
          name: `${strategy.name} (Clone)`,
          id: undefined 
      });
      setView('EDITOR');
  };

  const handleDelete = (id: string) => {
      if (confirm('Permanently delete this strategy?')) {
          StorageService.deleteStrategy(id);
          loadStrategies();
      }
  };

  const handleSave = () => {
    if(!form.name) return;
    const strategyId = form.id || `strat_${Date.now()}`;
    const newStrategy: Strategy = {
      id: strategyId,
      name: form.name || 'Unnamed Strategy',
      type: form.type || 'Single',
      description: form.description || '',
      rebalanceFreq: form.rebalanceFreq || RebalanceFrequency.MONTHLY,
      pricePreference: form.pricePreference || PriceType.CLOSE,
      executionDelay: form.executionDelay || 0,
      initialCapital: form.initialCapital || 10000,
      transactionCostPct: form.transactionCostPct || 0,
      slippagePct: form.slippagePct || 0,
      benchmarkSymbolId: form.benchmarkSymbolId || (symbols[0]?.id || '1'),
      backtestDuration: form.backtestDuration || '1Y',
      riskOnComponents: form.riskOnComponents || [],
      riskOffComponents: form.riskOffComponents || [],
      rules: form.rules || [],
      subStrategyAllocations: form.subStrategyAllocations || [],
      onlyTradeOnSignalChange: !!form.onlyTradeOnSignalChange
    };
    StorageService.saveStrategy(newStrategy);
    loadStrategies();
    setView('LIST');
  };

  const updateComponent = (type: 'riskOn' | 'riskOff', index: number, field: keyof StrategyComponent, value: any) => {
    const listKey = type === 'riskOn' ? 'riskOnComponents' : 'riskOffComponents';
    const currentList = [...(form[listKey] || [])];
    currentList[index] = { ...currentList[index], [field]: value };
    setForm({ ...form, [listKey]: currentList });
  };

  const addComponent = (type: 'riskOn' | 'riskOff') => {
    const listKey = type === 'riskOn' ? 'riskOnComponents' : 'riskOffComponents';
    const newComp: StrategyComponent = { symbolId: symbols[0]?.id || '', direction: 'Long', allocation: 0 };
    setForm({ ...form, [listKey]: [...(form[listKey] || []), newComp] });
  };

  const removeComponent = (type: 'riskOn' | 'riskOff', index: number) => {
    const listKey = type === 'riskOn' ? 'riskOnComponents' : 'riskOffComponents';
    const currentList = [...(form[listKey] || [])];
    currentList.splice(index, 1);
    setForm({ ...form, [listKey]: currentList });
  };

  const renderAssetTable = (type: 'riskOn' | 'riskOff', title: string) => {
    const components = type === 'riskOn' ? form.riskOnComponents : form.riskOffComponents;
    const sum = type === 'riskOn' ? riskOnSum : riskOffSum;
    const isError = Math.abs(sum - 100) > 0.01;

    return (
        <div className="space-y-3">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <h4 className="font-medium text-slate-300 uppercase text-xs tracking-widest">{title}</h4>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${isError ? 'bg-red-900/40 text-red-400 border border-red-500/20' : 'bg-emerald-900/40 text-emerald-400'}`}>
                        {sum.toFixed(1)}%
                    </span>
                    {isError && sum > 0 && <button onClick={() => normalizeWeights(type)} className="text-[9px] text-emerald-400 hover:underline ml-2">Fix to 100%</button>}
                </div>
                <Button variant="ghost" className="text-[10px] h-7 px-2 border border-slate-800" onClick={() => addComponent(type)}>+ ADD</Button>
            </div>
            {components?.map((comp, idx) => (
                <div key={idx} className="flex flex-col sm:flex-row gap-2 items-start sm:items-center bg-slate-900/50 p-2 rounded border border-slate-800/50">
                    <div className="flex-1 w-full">
                        <select className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200" value={comp.symbolId} onChange={(e) => updateComponent(type, idx, 'symbolId', e.target.value)}>
                            {assetOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                    <div className="w-full sm:w-44 relative flex items-center gap-2">
                        <input 
                          type="number" 
                          step="0.01"
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 text-right pr-10" 
                          value={comp.allocation} 
                          placeholder="Weight"
                          onChange={(e) => updateComponent(type, idx, 'allocation', Number(e.target.value))} 
                        />
                        <span className="absolute right-12 top-2 text-[10px] text-slate-500 font-bold">%</span>
                        <button onClick={() => removeComponent(type, idx)} className="text-slate-600 hover:text-red-400 p-1 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                    </div>
                </div>
            ))}
        </div>
    )
  }

  if (view === 'EDITOR') {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" onClick={() => setView('LIST')} className="text-slate-400">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg> Back
                </Button>
                <h2 className="text-2xl font-bold text-white">{form.id ? 'Edit Strategy' : 'New Strategy'}</h2>
            </div>
            <Button onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-500 shadow-xl shadow-emerald-500/20">Save Changes</Button>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
                <Card className="space-y-6 bg-slate-900/60">
                    <section className="space-y-4">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-800 pb-2">Basic Info</h3>
                        <div className="grid grid-cols-1 gap-4">
                            <Input label="Strategy Name" value={form.name || ''} onChange={e => setForm({...form, name: e.target.value})} />
                            <Input label="Description (Optional)" value={form.description || ''} onChange={e => setForm({...form, description: e.target.value})} />
                        </div>
                    </section>

                    <section className="space-y-4">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-800 pb-2">Backtest Parameters</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Input type="number" label="Initial Capital" value={form.initialCapital || 10000} onChange={e => setForm({...form, initialCapital: Number(e.target.value)})} />
                            <Select label="Benchmark Symbol" value={form.benchmarkSymbolId || ''} onChange={e => setForm({...form, benchmarkSymbolId: e.target.value})} options={symbols.map(s => ({ value: s.id, label: `${s.ticker} - ${s.name}` }))} />
                            <div className="grid grid-cols-2 gap-2">
                                <Input type="number" label="Tx Cost (%)" value={form.transactionCostPct || 0} onChange={e => setForm({...form, transactionCostPct: Number(e.target.value)})} />
                                <Input type="number" label="Slippage (%)" value={form.slippagePct || 0} onChange={e => setForm({...form, slippagePct: Number(e.target.value)})} />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <Input type="number" label="Delay (Days)" value={form.executionDelay || 0} onChange={e => setForm({...form, executionDelay: Number(e.target.value)})} />
                                <Select label="Price Ref" value={form.pricePreference || PriceType.CLOSE} onChange={e => setForm({...form, pricePreference: e.target.value as PriceType})} options={Object.values(PriceType).map(v => ({ value: v, label: v }))} />
                            </div>
                        </div>
                    </section>

                    <section className="space-y-4">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-800 pb-2">Trading Behavior</h3>
                        <div className="flex items-center gap-6">
                             <div className="flex-1">
                                <Select label="Rebalance Frequency" value={form.rebalanceFreq || RebalanceFrequency.WEEKLY} onChange={e => setForm({...form, rebalanceFreq: e.target.value as RebalanceFrequency})} options={Object.values(RebalanceFrequency).map(v => ({ value: v, label: v }))} />
                             </div>
                             <div className="flex-1">
                                <label className="block text-sm font-medium text-slate-400 mb-1.5">Trade Filter</label>
                                <div className="flex items-center gap-2 h-10 px-3 bg-slate-950 border border-slate-700 rounded-lg">
                                    <input 
                                        type="checkbox" 
                                        checked={!!form.onlyTradeOnSignalChange} 
                                        onChange={e => setForm({...form, onlyTradeOnSignalChange: e.target.checked})}
                                        className="w-4 h-4 rounded bg-slate-800 border-slate-600 text-emerald-500 focus:ring-emerald-500"
                                    />
                                    <span className="text-xs text-slate-300 font-medium uppercase tracking-tighter">Signal-Only Trading</span>
                                </div>
                             </div>
                        </div>
                    </section>
                </Card>

                <Card className="space-y-6 bg-slate-900/60">
                    <section className="space-y-4">
                         <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-800 pb-2">Component Baskets</h3>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {renderAssetTable('riskOn', 'Risk On Components')}
                            {renderAssetTable('riskOff', 'Risk Off Components')}
                         </div>
                    </section>
                </Card>
            </div>

            <div className="space-y-6">
                <Card className="bg-slate-950/50 border-slate-800 sticky top-6">
                    <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-3 tracking-widest">Summary Preview</h4>
                    <div className="space-y-4 text-xs">
                        <div className="flex justify-between"><span className="text-slate-500">Capital:</span><span className="text-slate-200 font-mono">${form.initialCapital?.toLocaleString()}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Rebalance:</span><span className="text-slate-200">{form.rebalanceFreq}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Signal-Only:</span><span className={form.onlyTradeOnSignalChange ? 'text-emerald-400' : 'text-slate-500'}>{form.onlyTradeOnSignalChange ? 'Enabled' : 'Disabled'}</span></div>
                        <div className="pt-4 border-t border-slate-800">
                             <Select label="Regime Switch Rule" value={form.rules?.[0]?.ruleId || ''} onChange={e => setForm({...form, rules: [{ ruleId: e.target.value, weight: 100 }]})} options={AVAILABLE_RULES.map(r => ({ value: r.id, label: r.name }))} />
                        </div>
                    </div>
                </Card>
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div><h2 className="text-2xl font-bold text-white tracking-tight">Strategy Manager</h2><p className="text-slate-400 text-sm">Design meta-strategies by combining assets and other strategies.</p></div>
        <Button onClick={() => { setForm({ riskOnComponents: [], riskOffComponents: [], rules: [], onlyTradeOnSignalChange: false }); setView('EDITOR'); }}>+ New Strategy</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {strategies.map(strat => (
              <Card key={strat.id} className="hover:border-emerald-500/50 transition-all group flex flex-col justify-between bg-slate-900/40 backdrop-blur-sm">
                  <div className="relative">
                    <div className="flex justify-between items-start mb-4">
                        <h3 className="text-lg font-bold text-emerald-400 truncate pr-4">{strat.name}</h3>
                        <span className="text-[9px] font-mono bg-slate-950 px-2 py-0.5 rounded text-slate-500 border border-slate-800 uppercase">{strat.rebalanceFreq}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-y-1 text-[11px] text-slate-500 mb-4">
                        <div>Risk-On Assets</div><div className="text-slate-200 text-right">{strat.riskOnComponents.length}</div>
                        <div>Risk-Off Assets</div><div className="text-slate-200 text-right">{strat.riskOffComponents.length}</div>
                        <div>Signal-Only</div><div className="text-slate-200 text-right">{strat.onlyTradeOnSignalChange ? 'YES' : 'NO'}</div>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-800 flex gap-2">
                       <Button variant="secondary" className="flex-1 text-xs py-1.5" onClick={() => handleEdit(strat)}>Edit</Button>
                       <Button variant="ghost" className={`px-2 border border-slate-800 ${isSyncing === strat.id ? 'animate-pulse' : ''}`} onClick={() => handleMaterialize(strat)} title="Sync Pricing Data">
                           {isSyncing === strat.id ? '...' : <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
                       </Button>
                       <Button variant="ghost" className="px-2 border border-slate-800" onClick={() => handleClone(strat)} title="Clone Strategy">
                           <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>
                       </Button>
                       <Button variant="ghost" className="px-2 border border-slate-800 hover:border-red-900/50 hover:bg-red-900/10" onClick={() => handleDelete(strat.id)}><svg className="w-4 h-4 text-slate-500 hover:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></Button>
                  </div>
              </Card>
          ))}
      </div>
    </div>
  );
};

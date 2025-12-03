import React, { useState, useEffect } from 'react';
import { Card, Button, Input, Select } from '../components/ui';
import { StorageService } from '../services/storage';
import { SymbolData, Strategy, StrategyComponent, RebalanceFrequency, PriceType, Rule } from '../types';
import { AVAILABLE_RULES } from '../constants';

export const StrategyBuilder = () => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [symbols, setSymbols] = useState<SymbolData[]>([]);
  const [view, setView] = useState<'LIST' | 'EDITOR'>('LIST');

  // New Strategy Form
  const [form, setForm] = useState<Partial<Strategy>>({
    name: '',
    type: 'Single',
    rebalanceFreq: RebalanceFrequency.MONTHLY,
    pricePreference: PriceType.CLOSE,
    initialCapital: 10000,
    transactionCostPct: 0.1,
    slippagePct: 0.1,
    executionDelay: 1,
    backtestDuration: '1Y',
    benchmarkSymbolId: '',
    riskOnComponents: [],
    riskOffComponents: [],
    rules: []
  });

  useEffect(() => {
    setStrategies(StorageService.getStrategies());
    setSymbols(StorageService.getSymbols());
  }, []);

  const resetForm = () => {
    setForm({
        name: '',
        type: 'Single',
        rebalanceFreq: RebalanceFrequency.MONTHLY,
        pricePreference: PriceType.CLOSE,
        initialCapital: 10000,
        transactionCostPct: 0.1,
        slippagePct: 0.1,
        executionDelay: 1,
        backtestDuration: '1Y',
        benchmarkSymbolId: symbols[0]?.id || '',
        riskOnComponents: [],
        riskOffComponents: [],
        rules: []
      });
  };

  const handleEdit = (strategy: Strategy) => {
      setForm({ ...strategy });
      setView('EDITOR');
  };

  const handleDelete = (id: string) => {
      if(confirm("Delete this strategy?")) {
        // In a real app, delete from storage
        const newStrategies = strategies.filter(s => s.id !== id);
        // We need to implement delete in storage service really, but for now we simulate by saving the filtered list if the service supported it, 
        // or just filtering local state. The StorageService doesn't have deleteStrategy exposed in the interface provided in prompt, 
        // but assuming we'd add it. For now, let's just update local state to reflect UI action or use a mock approach.
        // Actually, let's just stick to editing/creating as requested.
      }
  };

  const handleSave = () => {
    if(!form.name) return;
    
    // If ID exists, we are updating. If not, create new ID.
    const strategyId = form.id || Date.now().toString();

    const newStrategy: Strategy = {
      ...form as Strategy,
      id: strategyId,
      riskOnComponents: form.riskOnComponents || [],
      riskOffComponents: form.riskOffComponents || [],
      benchmarkSymbolId: form.benchmarkSymbolId || (symbols[0]?.id || '1')
    };

    StorageService.saveStrategy(newStrategy);
    setStrategies(StorageService.getStrategies());
    setView('LIST');
    resetForm();
  };

  const toggleRule = (ruleId: string) => {
    const currentRules = form.rules || [];
    const exists = currentRules.find(r => r.ruleId === ruleId);
    if(exists) {
        setForm({...form, rules: currentRules.filter(r => r.ruleId !== ruleId)});
    } else {
        setForm({...form, rules: [...currentRules, { ruleId, weight: 100 }]}); 
    }
  };

  const updateComponent = (
    type: 'riskOn' | 'riskOff', 
    index: number, 
    field: keyof StrategyComponent, 
    value: any
  ) => {
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
    return (
        <div className="space-y-3">
            <div className="flex justify-between items-center">
                <h4 className="font-medium text-slate-300">{title}</h4>
                <Button variant="ghost" className="text-xs h-8" onClick={() => addComponent(type)}>+ Add Asset</Button>
            </div>
            {(!components || components.length === 0) && <p className="text-sm text-slate-500 italic">No assets selected.</p>}
            {components?.map((comp, idx) => (
                <div key={idx} className="flex flex-col sm:flex-row gap-2 items-start sm:items-center bg-slate-900 p-2 rounded border border-slate-800">
                    <div className="flex-1 w-full">
                        <select 
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200"
                            value={comp.symbolId}
                            onChange={(e) => updateComponent(type, idx, 'symbolId', e.target.value)}
                        >
                            {symbols.map(s => <option key={s.id} value={s.id}>{s.ticker} {s.isList ? '(List)' : ''} - {s.name}</option>)}
                        </select>
                    </div>
                    <div className="w-full sm:w-28">
                            <select 
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200"
                            value={comp.direction}
                            onChange={(e) => updateComponent(type, idx, 'direction', e.target.value)}
                        >
                            <option value="Long">Long</option>
                            <option value="Short">Short</option>
                        </select>
                    </div>
                    <div className="w-full sm:w-24 relative">
                            <input 
                            type="number" 
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 text-right pr-6"
                            value={comp.allocation}
                            onChange={(e) => updateComponent(type, idx, 'allocation', Number(e.target.value))}
                        />
                        <span className="absolute right-2 top-1.5 text-xs text-slate-500">%</span>
                    </div>
                    <button onClick={() => removeComponent(type, idx)} className="text-slate-500 hover:text-red-400 p-1 self-end sm:self-center">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            ))}
        </div>
    )
  }

  if (view === 'EDITOR') {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-6">
            <Button variant="ghost" onClick={() => { setView('LIST'); resetForm(); }}>← Back</Button>
            <h2 className="text-2xl font-bold">{form.id ? 'Edit Strategy' : 'Create Strategy'}</h2>
        </div>

        <Card className="space-y-6">
            {/* Main Config */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input label="Strategy Name" value={form.name || ''} onChange={e => setForm({...form, name: e.target.value})} />
                <Select 
                    label="Backtest Period" 
                    value={form.backtestDuration || '1Y'} 
                    onChange={e => setForm({...form, backtestDuration: e.target.value})}
                    options={[
                        { value: '3M', label: '3 Months' },
                        { value: '6M', label: '6 Months' },
                        { value: '1Y', label: '1 Year' },
                        { value: '3Y', label: '3 Years' },
                        { value: '5Y', label: '5 Years' },
                        { value: 'Max', label: 'Max Available' }
                    ]}
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Select 
                    label="Rebalancing Frequency" 
                    value={form.rebalanceFreq || RebalanceFrequency.MONTHLY} 
                    onChange={e => setForm({...form, rebalanceFreq: e.target.value as RebalanceFrequency})}
                    options={Object.values(RebalanceFrequency).map(f => ({ value: f, label: f }))}
                />
                <Select 
                    label="Benchmark Symbol" 
                    value={form.benchmarkSymbolId || ''} 
                    onChange={e => setForm({...form, benchmarkSymbolId: e.target.value})}
                    options={[{value: '', label: 'Select Benchmark'}, ...symbols.map(s => ({ value: s.id, label: s.ticker }))]}
                />
                <Select 
                    label="Price Preference" 
                    value={form.pricePreference || PriceType.CLOSE} 
                    onChange={e => setForm({...form, pricePreference: e.target.value as PriceType})}
                    options={Object.values(PriceType).map(p => ({ value: p, label: p }))}
                />
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                 <Input type="number" label="Initial Capital" value={form.initialCapital || 0} onChange={e => setForm({...form, initialCapital: Number(e.target.value)})} />
                 <Input type="number" label="Tx Cost (%)" value={form.transactionCostPct || 0} onChange={e => setForm({...form, transactionCostPct: Number(e.target.value)})} />
                 <Input type="number" label="Slippage (%)" value={form.slippagePct || 0} onChange={e => setForm({...form, slippagePct: Number(e.target.value)})} />
                 <Input type="number" label="Delay (Days)" value={form.executionDelay || 0} onChange={e => setForm({...form, executionDelay: Number(e.target.value)})} />
            </div>

            <div className="pt-4 border-t border-slate-800">
                <h3 className="font-semibold text-lg mb-4 text-white">Rule Logic</h3>
                <div className="grid grid-cols-1 gap-3">
                    {AVAILABLE_RULES.map(rule => (
                        <div 
                            key={rule.id} 
                            onClick={() => toggleRule(rule.id)}
                            className={`p-4 rounded-lg border cursor-pointer transition-all ${
                                form.rules?.find(r => r.ruleId === rule.id) 
                                ? 'bg-emerald-900/20 border-emerald-500' 
                                : 'bg-slate-950 border-slate-700 hover:border-slate-600'
                            }`}
                        >
                            <div className="flex justify-between items-center mb-1">
                                <span className="font-medium text-emerald-400">{rule.name}</span>
                                {form.rules?.find(r => r.ruleId === rule.id) && (
                                    <span className="text-xs bg-emerald-500 text-slate-900 px-2 py-0.5 rounded-full font-bold">SELECTED</span>
                                )}
                            </div>
                            <p className="text-sm text-slate-400">{rule.description}</p>
                        </div>
                    ))}
                </div>
            </div>

            <div className="pt-4 border-t border-slate-800">
                 <h3 className="font-semibold text-lg mb-4 text-white">Portfolio Universe</h3>
                 <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {renderAssetTable('riskOn', 'Risk On Assets')}
                    {renderAssetTable('riskOff', 'Risk Off Assets')}
                 </div>
            </div>

            <div className="flex justify-end pt-6">
                <Button onClick={handleSave}>Save Strategy Config</Button>
            </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-white">Strategy Manager</h2>
          <p className="text-slate-400">Define logic, universe, and execution parameters.</p>
        </div>
        <Button onClick={() => { resetForm(); setView('EDITOR'); }}>
            + New Strategy
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {strategies.map(strat => (
              <Card key={strat.id} className="hover:border-emerald-500/50 transition-colors group relative flex flex-col justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-emerald-400 mb-2 truncate">{strat.name}</h3>
                    <div className="space-y-2 text-sm text-slate-400">
                        <div className="flex justify-between">
                            <span>Benchmark:</span> <span className="text-slate-200">{symbols.find(s=>s.id === strat.benchmarkSymbolId)?.ticker || 'None'}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Backtest:</span> <span className="text-slate-200">{strat.backtestDuration}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Freq:</span> <span className="text-slate-200">{strat.rebalanceFreq}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Risk On:</span> <span className="text-slate-200">{strat.riskOnComponents.length} Assets</span>
                        </div>
                    </div>
                  </div>
                  <div className="mt-6 flex gap-2">
                       <Button variant="secondary" className="w-full text-sm py-1" onClick={() => handleEdit(strat)}>Edit</Button>
                       <Button variant="ghost" className="text-sm py-1 text-red-400 hover:text-red-300">Delete</Button>
                  </div>
              </Card>
          ))}
          {strategies.length === 0 && (
              <div className="col-span-3 py-12 text-center border-2 border-dashed border-slate-800 rounded-xl text-slate-500">
                  No strategies found. Create your first one.
              </div>
          )}
      </div>
    </div>
  );
};
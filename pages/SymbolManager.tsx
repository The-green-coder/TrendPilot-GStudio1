import React, { useState, useEffect } from 'react';
import { Card, Button, Input, Select } from '../components/ui';
import { StorageService } from '../services/storage';
import { SymbolData, Currency } from '../types';

export const SymbolManager = () => {
  const [symbols, setSymbols] = useState<SymbolData[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [form, setForm] = useState<Partial<SymbolData>>({
    ticker: '',
    name: '',
    exchange: 'NYSE',
    defaultCCY: Currency.USD,
    userCCY: Currency.USD,
    isList: false
  });

  useEffect(() => {
    setSymbols(StorageService.getSymbols());
  }, []);

  const handleSave = () => {
    if (!form.ticker || !form.name) return;

    const newSymbol: SymbolData = {
      id: editingId || Date.now().toString(),
      ticker: form.ticker,
      name: form.name,
      exchange: form.exchange || 'NYSE',
      defaultCCY: form.defaultCCY || Currency.USD,
      userCCY: form.userCCY,
      isList: form.isList || false,
      listMembers: []
    };

    StorageService.saveSymbol(newSymbol);
    setSymbols(StorageService.getSymbols());
    setIsModalOpen(false);
    resetForm();
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this symbol?')) {
      StorageService.deleteSymbol(id);
      setSymbols(StorageService.getSymbols());
    }
  };

  const resetForm = () => {
    setForm({ ticker: '', name: '', exchange: 'NYSE', defaultCCY: Currency.USD, userCCY: Currency.USD, isList: false });
    setEditingId(null);
  };

  const openEdit = (sym: SymbolData) => {
    setForm(sym);
    setEditingId(sym.id);
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-white">Symbol Manager</h2>
          <p className="text-slate-400">Manage tradable assets, indices, and symbol lists.</p>
        </div>
        <Button onClick={() => { resetForm(); setIsModalOpen(true); }}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Symbol
        </Button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-800 border-b border-slate-700 text-slate-400 text-sm uppercase">
                <th className="px-6 py-4 font-semibold">Ticker</th>
                <th className="px-6 py-4 font-semibold">Name</th>
                <th className="px-6 py-4 font-semibold">Exchange</th>
                <th className="px-6 py-4 font-semibold">Default CCY</th>
                <th className="px-6 py-4 font-semibold">User CCY</th>
                <th className="px-6 py-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {symbols.map((sym) => (
                <tr key={sym.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="px-6 py-4 font-medium text-emerald-400">{sym.ticker}</td>
                  <td className="px-6 py-4 text-slate-300">{sym.name}</td>
                  <td className="px-6 py-4 text-slate-400">{sym.exchange}</td>
                  <td className="px-6 py-4 text-slate-400">{sym.defaultCCY}</td>
                  <td className="px-6 py-4 text-slate-400">{sym.userCCY || '-'}</td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <button onClick={() => openEdit(sym)} className="text-slate-400 hover:text-white text-sm">Edit</button>
                    <button onClick={() => handleDelete(sym.id)} className="text-red-500 hover:text-red-400 text-sm">Delete</button>
                  </td>
                </tr>
              ))}
              {symbols.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">No symbols found. Add one to get started.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal Overlay */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4 shadow-2xl bg-slate-900 border-slate-700">
            <h3 className="text-xl font-bold mb-4">{editingId ? 'Edit Symbol' : 'Add New Symbol'}</h3>
            <div className="space-y-4">
              <Input
                label="Ticker Symbol"
                value={form.ticker || ''}
                onChange={e => setForm({...form, ticker: e.target.value.toUpperCase()})}
                placeholder="e.g., SPY"
              />
              <Input
                label="Asset Name"
                value={form.name || ''}
                onChange={e => setForm({...form, name: e.target.value})}
                placeholder="e.g., S&P 500 ETF"
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Exchange"
                  value={form.exchange || ''}
                  onChange={e => setForm({...form, exchange: e.target.value})}
                />
                 <Select
                  label="Default CCY"
                  value={form.defaultCCY || Currency.USD}
                  onChange={e => setForm({...form, defaultCCY: e.target.value as Currency})}
                  options={Object.values(Currency).map(c => ({ value: c, label: c }))}
                />
              </div>
              <div className="pt-2 border-t border-slate-800">
                <label className="flex items-center gap-2 mb-2">
                   <input 
                    type="checkbox" 
                    checked={!!form.userCCY && form.userCCY !== form.defaultCCY}
                    onChange={(e) => {
                        if(e.target.checked) setForm({...form, userCCY: Currency.EUR}) // Default jump to EUR for example
                        else setForm({...form, userCCY: form.defaultCCY})
                    }}
                    className="rounded bg-slate-800 border-slate-600 text-emerald-500 focus:ring-emerald-500"
                   />
                   <span className="text-sm text-slate-300">Override Currency?</span>
                </label>
                {!!form.userCCY && form.userCCY !== form.defaultCCY && (
                    <Select
                    label="Target Currency (Conversion)"
                    value={form.userCCY}
                    onChange={e => setForm({...form, userCCY: e.target.value as Currency})}
                    options={Object.values(Currency).map(c => ({ value: c, label: c }))}
                    />
                )}
              </div>
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <Button variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button>
              <Button onClick={handleSave}>Save Symbol</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
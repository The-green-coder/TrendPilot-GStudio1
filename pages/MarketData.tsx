
import React, { useState, useEffect } from 'react';
import { Card, Button, Select, Input } from '../components/ui';
import { StorageService } from '../services/storage';
import { MarketDataService } from '../services/marketData';
import { MARKET_DATA_PROVIDERS } from '../constants';
import { SymbolData } from '../types';

interface DataStatus {
    exists: boolean;
    count?: number;
    start?: string;
    end?: string;
}

export const MarketDataManager = () => {
  const [provider, setProvider] = useState(MARKET_DATA_PROVIDERS[0].id);
  const [customApiKey, setCustomApiKey] = useState('');
  const [progress, setProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [symbols, setSymbols] = useState<SymbolData[]>([]);
  const [dataStatus, setDataStatus] = useState<Record<string, DataStatus>>({});
  const [loadingStatus, setLoadingStatus] = useState(true);

  useEffect(() => {
      loadSymbolsAndStatus();
  }, []);

  const loadSymbolsAndStatus = async () => {
      const s = StorageService.getSymbols();
      setSymbols(s);
      await checkDataStatus(s);
  };

  const checkDataStatus = async (syms: SymbolData[]) => {
      setLoadingStatus(true);
      const status: Record<string, DataStatus> = {};
      for (const s of syms) {
          const data = await StorageService.getMarketData(s.ticker);
          if (data && data.length > 0) {
              const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
              status[s.ticker] = { 
                  exists: true, 
                  count: data.length,
                  start: sorted[0].date,
                  end: sorted[sorted.length - 1].date
              };
          } else {
              status[s.ticker] = { exists: false };
          }
      }
      setDataStatus(status);
      setLoadingStatus(false);
  };

  const handleDownload = async (onlyMissing: boolean) => {
    setIsDownloading(true);
    setProgress(0);
    setStatusMessage(onlyMissing ? 'Identifying missing assets...' : 'Synchronizing local history...');

    try {
        let targets = symbols.filter(s => !s.isList && s.ticker);
        if (onlyMissing) {
            targets = targets.filter(s => !dataStatus[s.ticker]?.exists);
        }

        if (targets.length === 0) {
            setStatusMessage("No updates required.");
            setIsDownloading(false);
            return;
        }

        for (let i = 0; i < targets.length; i++) {
            const sym = targets[i];
            setStatusMessage(`Downloading & Cleaning ${sym.ticker} (${i+1}/${targets.length})...`);
            try {
                // The MarketDataService.fetchHistory now includes the cleaning pipeline
                const data = await MarketDataService.fetchHistory(sym.ticker, 'max', '1d', provider, customApiKey);
                if (data.length > 0) {
                    await StorageService.saveMarketData(sym.ticker, data);
                }
            } catch (e) {
                console.error(`Download failed: ${sym.ticker}`, e);
            }
            setProgress(Math.round(((i + 1) / targets.length) * 100));
            await new Promise(r => setTimeout(r, 200));
        }

        setStatusMessage("Synchronization & Data Cleaning Successful.");
        await loadSymbolsAndStatus();
    } catch (e) {
      setStatusMessage("Critical sync failure.");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
       <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Market Data Center</h2>
          <p className="text-slate-400">Manage persistence for your backtest universe with automated data cleaning.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <Card className="lg:col-span-2 space-y-6 bg-slate-900/80 backdrop-blur-sm">
                <div className="space-y-4">
                    <Select 
                        label="Data Source Provider" 
                        value={provider} 
                        onChange={e => setProvider(e.target.value)} 
                        options={MARKET_DATA_PROVIDERS.map(p => ({ value: p.id, label: `${p.name} (${p.type})` }))} 
                    />
                    {provider !== 'yfinance' && (
                        <Input 
                            label="API Key" 
                            type="password"
                            value={customApiKey} 
                            onChange={e => setCustomApiKey(e.target.value)}
                            placeholder="Enter Key"
                        />
                    )}
                </div>

                <div className="p-5 bg-slate-950/50 rounded-xl border border-slate-800 space-y-5">
                    <div className="flex justify-between items-center">
                        <div className="space-y-1">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Persistence Status</h3>
                            <p className="text-[10px] text-emerald-500/80 font-medium">Automatic Spike & Glitch Filtering Active</p>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] font-mono">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span className="text-emerald-400 uppercase font-bold">Local Sync Connected</span>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Button variant="primary" onClick={() => handleDownload(true)} disabled={isDownloading}>
                            Sync Missing Assets
                        </Button>
                        <Button variant="secondary" onClick={() => handleDownload(false)} disabled={isDownloading}>
                            Refresh All Data
                        </Button>
                    </div>
                    <Button variant="danger" className="w-full text-sm py-1.5" onClick={() => {
                        if(confirm("Permanently wipe local history cache?")) {
                            StorageService.clearMarketData().then(() => loadSymbolsAndStatus());
                        }
                    }} disabled={isDownloading}>
                        Wipe Disk Cache
                    </Button>
                </div>

                {isDownloading && (
                    <div className="space-y-3 p-4 bg-emerald-900/10 rounded-lg border border-emerald-500/20">
                        <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${progress}%` }}></div>
                        </div>
                        <p className="text-[10px] text-center text-emerald-400 font-mono tracking-widest uppercase">{statusMessage}</p>
                    </div>
                )}
            </Card>

            <Card className="lg:col-span-2 h-[600px] flex flex-col bg-slate-900/80 backdrop-blur-sm overflow-hidden">
                <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-2">
                    <h3 className="font-semibold text-slate-200">Inventory Analysis</h3>
                    <span className="text-[10px] text-slate-500 font-mono">COUNT: {symbols.length}</span>
                </div>
                
                <div className="flex-1 overflow-auto custom-scrollbar">
                    {loadingStatus ? (
                         <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-600">
                             <div className="w-4 h-4 border border-slate-700 border-t-emerald-500 rounded-full animate-spin"></div>
                             <span className="text-[10px] font-mono uppercase">Scanning Local Cache...</span>
                         </div>
                    ) : (
                        <table className="w-full text-left text-[11px] font-mono whitespace-nowrap">
                            <thead className="bg-slate-900 sticky top-0 z-10 text-slate-500 uppercase">
                                <tr>
                                    <th className="px-3 py-3 border-b border-slate-800">Symbol</th>
                                    <th className="px-3 py-3 border-b border-slate-800 text-center">Status</th>
                                    <th className="px-3 py-3 border-b border-slate-800 text-right">Records</th>
                                    <th className="px-3 py-3 border-b border-slate-800">Start Date</th>
                                    <th className="px-3 py-3 border-b border-slate-800">End Date</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50">
                                {symbols.map(s => {
                                    const status = dataStatus[s.ticker];
                                    return (
                                        <tr key={s.id} className="hover:bg-slate-800/30 transition-colors">
                                            <td className="px-3 py-2.5 font-bold text-slate-200">{s.ticker}</td>
                                            <td className="px-3 py-2.5 text-center">
                                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${status?.exists ? 'bg-emerald-900/30 text-emerald-500' : 'bg-red-900/30 text-red-500'}`}>
                                                    {status?.exists ? 'SYNCED' : 'MISSING'}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2.5 text-right text-slate-300">
                                                {status?.count?.toLocaleString() || '0'}
                                            </td>
                                            <td className="px-3 py-2.5 text-slate-400">
                                                {status?.start || '---'}
                                            </td>
                                            <td className="px-3 py-2.5 text-slate-400">
                                                {status?.end || '---'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </Card>
        </div>
    </div>
  );
};

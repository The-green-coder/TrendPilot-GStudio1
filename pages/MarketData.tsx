
import React, { useState, useEffect } from 'react';
import { Card, Button, Select, Input } from '../components/ui';
import { StorageService } from '../services/storage';
import { MarketDataService } from '../services/marketData';
import { MARKET_DATA_PROVIDERS } from '../constants';
import { SymbolData } from '../types';

export const MarketDataManager = () => {
  const [provider, setProvider] = useState(MARKET_DATA_PROVIDERS[0].id);
  const [customApiKey, setCustomApiKey] = useState('');
  const [progress, setProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [symbols, setSymbols] = useState<SymbolData[]>([]);
  const [dataStatus, setDataStatus] = useState<Record<string, boolean>>({});
  const [loadingStatus, setLoadingStatus] = useState(true);

  useEffect(() => {
      const s = StorageService.getSymbols();
      setSymbols(s);
      checkDataStatus(s);
  }, []);

  const checkDataStatus = async (syms: SymbolData[]) => {
      setLoadingStatus(true);
      const status: Record<string, boolean> = {};
      await Promise.all(syms.map(async (s) => {
          status[s.ticker] = await StorageService.hasMarketData(s.ticker);
      }));
      setDataStatus(status);
      setLoadingStatus(false);
  };

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const handleClearData = async () => {
    if (confirm("Are you sure you want to delete ALL historical market data? This cannot be undone.")) {
        await StorageService.clearMarketData();
        const currentSymbols = StorageService.getSymbols();
        setSymbols(currentSymbols); 
        checkDataStatus(currentSymbols);
        setStatusMessage("Database cleared.");
    }
  };

  const handleDownload = async (type: 'RELOAD' | 'INTRADAY' | 'NAV') => {
    setIsDownloading(true);
    setProgress(0);
    setStatusMessage(type === 'RELOAD' ? 'Initializing...' : 'Updating...');

    try {
        if (type === 'RELOAD') {
            const validSymbols = symbols.filter(s => !s.isList && s.ticker);
            const total = validSymbols.length;
            let successCount = 0;
            let failCount = 0;
            let skippedCount = 0;

            const now = new Date();
            // We want data at least 5 years old for valid backtests
            const requiredDate = new Date();
            requiredDate.setFullYear(now.getFullYear() - 5);
            const requiredDateStr = requiredDate.toISOString().split('T')[0];

            // SERIAL PROCESSING
            for (let i = 0; i < total; i++) {
                const sym = validSymbols[i];
                let shouldDownload = true;
                const existingData = await StorageService.getMarketData(sym.ticker);
                
                // Smart Check: Do we have data AND does it start early enough?
                if (existingData && existingData.length > 0) {
                    const firstDate = existingData[0].date;
                    // If first date in DB is older than (or equal to) required date, we are good.
                    // e.g. stored '2019-01-01', required '2020-01-01' -> Good.
                    if (firstDate <= requiredDateStr) {
                         shouldDownload = false;
                    }
                }

                if (!shouldDownload) {
                    setStatusMessage(`Skipping ${sym.ticker} (Data covers 5Y+)...`);
                    skippedCount++;
                    successCount++; 
                    setProgress(Math.round(((i + 1) / total) * 100));
                    continue;
                }

                setStatusMessage(`Fetching ${sym.ticker} (${i + 1}/${total}) via ${provider}...`);
                
                try {
                    const data = await MarketDataService.fetchHistory(sym.ticker, '5y', '1d', provider, customApiKey);
                    
                    if (data && data.length > 0) {
                        setStatusMessage(`Saving ${sym.ticker} to database...`);
                        const saved = await StorageService.saveMarketData(sym.ticker, data);
                        if (saved) {
                            successCount++;
                        } else {
                            console.error(`Database write failed for ${sym.ticker}`);
                            failCount++;
                        }
                    } else {
                        failCount++;
                    }
                } catch (err) {
                    failCount++;
                    console.error(`Failed ${sym.ticker}`, err);
                }

                setProgress(Math.round(((i + 1) / total) * 100));
                
                if (i < total - 1) {
                    const delay = provider === 'eodhd' ? 200 : 2500;
                    setStatusMessage(`Waiting...`);
                    await sleep(delay);
                }
            }

            setStatusMessage(`Completed. Updated: ${successCount - skippedCount}, Skipped: ${skippedCount}, Failed: ${failCount}`);
            await checkDataStatus(symbols);
        } else {
             await sleep(1000);
             setProgress(100);
             setStatusMessage('Update Completed.');
        }

    } catch (e) {
      setStatusMessage('Error: Operation failed.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
       <div>
          <h2 className="text-2xl font-bold text-white">Market Data Manager</h2>
          <p className="text-slate-400">Configure sources and manage historical data ingestion.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 space-y-6">
                <div className="space-y-4">
                    <div className="flex items-end gap-4">
                        <Select
                            label="Primary Data Provider"
                            value={provider}
                            onChange={(e) => setProvider(e.target.value)}
                            options={MARKET_DATA_PROVIDERS.map(p => ({ value: p.id, label: p.name }))}
                            className="flex-1"
                        />
                        <div className="text-sm text-slate-500 pb-3">
                            Status: <span className="text-emerald-400">Connected</span>
                        </div>
                    </div>
                    
                    {provider === 'eodhd' && (
                        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                            <Input 
                                label="EODHD Connection Key"
                                placeholder="Paste your API Token here (Leave empty to use default)"
                                value={customApiKey}
                                onChange={(e) => setCustomApiKey(e.target.value)}
                                className="font-mono text-sm"
                            />
                            <p className="text-xs text-slate-500 mt-1">
                                Default: 68ff66761ac269.80544168
                            </p>
                        </div>
                    )}
                </div>

                <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-4">
                    <h3 className="text-lg font-medium text-slate-200">Data Operations</h3>
                    <div className="text-sm text-yellow-500/80 bg-yellow-500/10 p-2 rounded">
                        Note: "Reload" will fetch data if it is missing OR if existing data is older/shorter than 5 years.
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Button 
                            variant="secondary" 
                            onClick={() => handleDownload('RELOAD')}
                            disabled={isDownloading}
                        >
                           Reload (Ensure 5Y History)
                        </Button>
                         <Button 
                            variant="danger" 
                            onClick={handleClearData}
                            disabled={isDownloading}
                        >
                           Clear Data (Reset)
                        </Button>
                        <Button 
                            variant="secondary" 
                            onClick={() => handleDownload('INTRADAY')}
                            disabled={isDownloading}
                        >
                           Update Intraday
                        </Button>
                        <Button 
                            variant="primary" 
                            onClick={() => handleDownload('NAV')}
                            disabled={isDownloading}
                        >
                           Refresh Strategy NAV
                        </Button>
                    </div>
                </div>

                {(isDownloading || progress > 0) && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="flex justify-between text-sm mb-1">
                            <span className="text-slate-400">{isDownloading ? 'Processing...' : 'Finished'}</span>
                            <span className="text-slate-200 font-mono">{progress}%</span>
                        </div>
                        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-emerald-500 transition-all duration-300 ease-out" 
                                style={{ width: `${progress}%` }}
                            ></div>
                        </div>
                        <p className="mt-2 text-sm text-emerald-400 text-center">{statusMessage}</p>
                    </div>
                )}
            </Card>

            <Card>
                <div className="flex justify-between items-center mb-4">
                     <h3 className="font-semibold text-slate-200">Data Health (IndexedDB)</h3>
                     {loadingStatus && <span className="text-xs text-slate-500 animate-pulse">Checking...</span>}
                </div>
                
                <div className="space-y-2 overflow-y-auto max-h-64 pr-2 custom-scrollbar">
                    {symbols.map(s => (
                        <div key={s.id} className="flex justify-between items-center py-2 border-b border-slate-800 last:border-0">
                            <span className="text-slate-400 text-sm">{s.ticker}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${dataStatus[s.ticker] ? 'bg-emerald-900 text-emerald-400' : 'bg-red-900/50 text-red-400'}`}>
                                {dataStatus[s.ticker] ? 'Available' : 'Missing'}
                            </span>
                        </div>
                    ))}
                    {symbols.length === 0 && <div className="text-sm text-slate-500">No symbols found</div>}
                </div>
                <div className="mt-4 pt-2 border-t border-slate-800 text-xs text-slate-500">
                    Source: {provider === 'eodhd' ? 'EODHD API' : 'Yahoo Finance (via Proxy)'}
                </div>
            </Card>
        </div>
    </div>
  );
};

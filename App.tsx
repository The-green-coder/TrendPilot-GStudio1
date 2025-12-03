import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SymbolManager } from './pages/SymbolManager';
import { MarketDataManager } from './pages/MarketData';
import { StrategyBuilder } from './pages/StrategyBuilder';
import { BacktestDashboard } from './pages/BacktestDashboard';

const App: React.FC = () => {
  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<BacktestDashboard />} />
          <Route path="/symbols" element={<SymbolManager />} />
          <Route path="/market-data" element={<MarketDataManager />} />
          <Route path="/strategies" element={<StrategyBuilder />} />
          <Route path="/backtest" element={<BacktestDashboard />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
};

export default App;
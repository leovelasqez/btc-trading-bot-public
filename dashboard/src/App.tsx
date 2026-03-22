import { useState } from 'react';
import { Overview } from './pages/Overview';
import { Trades } from './pages/Trades';
import { Decisions } from './pages/Decisions';

type Page = 'overview' | 'trades' | 'decisions';

function App() {
  const [page, setPage] = useState<Page>('overview');

  return (
    <div className="app">
      <header className="header">
        <h1>BTC Trading Bot</h1>
        <nav className="nav">
          <button
            className={page === 'overview' ? 'nav-btn active' : 'nav-btn'}
            onClick={() => setPage('overview')}
          >
            Overview
          </button>
          <button
            className={page === 'trades' ? 'nav-btn active' : 'nav-btn'}
            onClick={() => setPage('trades')}
          >
            Trades
          </button>
          <button
            className={page === 'decisions' ? 'nav-btn active' : 'nav-btn'}
            onClick={() => setPage('decisions')}
          >
            AI Decisions
          </button>
        </nav>
      </header>
      <main className="main">
        {page === 'overview' && <Overview />}
        {page === 'trades' && <Trades />}
        {page === 'decisions' && <Decisions />}
      </main>
    </div>
  );
}

export default App;

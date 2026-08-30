import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bridge } from './bridge';
import './key.css';

const host = document.getElementById('root');
if (host === null) throw new Error('key.html is missing #root');
// CA-5: main turns this close into a hide, so the eagerly-created window survives.
createRoot(host).render(<App bridge={bridge} onRequestClose={() => window.close()} />);

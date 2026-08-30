import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bridge } from './bridge';
import './chat.css';

const host = document.getElementById('root');
if (host === null) throw new Error('chat.html is missing #root');
createRoot(host).render(<App bridge={bridge} />);

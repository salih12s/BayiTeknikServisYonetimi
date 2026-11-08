import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installClientLog } from './services/clientLog';

// Yakalanmamış tarayıcı hatalarını ve önceki açılıştan bekleyen bildirimleri gönderir.
installClientLog();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

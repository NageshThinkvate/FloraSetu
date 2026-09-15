import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import '@fontsource-variable/inter';
import '@fontsource/cormorant-garamond/600.css';
import './design/tokens.css';
import './design/components.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

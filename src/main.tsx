import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthGate } from './Auth';
import 'katex/dist/katex.min.css';
import './styles.css';
import './refinement.css';
import './shop.css';
import { applySkin,storedSkin } from './Shop';
// Applied before the first paint so a reload never flashes the default palette.
applySkin(storedSkin());
createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate><App/></AuthGate></React.StrictMode>);

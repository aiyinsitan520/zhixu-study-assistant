import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import {Copyright} from './Copyright';
import { AuthGate } from './Auth';
import 'katex/dist/katex.min.css';
import './styles.css';
import './refinement.css';
import './shop.css';
import './experience.css';
import {applyMotion} from './MotionPreference';
import { applySkin,storedSkin } from './Shop';
// Applied before the first paint so a reload never flashes the default palette.
applySkin(storedSkin());
applyMotion();
createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate><App/></AuthGate><Copyright/></React.StrictMode>);

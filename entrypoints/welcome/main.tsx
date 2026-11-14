import React from 'react';
import ReactDOM from 'react-dom/client';
import WelcomeApp from './WelcomeApp';
import '../sidepanel/globals.css';

const el = document.getElementById('root');
if (el) {
  ReactDOM.createRoot(el).render(
    <React.StrictMode>
      <WelcomeApp />
    </React.StrictMode>,
  );
}

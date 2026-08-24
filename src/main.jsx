import React from 'react';
import ReactDOM from 'react-dom/client';
import 'animal-island-ui/style';
import './styles/shared.css';
import './styles/mobile.css';
import './styles/desktop.css';
import App from './pages/index.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

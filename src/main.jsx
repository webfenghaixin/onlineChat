import React from 'react';
import ReactDOM from 'react-dom/client';
import 'animal-island-ui/style';
import App from './pages/index.jsx';
import './styles/shared.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

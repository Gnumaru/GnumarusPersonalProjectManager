import './styles.css';
import { ApiClient } from './api/client.js';
import { App } from './ui/app.js';

const root = document.getElementById('app');

if (root === null) {
  throw new Error('The application root element (#app) is missing.');
}

const api = new ApiClient({ baseUrl: 'http://127.0.0.1:1423' });
const app = new App({ doc: document, root, api, storage: window.localStorage });

void app.start();

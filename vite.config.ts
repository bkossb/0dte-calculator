import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import optionsHandler from './api/options.js';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-options-api',
      configureServer(server) {
        server.middlewares.use('/api/options', (request, response) => {
          const requestUrl = new URL(request.url || '/', 'http://localhost');
          const apiResponse = {
            statusCode: 200,
            status(code) {
              this.statusCode = code;
              return this;
            },
            setHeader(name, value) {
              response.setHeader(name, value);
            },
            json(body) {
              response.statusCode = this.statusCode;
              response.setHeader('Content-Type', 'application/json');
              response.end(JSON.stringify(body));
              return this;
            },
          };

          void optionsHandler({ query: Object.fromEntries(requestUrl.searchParams) }, apiResponse);
        });
      },
    },
  ],
});
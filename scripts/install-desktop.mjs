import { initializeProxy } from '@electron/get';
// Use the inherited proxy/CA and Electron's bundled checksums.
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) initializeProxy();
await import('../node_modules/electron/install.js');

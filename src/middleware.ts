// Next.js requires the middleware to be the default export of this file.
// The actual logic lives in proxy.ts so it can be tested / reused separately.
export { proxy as middleware, config } from './proxy';

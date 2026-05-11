// Next.js requires `config` to be defined inline here — it cannot be
// re-exported from another module because Turbopack parses it statically.
export { proxy as middleware } from './proxy';

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};

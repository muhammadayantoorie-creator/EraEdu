const originalEnv = { ...process.env };
function load(overrides: Record<string, string | undefined> = {}) {
  process.env = { ...originalEnv, NODE_ENV: 'production', VERCEL: '1',
    FRONTEND_URL: 'https://school.test/EraEdu', ALLOWED_ORIGINS: '',
    SUPABASE_URL: 'https://school.supabase.co', SUPABASE_KEY: 'public-test-key',
    SUPABASE_SERVICE_KEY: 'server-test-key-at-least-twenty', JWT_SECRET: 'isolated-test-secret-at-least-32-characters', ...overrides };
  let config: any;
  jest.isolateModules(() => { config = require('../config/environment').config; });
  return config;
}
afterEach(() => { process.env = { ...originalEnv }; });

it('normalizes the app path separately from the credentialed CORS origin', () => {
  expect(load()).toMatchObject({ frontendAppUrl: 'https://school.test/EraEdu', frontendUrl: 'https://school.test' });
});
it('enforces placeholder validation when Vercel supplies the production fallback', () => {
  expect(() => load({ NODE_ENV: undefined, SUPABASE_URL: 'https://your-project.supabase.co' })).toThrow('placeholder');
});
it('normalizes the deployed whitespace-padded production setting for all consumers', () => {
  expect(load({ NODE_ENV: ' production ' }).nodeEnv).toBe('production');
  expect(process.env.NODE_ENV).toBe('production');
  expect(() => load({ NODE_ENV: ' production ', SUPABASE_SERVICE_KEY: '' })).toThrow('SUPABASE_SERVICE_KEY');
});
it('rejects a misspelled environment instead of enabling development behavior', () => {
  expect(() => load({ NODE_ENV: 'prodution' })).toThrow('NODE_ENV');
});
it.each(['http://school.test', 'https://localhost', 'https://[::1]', 'invalid', 'https://user:password@school.test', 'https://school.test?token=secret'])('rejects invalid production frontend URL %s', value => {
  expect(() => load({ FRONTEND_URL: value })).toThrow(/FATAL:.*FRONTEND_URL/);
});
it.each(['*', 'https://other.test/path', 'http://other.test', 'https://other.test?token=secret'])('rejects unusable or unsafe allowed origin %s', value => {
  expect(() => load({ ALLOWED_ORIGINS: value })).toThrow('FATAL: ALLOWED_ORIGINS');
});
it('accepts multiple exact HTTPS origins and rejects missing privileged credentials', () => {
  expect(load({ ALLOWED_ORIGINS: ' https://other.test/, https://preview.test ' }).additionalAllowedOrigins).toEqual(['https://other.test', 'https://preview.test']);
  expect(() => load({ SUPABASE_SERVICE_KEY: '' })).toThrow('SUPABASE_SERVICE_KEY');
});

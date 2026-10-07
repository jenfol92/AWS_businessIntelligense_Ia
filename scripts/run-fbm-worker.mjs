import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

/** External process, independent of browsers and Next request lifetimes. No startup on import. */
export async function runFbmWorkerTick({ baseUrl, secret }, transport = fetch) {
  const url = new URL(baseUrl);
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) ||
      (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('FBM_WORKER_INVALID_URL');
  if (!secret?.trim()) throw new Error('CRON_SECRET_MISSING');
  const invoke = async suffix => {
    try {
      const response = await transport(new URL('/api/cron/amazon/fbm-inventory-snapshot/' + suffix, url), {
        method: 'GET', redirect: 'error', headers: { authorization: `Bearer ${secret.trim()}` }, signal: AbortSignal.timeout(60000),
      });
      const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
      const known = ['IDLE', 'PENDING', 'PROCESSING', 'RATE_LIMITED', 'COMPLETED', 'FAILED', 'CANCELLED', 'FATAL', 'CREATE_UNCERTAIN', 'DISABLED'];
      return { httpStatus: response.status, status: known.includes(body?.status) ? body.status : 'UNAVAILABLE' };
    } catch { return { httpStatus: null, status: 'UNAVAILABLE' }; }
  };
  // The durable server gate owns daily eligibility. Recheck so completing an old job
  // does not postpone fresh evidence until tomorrow, and process restarts are harmless.
  const generation = await invoke('generate');
  const recovery = await invoke('recover');
  return { generation, recovery };
}

export async function serveFbmWorker(args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] !== '--serve') throw new Error('FBM_WORKER_EXPLICIT_SERVE_REQUIRED');
  const { loadEnvConfig } = (await import('@next/env')).default;
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production', { info() {}, error() {} });
  const config = { baseUrl: process.env.FBM_WORKER_BASE_URL || 'http://localhost:3000', secret: process.env.CRON_SECRET };
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    while (!controller.signal.aborted) {
      const result = await runFbmWorkerTick(config);
      console.info('[fbm-worker]', JSON.stringify(result));
      await sleep(60000, undefined, { signal: controller.signal });
    }
  } catch (error) { if (!controller.signal.aborted) throw error; }
  finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  serveFbmWorker().catch(() => { console.error('FBM_WORKER_STOPPED'); process.exitCode = 1; });
}

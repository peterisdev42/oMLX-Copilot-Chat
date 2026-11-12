import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as http from 'node:http';
import { Readable } from 'node:stream';

/**
 * Short-lived loopback bridge for the existing oMLX admin UI.
 *
 * A browser session requires a cookie. A Node fetch login does not put that
 * cookie into VS Code's isolated webview cookie jar. Instead, the bridge holds
 * the server-issued admin cookie in extension memory and forwards only to the
 * configured oMLX server. The API key is never sent to the webview.
 *
 * A one-time capability activates a partitioned, HttpOnly browser cookie.
 * Other local processes cannot use the authenticated bridge without it.
 */
export class AdminSessionProxy {
  private closed = false;

  private constructor(
    private readonly server: http.Server,
    readonly initialUrl: string,
    private readonly updateForwardedOrigin: (origin: string) => void
  ) {}

  /** Allow same-origin requests from VS Code's forwarded URL in SSH/WSL. */
  setForwardedOrigin(origin: string): void {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Unsupported forwarded proxy origin');
    }
    this.updateForwardedOrigin(parsed.origin);
  }

  static async open(apiBaseUrl: string, apiKey: string): Promise<AdminSessionProxy> {
    const upstream = new URL(apiBaseUrl);
    if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password) {
      throw new Error('Invalid oMLX admin address');
    }
    // Never transmit the main administrator key in cleartext over a network.
    if (upstream.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(upstream.hostname)) {
      throw new Error('Automatic admin login requires HTTPS for non-loopback servers');
    }

    const login = await fetch(new URL('/admin/api/login', upstream), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, remember: false }),
      redirect: 'manual',
      signal: AbortSignal.timeout(10000)
    });
    if (!login.ok) {
      // Never include the response body because an upstream server might echo
      // request data or other secrets.
      throw new Error(login.status === 401 || login.status === 403
        ? 'oMLX admin login requires the main API key (an inference sub-key cannot log in)'
        : 'oMLX admin login failed with HTTP ' + login.status);
    }
    const setCookie = login.headers.get('set-cookie') ?? '';
    const session = /(?:^|[,\s])omlx_admin_session=([^;,\s]+)/.exec(setCookie)?.[1];
    if (!session) {
      throw new Error('oMLX did not return an admin session cookie');
    }

    const ticket = randomBytes(32).toString('hex');
    const browserSecret = randomBytes(32).toString('hex');
    let ticketUsed = false;
    let backendSession: string | undefined = session;
    let serverPort = 0;
    let forwardedOrigin: string | undefined;

    const srv = http.createServer(async (request, response) => {
      const fail = (code: number) => {
        response.writeHead(code, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        });
        response.end('oMLX Home session is unavailable.');
      };
      const rawPath = request.url ?? '';
      if (!rawPath.startsWith('/') || rawPath.startsWith('//')) {
        fail(400);
        return;
      }
      const path = new URL(rawPath, 'http://127.0.0.1:' + serverPort);
      if (path.pathname === '/__omlx_start') {
        if (request.method !== 'GET' || ticketUsed ||
            path.searchParams.get('ticket') !== ticket) {
          fail(403);
          return;
        }
        ticketUsed = true;
        // Partitioned cookies are needed because VS Code nests our localhost
        // page inside a vscode-webview origin. The main key stays in Node.
        response.writeHead(302, {
          'Location': '/admin',
          'Set-Cookie': 'omlx_home_session=' + browserSecret +
            '; Path=/; HttpOnly; Secure; SameSite=None; Partitioned',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer'
        });
        response.end();
        return;
      }

      const browserCookie = /(?:^|;\s*)omlx_home_session=([^;]+)/.exec(
        request.headers.cookie ?? ''
      )?.[1] ?? '';
      const received = Buffer.from(browserCookie);
      const expected = Buffer.from(browserSecret);
      if (!backendSession || received.length !== expected.length ||
          !timingSafeEqual(received, expected)) {
        fail(403);
        return;
      }

      const origin = request.headers.origin;
      if (origin && origin !== 'http://127.0.0.1:' + serverPort &&
          origin !== 'https://127.0.0.1:' + serverPort &&
          origin !== forwardedOrigin) {
        // The forwarded remote proxy may have a different origin; only
        // same-origin browser calls (or calls without an Origin) are accepted.
        fail(403);
        return;
      }

      try {
        const url = new URL(path.pathname + path.search, upstream);
        // Do not let the untrusted Host or request URL change our target.
        const headers = new Headers();
        for (const name of ['accept', 'accept-language', 'content-type',
          'range', 'if-none-match', 'if-modified-since']) {
          const value = request.headers[name];
          if (typeof value === 'string') headers.set(name, value);
        }
        headers.set('Cookie', 'omlx_admin_session=' + backendSession);
        const hasBody = !['GET', 'HEAD'].includes(request.method ?? '');
        const init = {
          method: request.method,
          headers,
          body: hasBody ? request : undefined,
          duplex: hasBody ? 'half' : undefined,
          redirect: 'manual',
          signal: AbortSignal.timeout(120000)
        } as RequestInit & { duplex?: 'half' };
        const result = await fetch(url, init);

        const responseHeaders: Record<string, string> = {
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': result.headers.get('cache-control') ?? 'no-store'
        };
        for (const name of ['content-type', 'content-disposition',
          'etag', 'last-modified', 'content-range', 'accept-ranges']) {
          const value = result.headers.get(name);
          if (value) responseHeaders[name] = value;
        }
        const location = result.headers.get('location');
        if (location) {
          const target = new URL(location, upstream);
          if (target.origin !== upstream.origin) {
            fail(502);
            return;
          }
          responseHeaders.Location = target.pathname + target.search + target.hash;
        }
        // Upstream's cookie must never leave the extension process.
        response.writeHead(result.status, responseHeaders);
        if (result.body && request.method !== 'HEAD') {
          await new Promise<void>((resolve, reject) => {
            const stream = Readable.fromWeb(result.body as import('node:stream/web').ReadableStream);
            stream.on('error', reject);
            response.on('error', reject);
            response.on('finish', resolve);
            stream.pipe(response);
          });
        } else {
          response.end();
        }

        if (path.pathname === '/admin/api/logout' && result.ok) {
          backendSession = undefined;
        }
      } catch {
        if (!response.headersSent) fail(502);
        else response.destroy();
      }
    });
    srv.on('upgrade', (_request, socket) => socket.destroy());

    try {
      await new Promise<void>((resolve, reject) => {
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => {
          srv.removeListener('error', reject);
          resolve();
        });
      });
      const address = srv.address();
      if (!address || typeof address === 'string') {
        throw new Error('Could not bind a local oMLX session bridge');
      }
      serverPort = address.port;
      return new AdminSessionProxy(
        srv,
        'http://127.0.0.1:' + serverPort + '/__omlx_start?ticket=' + ticket,
        origin => { forwardedOrigin = origin; }
      );
    } catch (error) {
      srv.close();
      throw error;
    }
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.server.closeAllConnections();
    this.server.close();
  }
}

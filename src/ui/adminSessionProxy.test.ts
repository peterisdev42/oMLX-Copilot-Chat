import assert from 'node:assert/strict';
import * as http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { AdminSessionProxy } from './adminSessionProxy';

test('oMLX admin bridge logs in with a main key, preserves session in Node, and rejects unauthenticated requests', async () => {
  const upstreamRequests: Array<{ path: string; cookie?: string; authorization?: string }> = [];
  const server = http.createServer(async (req, res) => {
    const path = req.url ?? '';
    upstreamRequests.push({
      path,
      cookie: req.headers.cookie,
      authorization: req.headers.authorization
    });
    if (path === '/admin/api/login') {
      let body = '';
      for await (const data of req) body += data.toString();
      const { api_key } = JSON.parse(body) as { api_key: string };
      if (api_key !== 'main-secret-key') {
        res.writeHead(401);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'omlx_admin_session=signed-session; HttpOnly; Path=/'
      });
      res.end('{}');
      return;
    }
    if (req.headers.cookie !== 'omlx_admin_session=signed-session') {
      res.writeHead(401);
      res.end('No admin session');
      return;
    }
    if (path === '/admin/api/logout') {
      res.writeHead(200);
      res.end('{}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>oMLX admin dashboard</h1>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  let bridge: AdminSessionProxy | undefined;
  try {
    const backend = 'http://127.0.0.1:' + address.port;
    await assert.rejects(
      AdminSessionProxy.open(backend, 'inference-sub-key'),
      /main API key/
    );
    bridge = await AdminSessionProxy.open(backend, 'main-secret-key');
    assert.ok(!bridge.initialUrl.includes('main-secret-key'));
    const bootstrap = await fetch(bridge.initialUrl, { redirect: 'manual' });
    assert.equal(bootstrap.status, 302);
    assert.equal(bootstrap.headers.get('location'), '/admin');
    const cookie = bootstrap.headers.get('set-cookie')?.split(';')[0];
    assert.match(cookie ?? '', /^omlx_home_session=[a-f0-9]{64}$/);

    const bridgeBase = new URL(bridge.initialUrl).origin;
    assert.equal((await fetch(bridgeBase + '/admin')).status, 403);
    assert.equal((await fetch(bridge.initialUrl, { redirect: 'manual' })).status, 403);

    const authenticated = await fetch(bridgeBase + '/admin', {
      headers: { Cookie: cookie ?? '' }
    });
    assert.equal(authenticated.status, 200);
    const page = await authenticated.text();
    assert.match(page, /oMLX admin dashboard/);
    assert.ok(!page.includes('main-secret-key'));

    assert.equal(upstreamRequests.at(-1)?.cookie, 'omlx_admin_session=signed-session');
    assert.equal(upstreamRequests.at(-1)?.authorization, undefined);

    const logout = await fetch(bridgeBase + '/admin/api/logout', {
      method: 'POST', headers: { Cookie: cookie ?? '' }
    });
    assert.equal(logout.status, 200);
    assert.equal((await fetch(bridgeBase + '/admin', {
      headers: { Cookie: cookie ?? '' }
    })).status, 403);
  } finally {
    bridge?.dispose();
    server.close();
    await once(server, 'close');
  }
});

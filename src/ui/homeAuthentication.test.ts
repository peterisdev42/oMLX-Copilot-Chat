import assert from 'node:assert/strict';
import Module from 'node:module';
import { test } from 'node:test';

test('Home uses saved main key invisibly and offers a native, pasteable input for sub-keys', async () => {
  const made: Array<{ webview: {
    html: string; onDidReceiveMessage(fn: (message: unknown) => void): void;
  }; dispose(): void; onMessage?: (message: unknown) => void }> = [];
  const adminKeys: string[] = [];
  const loginCalls: string[] = [];
  let storedAdminKey: string | undefined;
  let disposedProxies = 0;

  const mockedProxy = {
    AdminSessionProxy: {
      open: async (_url: string, token: string) => {
        loginCalls.push(token);
        if (token !== 'main-admin-key') throw new Error('Subkey rejected');
        return {
          initialUrl: 'http://127.0.0.1:42424/__omlx_start?ticket=one-time',
          setForwardedOrigin(origin: string) {
            assert.equal(origin, 'http://127.0.0.1:42424');
          },
          dispose() { disposedProxies++; }
        };
      }
    }
  };
  const mockedVscode = {
    Uri: { parse: (value: string) => ({ toString: () => value }) },
    env: { asExternalUri: async (uri: { toString(): string }) => uri },
    ViewColumn: { Active: -1 },
    window: {
      createWebviewPanel: () => {
        let onDispose: (() => void) | undefined;
        const panel = {
          webview: {
            html: '',
            onDidReceiveMessage(fn: (message: unknown) => void) {
              panel.onMessage = fn;
            }
          },
          onMessage: undefined as ((message: unknown) => void) | undefined,
          reveal() {},
          onDidDispose(fn: () => void) {
            onDispose = fn;
          },
          dispose() { onDispose?.(); }
        };
        made.push(panel);
        return panel;
      },
      showErrorMessage: (_message: string) => undefined,
      showInputBox: async () => 'main-admin-key'
    }
  };
  const loader = Module as unknown as {
    _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
  };
  const load = loader._load;
  loader._load = function (request, parent, isMain) {
    if (request === 'vscode') return mockedVscode;
    if (request === './adminSessionProxy') return mockedProxy;
    return load.call(this, request, parent, isMain);
  };

  try {
    const { HomePanel } = require('./homePanel') as typeof import('./homePanel');
    const config = {
      settings: { baseUrl: 'http://127.0.0.1:8000/v1' },
      getAdminApiToken: async () => storedAdminKey,
      getApiToken: async () => 'inference-sub-key',
      setAdminApiToken: async (key: string) => {
        adminKeys.push(key);
        storedAdminKey = key;
      }
    };
    const home = new HomePanel(config as unknown as ConstructorParameters<typeof HomePanel>[0]);
    await home.show();
    assert.deepEqual(loginCalls, ['inference-sub-key']);
    assert.equal(made.length, 1);
    assert.match(made[0].webview.html, /Set admin API key/);
    assert.doesNotMatch(made[0].webview.html, /inference-sub-key/);

    // Native input submits only a command message from the webview.
    made[0].onMessage?.({ type: 'setAdminToken' });
    for (let i = 0; made.length < 2 && i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(made.length, 2);
    assert.deepEqual(adminKeys, ['main-admin-key']);
    assert.deepEqual(loginCalls, ['inference-sub-key', 'main-admin-key']);
    assert.match(made[1].webview.html, /__omlx_start\?ticket=one-time/);
    assert.doesNotMatch(made[1].webview.html, /main-admin-key/);
    assert.doesNotMatch(made[1].webview.html, /Set admin API key/);

    home.dispose();
    assert.equal(disposedProxies, 1);
  } finally {
    loader._load = load;
  }
});

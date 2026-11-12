import assert from 'node:assert/strict';
import Module from 'node:module';
import { test } from 'node:test';

test('Home opens a single full-size editor webview, forwards localhost, and can reopen', async () => {
  const errors: string[] = [];
  const forwardedPaths: string[] = [];
  const panels: Array<{
    webview: { html: string };
    reveal(): void;
    dispose(): void;
  }> = [];
  let revealCount = 0;
  const mockedVscode = {
    ViewColumn: { Active: -1 },
    Uri: {
      parse: (value: string) => ({ toString: () => value })
    },
    env: {
      asExternalUri: async (uri: { toString(): string }) => {
        forwardedPaths.push(uri.toString());
        return { toString: () => 'https://remote.example.test/proxy/8000/admin' };
      }
    },
    window: {
      createWebviewPanel: (
        type: string,
        title: string,
        column: number,
        options: { enableScripts: boolean; retainContextWhenHidden: boolean; localResourceRoots: unknown[] }
      ) => {
        assert.equal(type, 'omlx.home');
        assert.equal(title, 'oMLX Home');
        assert.equal(column, -1);
        assert.equal(options.enableScripts, true);
        assert.equal(options.retainContextWhenHidden, true);
        assert.deepEqual(options.localResourceRoots, []);
        let disposeListener: (() => void) | undefined;
        const panel = {
          webview: { html: '' },
          reveal: () => { revealCount++; },
          onDidDispose: (listener: () => void) => {
            disposeListener = listener;
            return { dispose() {} };
          },
          dispose: () => disposeListener?.()
        };
        panels.push(panel);
        return panel;
      },
      showErrorMessage: (message: string) => {
        errors.push(message);
        return Promise.resolve(undefined);
      }
    }
  };

  const loader = Module as unknown as {
    _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
  };
  const originalLoad = loader._load;
  loader._load = function (request, parent, isMain) {
    if (request === 'vscode') {
      return mockedVscode;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const { HomePanel } = require('./homePanel') as typeof import('./homePanel');
    const configuration = {
      settings: { baseUrl: 'http://127.0.0.1:8000/v1?key=secret' }
    } as unknown as ConstructorParameters<typeof HomePanel>[0];
    const home = new HomePanel(configuration);

    // Concurrent opening and repeated clicks must not create extra panels.
    await Promise.all([home.show(), home.show()]);
    assert.equal(panels.length, 1);
    assert.deepEqual(forwardedPaths, ['http://127.0.0.1:8000/admin']);
    assert.match(panels[0].webview.html, /<iframe title="oMLX administration dashboard"/);
    assert.match(panels[0].webview.html, /src="https:\/\/remote\.example\.test\/proxy\/8000\/admin"/);
    assert.match(panels[0].webview.html, /frame-src https:\/\/remote\.example\.test/);
    assert.match(panels[0].webview.html, /width:100%;height:100%;border:0/);
    assert.doesNotMatch(panels[0].webview.html, /simpleBrowser|address-bar/);

    await home.show();
    assert.equal(panels.length, 1);
    assert.equal(revealCount, 1);

    panels[0].dispose();
    await home.show();
    assert.equal(panels.length, 2);
    home.dispose();

    const invalid = new HomePanel({
      settings: { baseUrl: 'file:///private/secret' }
    } as unknown as ConstructorParameters<typeof HomePanel>[0]);
    await invalid.show();
    assert.equal(panels.length, 2);
    assert.ok(errors.some(message => message.includes('base URL is invalid')));
    invalid.dispose();
  } finally {
    loader._load = originalLoad;
  }
});

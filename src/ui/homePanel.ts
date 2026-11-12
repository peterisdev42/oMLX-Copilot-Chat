import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { OmlxConfiguration } from '../config/OmlxConfiguration';
import { AdminSessionProxy } from './adminSessionProxy';

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>']/g, char => ({
    '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;', "'": '&#39;'
  })[char] ?? char);
}

/**
 * Renders oMLX Home as a tab. The original oMLX admin app stays in charge of
 * its dashboard. A local session bridge, when possible, avoids exposing the
 * saved administrator key to browser JS or requiring login through an iframe.
 */
export class HomePanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private proxy: AdminSessionProxy | undefined;
  private opening: Promise<void> | undefined;
  private disposed = false;

  constructor(private readonly configuration: OmlxConfiguration) {}

  show(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.panel) {
      this.panel.reveal();
      return Promise.resolve();
    }
    if (!this.opening) {
      this.opening = this.open().finally(() => { this.opening = undefined; });
    }
    return this.opening;
  }

  private async open(): Promise<void> {
    let admin: URL;
    try {
      admin = new URL(this.configuration.settings.baseUrl);
      if (!['http:', 'https:'].includes(admin.protocol) || admin.username || admin.password) {
        throw new Error('An HTTP(S) URL without embedded credentials is required');
      }
      admin.pathname = '/admin';
      admin.search = '';
      admin.hash = '';
    } catch {
      void vscode.window.showErrorMessage('The oMLX base URL is invalid. Update it in oMLX Settings.');
      return;
    }

    let proxy: AdminSessionProxy | undefined;
    let needsLogin = true;
    try {
      const mainKey = await this.configuration.getAdminApiToken?.();
      const inferenceKey = await this.configuration.getApiToken?.();
      const key = mainKey || inferenceKey;
      if (key) {
        try {
          proxy = await AdminSessionProxy.open(admin.toString(), key);
          needsLogin = false;
        } catch {
          // A stored inference-only sub-key is not an admin credential.
          // Do not expose error bodies or raw secrets in the webview.
        }
      }
      const webUri = vscode.Uri.parse(proxy?.initialUrl ?? admin.toString());
      const forwarded = await vscode.env.asExternalUri(webUri);
      const frameUrl = forwarded.toString(true);
      const frame = new URL(frameUrl);
      if (!['http:', 'https:'].includes(frame.protocol) || frame.username || frame.password) {
        throw new Error('The forwarded Home URL must use HTTP(S) without credentials');
      }
      if (this.disposed) {
        proxy?.dispose();
        return;
      }
      proxy?.setForwardedOrigin(frame.origin);

      const panel = vscode.window.createWebviewPanel(
        'omlx.home', 'oMLX Home', vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] }
      );
      this.proxy = proxy;
      this.panel = panel;
      panel.onDidDispose(() => {
        if (this.panel === panel) {
          this.panel = undefined;
          this.proxy?.dispose();
          this.proxy = undefined;
        }
      });
      panel.webview.onDidReceiveMessage?.(message => {
        if (message && typeof message === 'object' && message.type === 'setAdminToken') {
          void this.promptAdminKey();
        }
      });
      panel.webview.html = this.render(frameUrl, frame.origin, needsLogin);
    } catch (error) {
      proxy?.dispose();
      void vscode.window.showErrorMessage('Cannot open oMLX Home: ' + String(error));
    }
  }

  private async promptAdminKey(): Promise<void> {
    const input = await vscode.window.showInputBox({
      title: 'Sign in to oMLX Home',
      prompt: 'Paste the MAIN oMLX API key (a /v1 inference sub-key cannot access admin).',
      password: true,
      ignoreFocusOut: true,
      validateInput: value => value.trim() ? undefined : 'Enter the main oMLX API key.'
    });
    if (input === undefined || !input.trim()) return;
    await this.configuration.setAdminApiToken(input);
    this.panel?.dispose();
    if (!this.disposed) await this.show();
  }

  private render(frameUrl: string, origin: string, needsLogin: boolean): string {
    const nonce = randomBytes(16).toString('base64');
    const showNativeAuth = needsLogin
      ? '<div class="toolbar"><span>Sign in using a native VS Code input (paste works on macOS).</span>' +
        '<button id="admin-token">Set admin API key</button></div>'
      : '';
    const css =
      'html,body{height:100%;width:100%;margin:0;padding:0;overflow:hidden;' +
      'background:var(--vscode-editor-background);color:var(--vscode-foreground);' +
      'font:var(--vscode-font-size) var(--vscode-font-family)}' +
      'iframe{display:block;width:100%;height:100%;border:0}' +
      '.toolbar{position:absolute;z-index:2;top:12px;right:12px;display:flex;' +
      'align-items:center;gap:10px;background:var(--vscode-editor-background);' +
      'border:1px solid var(--vscode-panel-border);border-radius:8px;padding:8px 12px;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.15);font-size:12px}' +
      'button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);' +
      'border:0;border-radius:4px;padding:6px 10px;cursor:pointer}';

    const script = needsLogin
      ? '<script nonce="' + nonce + '">' +
        'const vscode=acquireVsCodeApi();' +
        'document.getElementById("admin-token").addEventListener("click",()=>{' +
        'vscode.postMessage({type:"setAdminToken"});});' +
        '</script>'
      : '';

    return [
      '<!DOCTYPE html><html lang="en"><head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; frame-src ',
      escapeAttribute(origin), '; style-src \'nonce-', nonce,
      '\'; script-src \'nonce-', nonce, '\';">',
      '<title>oMLX Home</title>',
      '<style nonce="', nonce, '">', css, '</style></head><body>',
      '<iframe title="oMLX administration dashboard" src="', escapeAttribute(frameUrl),
      '" referrerpolicy="no-referrer" allow="clipboard-read; clipboard-write"></iframe>',
      showNativeAuth,
      script,
      '</body></html>'
    ].join('');
  }

  dispose(): void {
    this.disposed = true;
    this.panel?.dispose();
    this.panel = undefined;
    this.proxy?.dispose();
    this.proxy = undefined;
  }
}

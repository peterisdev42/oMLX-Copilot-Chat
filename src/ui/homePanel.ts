import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { OmlxConfiguration } from '../config/OmlxConfiguration';

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>']/g, char => ({
    '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;', "'": '&#39;'
  })[char] ?? char);
}

/**
 * Renders the existing oMLX administration UI in a full-size editor tab.
 * The app stays hosted by oMLX; no browser toolbar or URL field is added.
 */
export class HomePanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private opening: Promise<void> | undefined;
  private disposed = false;

  constructor(private readonly configuration: OmlxConfiguration) {}

  show(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    if (this.panel) {
      this.panel.reveal();
      return Promise.resolve();
    }
    if (!this.opening) {
      this.opening = this.open().finally(() => {
        this.opening = undefined;
      });
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

    try {
      // Forward the local service when VS Code runs against SSH, WSL, or a container.
      const forwarded = await vscode.env.asExternalUri(vscode.Uri.parse(admin.toString()));
      const frameUrl = forwarded.toString(true);
      const frame = new URL(frameUrl);
      if (!['http:', 'https:'].includes(frame.protocol) || frame.username || frame.password) {
        throw new Error('The forwarded Home URL must use HTTP(S) without credentials');
      }
      if (this.disposed) {
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        'omlx.home',
        'oMLX Home',
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: []
        }
      );
      this.panel = panel;
      panel.onDidDispose(() => {
        if (this.panel === panel) {
          this.panel = undefined;
        }
      });

      // Restrict the outer webview to the forwarded admin origin. The embedded
      // oMLX app owns its own JS, assets, authentication, and routing.
      const nonce = randomBytes(16).toString('base64');
      panel.webview.html = [
        '<!DOCTYPE html><html lang="en"><head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; frame-src ',
        escapeAttribute(frame.origin), '; style-src \'nonce-', nonce, '\';">',
        '<title>oMLX Home</title>',
        '<style nonce="', nonce, '">',
        'html,body{height:100%;width:100%;margin:0;padding:0;overflow:hidden;',
        'background:var(--vscode-editor-background)}',
        'iframe{display:block;width:100%;height:100%;border:0}',
        '</style></head><body>',
        '<iframe title="oMLX administration dashboard" src="', escapeAttribute(frameUrl),
        '" referrerpolicy="no-referrer"></iframe>',
        '</body></html>'
      ].join('');
    } catch (error) {
      void vscode.window.showErrorMessage('Cannot open oMLX Home: ' + String(error));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.panel?.dispose();
    this.panel = undefined;
  }
}

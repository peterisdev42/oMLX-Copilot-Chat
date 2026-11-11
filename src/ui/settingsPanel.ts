import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { OmlxConfiguration } from '../config/OmlxConfiguration';

type SettingType = 'string' | 'number' | 'boolean';
type SettingsScope = 'user' | 'workspace';

interface SettingDefinition {
  readonly type: SettingType;
  readonly description?: string;
  readonly default?: unknown;
  readonly minimum?: number;
  readonly maximum?: number;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char] ?? char);
}

function headingForKey(key: string): string {
  return key.slice('omlx.'.length).replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, letter => letter.toUpperCase());
}

function groupForKey(key: string): string {
  if (key === 'omlx.baseUrl' || key === 'omlx.requestTimeoutMs') {
    return 'Connection';
  }
  if (key.endsWith('TokensOverride') || key === 'omlx.maxToolCount') {
    return 'Limits';
  }
  if (key.startsWith('omlx.enable')) {
    return 'Capabilities';
  }
  return 'Other settings';
}

export class SettingsPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private scope: SettingsScope = 'user';
  private renderSequence = 0;
  private readonly configListener: vscode.Disposable;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly configuration: OmlxConfiguration
  ) {
    this.configListener = vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('omlx')) {
        void this.refresh();
      }
    });
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'omlx.settings',
      'oMLX Settings',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel = panel;
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = undefined;
        this.renderSequence++;
      }
    });
    panel.webview.onDidReceiveMessage(message => void this.onMessage(message));
    void this.refresh();
  }

  dispose(): void {
    this.configListener.dispose();
    this.panel?.dispose();
  }

  private definitions(): Record<string, SettingDefinition> {
    const properties = this.context.extension.packageJSON?.contributes?.configuration?.properties as
      Record<string, SettingDefinition> | undefined;
    return Object.fromEntries(Object.entries(properties ?? {}).filter(
      ([key, def]) => key.startsWith('omlx.') &&
        (def.type === 'string' || def.type === 'number' || def.type === 'boolean')
    ));
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') {
      return;
    }
    const message = raw as { type?: unknown; scope?: unknown; key?: unknown; value?: unknown; action?: unknown };

    if (message.type === 'scope') {
      if (message.scope === 'user' ||
          (message.scope === 'workspace' && vscode.workspace.workspaceFolders?.length)) {
        this.scope = message.scope;
        await this.refresh();
      }
      return;
    }

    if (message.type === 'action') {
      const commands: Record<string, string> = {
        setToken: 'omlx.setApiToken',
        clearToken: 'omlx.clearApiToken',
        testConnection: 'omlx.testConnection',
        refreshModels: 'omlx.refreshModels',
        home: 'omlx.openHome'
      };
      if (typeof message.action === 'string' && commands[message.action]) {
        await vscode.commands.executeCommand(commands[message.action]);
        await this.refresh();
      }
      return;
    }

    if ((message.type !== 'save' && message.type !== 'reset') ||
        typeof message.key !== 'string') {
      return;
    }

    const definition = this.definitions()[message.key];
    if (!definition || (this.scope === 'workspace' && !vscode.workspace.workspaceFolders?.length)) {
      return;
    }

    try {
      let value: string | number | boolean | undefined;
      if (message.type === 'save') {
        if (definition.type === 'string' && typeof message.value === 'string') {
          value = message.value;
        } else if (definition.type === 'boolean' && typeof message.value === 'boolean') {
          value = message.value;
        } else if (definition.type === 'number' && typeof message.value === 'number' &&
          Number.isFinite(message.value) &&
          (definition.minimum === undefined || message.value >= definition.minimum) &&
          (definition.maximum === undefined || message.value <= definition.maximum)) {
          value = message.value;
        } else {
          throw new Error('Invalid value for ' + message.key);
        }
      }

      await vscode.workspace.getConfiguration('omlx').update(
        message.key.slice('omlx.'.length),
        value,
        this.scope === 'user' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace
      );
      await this.refresh();
    } catch (error) {
      void vscode.window.showErrorMessage('Could not update oMLX setting: ' + String(error));
    }
  }

  private async refresh(): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    const current = ++this.renderSequence;
    const hasToken = Boolean(await this.configuration.getApiToken());
    if (this.panel !== panel || current !== this.renderSequence) {
      return;
    }
    panel.webview.html = this.render(panel.webview, hasToken);
  }

  private render(webview: vscode.Webview, hasToken: boolean): string {
    const definitions = this.definitions();
    const config = vscode.workspace.getConfiguration('omlx');
    const entries = Object.entries(definitions);
    const orderedGroups = ['Connection', 'Limits', 'Capabilities', 'Other settings'];
    const groups = orderedGroups.map(group => {
      const rows = entries.filter(([key]) => groupForKey(key) === group).map(([key, def]) => {
        const inspected = config.inspect(key.slice('omlx.'.length));
        const selectedValue = this.scope === 'user'
          ? inspected?.globalValue ?? inspected?.defaultValue ?? def.default
          : inspected?.workspaceValue ?? inspected?.globalValue ?? inspected?.defaultValue ?? def.default;
        const custom = this.scope === 'user'
          ? inspected?.globalValue !== undefined
          : inspected?.workspaceValue !== undefined;
        const overridden = this.scope === 'user' && inspected?.workspaceValue !== undefined;
        const attrs = `data-input="${escapeHtml(key)}" data-type="${escapeHtml(def.type)}"`;
        const field = def.type === 'boolean'
          ? `<label class="toggle"><input type="checkbox" ${attrs} ${selectedValue ? 'checked' : ''}/><span>Enabled</span></label>`
          : `<input class="field" ${attrs} type="${def.type === 'number' ? 'number' : 'text'}" ` +
            `value="${escapeHtml(selectedValue)}" ${def.minimum !== undefined ? `min="${def.minimum}"` : ''} ` +
            `${def.maximum !== undefined ? `max="${def.maximum}"` : ''} ${def.type === 'number' ? 'step="any"' : ''}/>`;
        return `<section class="setting">
          <div class="setting-heading"><div><strong>${escapeHtml(headingForKey(key))}</strong>
            <span class="setting-key">${escapeHtml(key)}</span></div>
            ${custom ? '<span class="tag">Customized</span>' : ''}
          </div>
          <p class="description">${escapeHtml(def.description)}</p>
          <div class="controls">${field}
            <button data-action="save" data-key="${escapeHtml(key)}">Save</button>
            <button class="secondary" data-action="reset" data-key="${escapeHtml(key)}">Reset</button>
          </div>
          ${overridden ? '<p class="note">A workspace setting currently overrides this user value.</p>' : ''}
        </section>`;
      }).join('');
      return rows ? `<div class="section"><h2>${escapeHtml(group)}</h2><div class="section-content">${rows}</div></div>` : '';
    }).join('');

    const nonce = crypto.randomBytes(16).toString('hex');
    const workspaceAvailable = Boolean(vscode.workspace.workspaceFolders?.length);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>oMLX Settings</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: var(--vscode-font-weight) var(--vscode-font-size) var(--vscode-font-family);
    color: var(--vscode-foreground); background: var(--vscode-editor-background);
    padding: 28px clamp(18px, 5vw, 56px); margin: 0; }
  main { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 24px; font-weight: 600; margin: 0 0 8px; }
  h2 { font-size: 15px; font-weight: 600; margin: 0; }
  p { line-height: 1.55; }
  .subhead { color: var(--vscode-descriptionForeground); margin: 0 0 26px; }
  .toolbar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:24px; }
  .toolbar label { color: var(--vscode-descriptionForeground); }
  select, input.field { color: var(--vscode-input-foreground);
    background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 4px; padding: 8px 10px; font: inherit; outline: none; min-width: 0; }
  select:focus, input.field:focus { border-color: var(--vscode-focusBorder); }
  input.field { flex:1; min-width:160px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border:1px solid transparent; border-radius:4px; font:inherit; padding:7px 12px; cursor:pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:focus-visible { outline:1px solid var(--vscode-focusBorder); outline-offset:2px; }
  button.secondary { background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .section { border:1px solid var(--vscode-panel-border); border-radius:8px; margin:18px 0;
    overflow:hidden; }
  .section h2 { padding:14px 18px; background:var(--vscode-sideBar-background); }
  .setting { padding:18px; border-top:1px solid var(--vscode-panel-border); }
  .setting-heading { display:flex; align-items:start; justify-content:space-between; gap:12px; }
  .setting-key { color:var(--vscode-descriptionForeground); display:block; margin-top:4px;
    font-family:var(--vscode-editor-font-family); font-size:12px; }
  .description, .note { color:var(--vscode-descriptionForeground); font-size:13px; margin:9px 0 14px; }
  .note { margin:8px 0 0; }
  .controls { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
  .toggle { display:flex; align-items:center; gap:8px; flex:1; min-width:140px; }
  .toggle input { accent-color:var(--vscode-checkbox-selectBackground, var(--vscode-focusBorder)); }
  .tag { color:var(--vscode-descriptionForeground); border:1px solid var(--vscode-panel-border);
    border-radius:30px; padding:3px 8px; font-size:11px; }
  .token-actions { display:flex; flex-wrap:wrap; gap:8px; }
  .token-state { margin-top:12px; color:var(--vscode-descriptionForeground); }
  @media (max-width: 540px) { body { padding:16px; } .setting { padding:14px; } }
</style>
</head>
<body>
<main>
  <h1>oMLX Copilot Chat</h1>
  <p class="subhead">Manage the local inference connection and model capabilities. Changes are saved to VS Code settings.</p>
  <div class="toolbar">
    <label for="scope">Settings scope</label>
    <select id="scope">
      <option value="user" ${this.scope === 'user' ? 'selected' : ''}>User</option>
      <option value="workspace" ${this.scope === 'workspace' ? 'selected' : ''}
        ${workspaceAvailable ? '' : 'disabled'}>Workspace</option>
    </select>
    <button class="secondary" data-action="home">Open Home</button>
  </div>
  <div class="section">
    <h2>API Token</h2>
    <div class="setting">
      <p class="description">Token credentials are stored in VS Code Secret Storage, never in settings.json or this page.</p>
      <div class="token-actions">
        <button data-action="setToken">Set Token</button>
        <button class="secondary" data-action="clearToken">Clear Token</button>
        <button class="secondary" data-action="testConnection">Test Connection</button>
        <button class="secondary" data-action="refreshModels">Refresh Models</button>
      </div>
      <p class="token-state">Status: ${hasToken ? 'Token stored' : 'No token stored'}</p>
    </div>
  </div>
  ${groups}
</main>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById('scope').addEventListener('change', event => {
    vscode.postMessage({ type: 'scope', scope: event.target.value });
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const key = button.dataset.key;
    if (action === 'save') {
      const input = [...document.querySelectorAll('[data-input]')]
        .find(element => element.dataset.input === key);
      if (!input) return;
      let value;
      if (input.dataset.type === 'boolean') {
        value = input.checked;
      } else if (input.dataset.type === 'number') {
        if (input.value.trim() === '' || !input.checkValidity()) {
          input.reportValidity();
          return;
        }
        value = Number(input.value);
      } else {
        value = input.value;
      }
      vscode.postMessage({ type: 'save', key, value });
    } else if (action === 'reset') {
      vscode.postMessage({ type: 'reset', key });
    } else {
      vscode.postMessage({ type: 'action', action });
    }
  });
</script>
</body>
</html>`;
  }
}

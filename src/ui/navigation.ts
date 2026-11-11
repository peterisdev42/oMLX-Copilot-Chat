import * as vscode from 'vscode';
import { OmlxConfiguration } from '../config/OmlxConfiguration';
import { SettingsPanel } from './settingsPanel';

class QuickAccessTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }

  getChildren(): vscode.TreeItem[] {
    const home = new vscode.TreeItem('Home', vscode.TreeItemCollapsibleState.None);
    home.iconPath = new vscode.ThemeIcon('home');
    home.tooltip = 'Open the oMLX administration dashboard in the VS Code browser';
    home.command = { command: 'omlx.openHome', title: 'oMLX: Home' };

    const settings = new vscode.TreeItem('Settings', vscode.TreeItemCollapsibleState.None);
    settings.iconPath = new vscode.ThemeIcon('settings-gear');
    settings.tooltip = 'Configure oMLX Copilot Chat';
    settings.command = { command: 'omlx.openSettings', title: 'oMLX: Settings' };
    return [home, settings];
  }
}

export function registerNavigation(
  context: vscode.ExtensionContext,
  configuration: OmlxConfiguration
): void {
  const settingsPanel = new SettingsPanel(context, configuration);
  context.subscriptions.push(settingsPanel);
  context.subscriptions.push(
    vscode.window.createTreeView('omlx.navigation', {
      treeDataProvider: new QuickAccessTreeProvider()
    }),
    vscode.commands.registerCommand('omlx.openHome', async () => {
      let admin: vscode.Uri;
      try {
        const url = new URL(configuration.settings.baseUrl);
        url.pathname = '/admin';
        url.search = '';
        url.hash = '';
        admin = vscode.Uri.parse(url.toString());
      } catch {
        void vscode.window.showErrorMessage('The oMLX base URL is invalid. Update it in oMLX Settings.');
        return;
      }

      // VS Code's built-in browser uses an editor panel, and routes to the
      // integrated browser where that feature is available.
      const resolved = await vscode.env.asExternalUri(admin);
      try {
        await vscode.commands.executeCommand('simpleBrowser.show', resolved.toString(true));
      } catch (error) {
        const choice = await vscode.window.showErrorMessage(
          `Cannot open the oMLX dashboard inside VS Code: ${String(error)}`,
          'Open External Browser'
        );
        if (choice === 'Open External Browser') {
          await vscode.env.openExternal(resolved);
        }
      }
    }),
    vscode.commands.registerCommand('omlx.openSettings', () => settingsPanel.show())
  );
}

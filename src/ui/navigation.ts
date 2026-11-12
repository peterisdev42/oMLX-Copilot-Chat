import * as vscode from 'vscode';
import { OmlxConfiguration } from '../config/OmlxConfiguration';
import { SettingsPanel } from './settingsPanel';
import { HomePanel } from './homePanel';

class QuickAccessTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }

  getChildren(): vscode.TreeItem[] {
    const home = new vscode.TreeItem('Home', vscode.TreeItemCollapsibleState.None);
    home.iconPath = new vscode.ThemeIcon('home');
    home.tooltip = 'Open the oMLX administration dashboard in a VS Code editor tab';
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
  // Register the actual provider immediately; creating optional UI services or
  // commands later must not stop the contributed TreeView from finding it.
  context.subscriptions.push(
    vscode.window.createTreeView('omlx.navigation', {
      treeDataProvider: new QuickAccessTreeProvider()
    })
  );

  const homePanel = new HomePanel(configuration);
  const settingsPanel = new SettingsPanel(context, configuration);
  context.subscriptions.push(homePanel, settingsPanel);
  context.subscriptions.push(
    vscode.commands.registerCommand('omlx.openHome', () => homePanel.show()),
    vscode.commands.registerCommand('omlx.openSettings', () => settingsPanel.show())
  );
}

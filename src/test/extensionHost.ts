import assert from 'node:assert/strict';
import * as vscode from 'vscode';

/**
 * Executed inside a real VS Code Extension Development Host.
 * Verifies manifest-to-runtime activation, which a mocked VS Code API cannot test.
 */
export async function run(): Promise<void> {
  const id = 'techopolis.omlx-copilot-chat';
  const extension = vscode.extensions.getExtension(id);
  assert.ok(extension, `Development extension ${id} must be installed in the test host`);
  await extension.activate();
  assert.equal(extension.isActive, true, 'Extension activation must succeed');

  const commands = await vscode.commands.getCommands(true);
  for (const command of ['omlx.openHome', 'omlx.openSettings']) {
    assert.ok(commands.includes(command), `Missing registered command ${command}`);
  }

  // These commands exist only for contributed view containers / views.
  // They also force the real workbench to instantiate and reveal the view.
  await vscode.commands.executeCommand('workbench.view.extension.omlx');
  await vscode.commands.executeCommand('omlx.navigation.focus');

  // Home uses a webview editor rather than the Simple Browser. It can be
  // created without a running oMLX backend (the iframe may show a connection error).
  await vscode.commands.executeCommand('omlx.openHome');
  const homeTabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
    tab.input instanceof vscode.TabInputWebview && tab.input.viewType === 'omlx.home'
  );
  assert.equal(homeTabs.length, 1, 'Home must open a dedicated oMLX webview editor');
  await vscode.commands.executeCommand('omlx.openHome');
  const repeatedHomeTabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
    tab.input instanceof vscode.TabInputWebview && tab.input.viewType === 'omlx.home'
  );
  assert.equal(repeatedHomeTabs.length, 1, 'Repeated Home clicks must reuse the tab');

  // Settings is independent of oMLX backend and Copilot Chat. It must work
  // in the strictly isolated Extension Development Host.
  await vscode.commands.executeCommand('omlx.openSettings');
}

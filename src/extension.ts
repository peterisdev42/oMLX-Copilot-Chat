import * as vscode from 'vscode';
import { registerConnectionCommands } from './commands/testConnection';
import { registerManageProviderCommand } from './commands/manageProvider';
import { registerTokenCommands } from './commands/manageToken';
import { OmlxConfiguration } from './config/OmlxConfiguration';
import { OmlxLanguageModelProvider } from './provider/OmlxLanguageModelProvider';
import { registerNavigation } from './ui/navigation';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('oMLX Copilot Chat');
  const configuration = new OmlxConfiguration(context.secrets, context.globalState);
  const provider = new OmlxLanguageModelProvider(configuration, output);

  context.subscriptions.push(output);
  output.appendLine(`Activating oMLX extension: ${context.extension.id} from ${context.extension.extensionPath}`);

  // Contributed views are visible before the extension activates. Register the
  // TreeDataProvider first so a failure in the optional model integration cannot
  // leave the sidebar displaying "There is no data provider registered".
  registerNavigation(context, configuration);
  output.appendLine('Registered oMLX navigation TreeDataProvider (omlx.navigation).');

  registerManageProviderCommand(context);
  registerTokenCommands(context, configuration, provider);
  registerConnectionCommands(context, configuration, provider, output);

  // Copilot Chat may be absent/disabled in the isolated F5 host. Its model
  // provider registration must not prevent Home and Settings from working.
  try {
    context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider('omlx', provider));
  } catch (error) {
    const details = error instanceof Error ? error.stack ?? error.message : String(error);
    output.appendLine(`Failed to register the oMLX language model provider: ${details}`);
    void vscode.window.showWarningMessage(
      'oMLX navigation is available, but its chat model provider could not be registered. ' +
      'See the "oMLX Copilot Chat" output channel for details.'
    );
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('omlx')) {
        provider.refresh();
      }
    })
  );
}

export function deactivate(): void {}

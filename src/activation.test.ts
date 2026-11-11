import assert from 'node:assert/strict';
import Module from 'node:module';
import { test } from 'node:test';

test('sidebar still registers when the chat-model API throws in an isolated host', () => {
  const calls: string[] = [];
  const output: string[] = [];
  const warnings: string[] = [];
  const commands = new Map<string, Function>();
  let viewProvider: { getChildren(): readonly { label: string; command?: { command: string } }[] } | undefined;
  const disposable = () => ({ dispose() {} });

  class FakeEventEmitter {
    readonly event = () => disposable();
    fire(): void {}
    dispose(): void {}
  }
  class FakeTreeItem {
    readonly label: string;
    readonly collapsibleState: number;
    iconPath?: unknown;
    tooltip?: string;
    command?: { command: string };
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  class FakeThemeIcon {
    constructor(readonly id: string) {}
  }

  const mockVscode = {
    EventEmitter: FakeEventEmitter,
    TreeItem: FakeTreeItem,
    TreeItemCollapsibleState: { None: 0 },
    ThemeIcon: FakeThemeIcon,
    window: {
      createOutputChannel: (name: string) => {
        assert.equal(name, 'oMLX Copilot Chat');
        return { appendLine: (line: string) => output.push(line), dispose() {} };
      },
      createTreeView: (id: string, options: { treeDataProvider: typeof viewProvider }) => {
        calls.push('treeView');
        assert.equal(id, 'omlx.navigation');
        viewProvider = options.treeDataProvider;
        return disposable();
      },
      showWarningMessage: (message: string) => {
        warnings.push(message);
        return Promise.resolve(undefined);
      }
    },
    workspace: {
      onDidChangeConfiguration: () => disposable()
    },
    commands: {
      registerCommand: (name: string, callback: Function) => {
        commands.set(name, callback);
        return disposable();
      }
    },
    lm: {
      registerLanguageModelChatProvider: (name: string) => {
        calls.push('languageModel');
        assert.equal(name, 'omlx');
        throw new Error('Simulated provider registration failure');
      }
    }
  };

  // The published VS Code API exists only inside an Extension Host. Intercept
  // the import to exercise the real activate() and navigation implementations
  // without starting the GUI or requiring a Copilot installation.
  const loader = Module as unknown as {
    _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
  };
  const originalLoad = loader._load;
  loader._load = function (request, parent, isMain) {
    if (request === 'vscode') {
      return mockVscode;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const { activate } = require('./extension') as typeof import('./extension');
    const context = {
      subscriptions: [] as { dispose(): void }[],
      secrets: {},
      globalState: {},
      extension: { packageJSON: {} }
    };
    activate(context as unknown as Parameters<typeof activate>[0]);

    assert.deepEqual(calls, ['treeView', 'languageModel']);
    assert.ok(viewProvider, 'The sidebar provider must be registered before model integration');
    assert.deepEqual(viewProvider.getChildren().map(item => item.label), ['Home', 'Settings']);
    assert.ok(commands.has('omlx.openHome'));
    assert.ok(commands.has('omlx.openSettings'));
    assert.ok(output.some(line => line.includes('Simulated provider registration failure')));
    assert.equal(warnings.length, 1);
  } finally {
    loader._load = originalLoad;
  }
});

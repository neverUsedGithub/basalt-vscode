import * as path from "node:path";
import * as vscode from "vscode";
import type { ExtensionContext } from "vscode";
import { ItemEditorProvider } from "./item-editor";

import type { LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";

import { LanguageClient } from "vscode-languageclient/node";

enum TransportKind {
  stdio = 0,
  ipc = 1,
  pipe = 2,
  socket = 3,
}

let client: LanguageClient;

async function reloadLSP() {
  await client.stop();
  await client.start();
}

async function runFile() {
  if (!vscode.window.activeTextEditor) return;

  const filePath = vscode.window.activeTextEditor.document.uri.fsPath;

  client.sendRequest("workspace/executeCommand", {
    command: "basalt.runfile",
    arguments: [filePath],
  });
}

export function activate(context: ExtensionContext) {
  const output = vscode.window.createOutputChannel("Basalt Language Server");

  // TODO: change how LSP is resolved
  const serverModule: string = context.asAbsolutePath(path.join("..", "basalt-lsp", "dist", "index.js"));

  context.subscriptions.push(vscode.commands.registerCommand("basalt.lsp.reload", reloadLSP));

  context.subscriptions.push(vscode.commands.registerCommand("basalt.runfile", runFile));

  vscode.window.registerCustomEditorProvider("nbt-mcitem-editor", new ItemEditorProvider(context), {
    supportsMultipleEditorsPerDocument: false,
  });

  output.appendLine(`Attempting connection to server at: ${serverModule}`);

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "basalt" }],
    outputChannel: output,
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/basalt.toml"),
    },
  };

  client = new LanguageClient("BasaltLSP", "Basalt Language Server", serverOptions, clientOptions);

  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) return undefined;
  return client.stop();
}

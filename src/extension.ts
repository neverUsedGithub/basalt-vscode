import * as vscode from "vscode";
import type { ExtensionContext } from "vscode";
import { ItemEditorProvider } from "./item-editor";

import { LanguageClient } from "vscode-languageclient/node";
import { loadLanguageServer } from "./languageServer";

let client: LanguageClient | null = null;

async function reloadLSP() {
  if (!client) return;

  await client.stop();
  await client.start();
}

async function runFile() {
  if (!vscode.window.activeTextEditor) return;
  if (!client) return;

  const filePath = vscode.window.activeTextEditor.document.uri.fsPath;

  client.sendRequest("workspace/executeCommand", {
    command: "basalt.runfile",
    arguments: [filePath],
  });
}

async function initServer(context: ExtensionContext): Promise<void> {
  client = await loadLanguageServer(context);

  if (client) {
    client.start();
  }
}

export function activate(context: ExtensionContext) {
  context.subscriptions.push(vscode.commands.registerCommand("basalt.lsp.reload", reloadLSP));
  context.subscriptions.push(vscode.commands.registerCommand("basalt.runfile", runFile));

  vscode.window.registerCustomEditorProvider("nbt-mcitem-editor", new ItemEditorProvider(context), {
    supportsMultipleEditorsPerDocument: false,
  });

  initServer(context);
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) return;
  return client.stop();
}

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import * as vscode from "vscode";
import StreamZip from "node-stream-zip";
import { Octokit } from "@octokit/rest";
import { LanguageClient } from "vscode-languageclient/node";

import type { ExtensionContext } from "vscode";
import type { LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import { inspect } from "node:util";
import { logMessage } from "./util/log";

enum TransportKind {
  stdio = 0,
  ipc = 1,
  pipe = 2,
  socket = 3,
}

const octo = new Octokit();

async function getLatestLanguageServer(output: vscode.OutputChannel): Promise<[string, number] | null> {
  const releases = await octo.repos.listReleases({
    owner: "neverUsedGithub",
    repo: "basalt-lsp",
  });

  const latest = releases.data
    .filter((release) => release.prerelease)
    .sort((releaseA, releaseB) => new Date(releaseB.created_at).getTime() - new Date(releaseA.created_at).getTime())[0];

  if (!latest) {
    output.appendLine("ERROR: cannot resolve latest LSP release");
    return null;
  }

  return [latest.tag_name, latest.id];
}

function getAppDataFolder() {
  if (process.env.APPDATA) return process.env.APPDATA;
  if (process.platform === "darwin") return path.join(process.env.HOME as string, "Library", "Preferences");

  return path.join(process.env.HOME as string, ".local", "share");
}

const fsExists = (path: string) =>
  fs.promises.access(path, fs.constants.R_OK).then(
    () => true,
    () => false,
  );

const basaltAppDataLocatiion = path.join(getAppDataFolder(), ".basalt-mc");
const languageServerInfoLocation = path.join(basaltAppDataLocatiion, "language-servers.json");

function getLanguageServerInstallLocation(tagName: string) {
  return path.join(basaltAppDataLocatiion, "lsp", tagName);
}

async function ensureLanguageServerInstalled(output: vscode.OutputChannel, releaseId: number): Promise<void> {
  const release = await octo.repos.getRelease({
    owner: "neverUsedGithub",
    repo: "basalt-lsp",
    release_id: releaseId,
  });

  const lspAsset = release.data.assets.find((asset) => asset.name === release.data.tag_name + ".zip");

  if (!lspAsset) {
    logMessage(output, "Error", "cannot find LSP zip inside release");
    return;
  }

  await vscode.window.withProgress(
    {
      title: `Setting up new language server ${release.data.tag_name}}...`,
      location: vscode.ProgressLocation.Notification,
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Installing language server..." });
      logMessage(output, "Info", "installing language server zip");

      const lspDirectory = getLanguageServerInstallLocation(release.data.tag_name);
      const lspZip = path.join(lspDirectory, "download.zip");
      const response = await fetch(lspAsset.browser_download_url);

      await fs.promises.mkdir(lspDirectory, { recursive: true });
      // @ts-expect-error fromWeb should accept response.body just fine?
      await fs.promises.writeFile(lspZip, Readable.fromWeb(response.body!));

      logMessage(output, "Info", "unzipping language server zip");
      progress.report({ message: "Unzipping language server..." });

      const streamZip = new StreamZip.async({ file: lspZip });
      streamZip.on("extract", (entry) => logMessage(output, "Info", ` > extracting ${entry.name}`));
      await streamZip.extract("dist", lspDirectory);
      await streamZip.close();

      logMessage(output, "Info", "removing zip artifact");
      progress.report({ message: "Removing download artifact..." });

      await fs.promises.rm(lspZip);
    },
  );
}

interface LanguageServerInfo {
  currentTag: string;
}

async function getLanguageServerInfo(): Promise<LanguageServerInfo | null> {
  let infoData: LanguageServerInfo | null = null;

  try {
    const fileContent = await fs.promises.readFile(languageServerInfoLocation, { encoding: "utf-8" });
    infoData = JSON.parse(fileContent);
  } catch {}

  return infoData;
}

async function writeLanguageServerInfo(info: LanguageServerInfo): Promise<void> {
  await fs.promises.mkdir(path.dirname(languageServerInfoLocation), { recursive: true });
  await fs.promises.writeFile(languageServerInfoLocation, JSON.stringify(info, null, 4), { encoding: "utf-8" });
}

export async function loadLanguageServer(context: ExtensionContext): Promise<LanguageClient | null> {
  const output = vscode.window.createOutputChannel("Basalt Language Server");
  const latest = await getLatestLanguageServer(output);
  const installedInfo = await getLanguageServerInfo();

  let serverTagName: string | null = null;

  if (latest) {
    const [tagName, releaseId] = latest;
    logMessage(output, "Info", `found latest remote language server ${tagName}`);

    if (!installedInfo || installedInfo.currentTag !== tagName) {
      logMessage(output, "Info", "upgrading language server");
      await ensureLanguageServerInstalled(output, releaseId);

      if (installedInfo) {
        logMessage(output, "Info", "removing outdated language server");
        await fs.promises.rm(getLanguageServerInstallLocation(installedInfo.currentTag), { recursive: true });
      }

      serverTagName = tagName;

      logMessage(output, "Info", "writing updated language server data");
      await writeLanguageServerInfo({ currentTag: tagName });
    }
  }

  if (!serverTagName && installedInfo) {
    logMessage(output, "Info", "using already installed language server");
    serverTagName = installedInfo.currentTag;
  }

  if (!serverTagName || !(await fsExists(getLanguageServerInstallLocation(serverTagName)))) {
    logMessage(output, "Error", "couldn't locate a language server to use, LSP features will be disabled.");
    return null;
  }

  const serverModule: string = path.join(getLanguageServerInstallLocation(serverTagName), "index.js");

  logMessage(output, "Info", `attempting connection to server at: ${serverModule}`);

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

  return new LanguageClient("BasaltLSP", "Basalt Language Server", serverOptions, clientOptions);
}

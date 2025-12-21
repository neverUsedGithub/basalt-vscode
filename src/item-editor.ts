import * as childProcess from "node:child_process";
import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import * as path from "node:path";
import * as os from "node:os";

import StreamZip from "node-stream-zip";
import * as vscode from "vscode";
import * as z from "zod";

import { ClientMessages, type IClientMessages, type IServerMessages } from "./shared/proto";
import { getDatagenRunCommand } from "./util/run-minecraft";
import * as mc from "./shared/item";

function hashItem(item: mc.IItem): string {
  return crypto.createHash("md5").update(JSON.stringify(item)).digest().toString("hex");
}

class ItemEditorDocument implements vscode.CustomDocument {
  public item: mc.IItem | null = null;
  private hash: string | null = null;

  constructor(
    private ctx: vscode.ExtensionContext,
    private openContext: vscode.CustomDocumentOpenContext,
    private _onDidChangeCustomDocument: vscode.EventEmitter<
      vscode.CustomDocumentEditEvent<ItemEditorDocument> | vscode.CustomDocumentContentChangeEvent<ItemEditorDocument>
    >,
    public uri: vscode.Uri,
  ) {}

  write(item: mc.IItem) {
    const newHash = hashItem(item);

    if (this.hash === null || this.hash !== newHash) {
      this.hash = newHash;
      this.item = item;

      this._onDidChangeCustomDocument.fire({ document: this });
    }
  }

  async init(): Promise<this> {
    const decoder = new TextDecoder();

    const uri = this.openContext.backupId ? vscode.Uri.parse(this.openContext.backupId) : this.uri;
    const rawData = await vscode.workspace.fs.readFile(uri);
    const data = decoder.decode(rawData);

    try {
      this.item = mc.Item.parse(JSON.parse(data));
      this.hash = hashItem(this.item);
    } catch {}

    return this;
  }

  dispose(): void {}
}

const MINECRAFT_LOCATIONS: Record<string, string> = {
  win32: path.join(process.env.AppData!, ".minecraft"),
  darwin: "~/Library/Application Support/minecraft",
  linux: "~/.minecraft",
};

function getDotMinecraft(): string {
  const platform = os.platform();
  if (!(platform in MINECRAFT_LOCATIONS)) throw new Error("couldn't locate '.minecraft' folder");

  return MINECRAFT_LOCATIONS[platform]!;
}

async function getMinecraftVersions(): Promise<string[]> {
  const versionsFolder = path.join(getDotMinecraft(), "versions");
  const minecraftVersions: string[] = [];

  for (const child of await fs.readdir(versionsFolder)) {
    const stat = await fs.stat(path.join(versionsFolder, child));
    if (stat.isDirectory() && (await exists(path.join(versionsFolder, child, `${child}.jar`))))
      minecraftVersions.push(child);
  }

  return minecraftVersions.sort();
}

function getUnpackedVersionDirectory(version: string): string {
  return path.join(getDotMinecraft(), ".basalt", "unpacked", version);
}

function exists(path: string): Promise<boolean> {
  return fs.access(path, fs.constants.R_OK | fs.constants.W_OK).then(
    () => true,
    () => false,
  );
}

const runningUnpackTasks: Record<string, Promise<void>> = {};

async function unpackVersion(version: string): Promise<void> {
  const unpackedPath = getUnpackedVersionDirectory(version);

  const fontsPath = path.join(unpackedPath, "font");
  const modelsPath = path.join(unpackedPath, "models");
  const datagenPath = path.join(unpackedPath, "datagen");
  const texturesPath = path.join(unpackedPath, "textures");

  const versionJar = path.join(getDotMinecraft(), "versions", version, `${version}.jar`);

  await fs.mkdir(unpackedPath, { recursive: true });
  await fs.mkdir(datagenPath, { recursive: true });
  await fs.mkdir(fontsPath, { recursive: true });

  await vscode.window.withProgress(
    {
      title: `Unpacking minecraft ${version}...`,
      location: vscode.ProgressLocation.Notification,
      cancellable: false,
    },
    async (progress) => {
      let totalSize = 0;

      {
        const zip = new StreamZip.async({ file: versionJar });
        const entries = await zip.entries();

        for (const entry in entries) {
          if (entries[entry]!.isDirectory) continue;

          if (entry.startsWith("assets/minecraft/textures") || entry.startsWith("assets/minecraft/models")) {
            totalSize += entries[entry]!.size || entries[entry]!.compressedSize;
          }
        }

        zip.on("extract", (entry) => {
          if (entry.isDirectory) return;

          progress.report({
            message: path.basename(entry.name),
            increment: ((entry.size || entry.compressedSize) / totalSize) * 100,
          });
        });

        await zip.extract("assets/minecraft/textures", texturesPath);
        await zip.extract("assets/minecraft/models", modelsPath);
        await zip.extract("assets/minecraft/font", fontsPath);
        await zip.close();
      }
    },
  );

  await vscode.window.withProgress(
    {
      title: "Running data generator...",
      location: vscode.ProgressLocation.Notification,
      cancellable: false,
    },
    (progress) =>
      new Promise<void>(async (res, rej) => {
        const [executable, ...jvmArgs] = await getDatagenRunCommand(getDotMinecraft(), version, ["--reports"]);
        let timeSpent = 0;

        const interval = setInterval(() => progress.report({ message: `${++timeSpent}s` }), 1000);

        const child = childProcess.spawn(executable, jvmArgs, {
          cwd: datagenPath,
          stdio: "pipe",
        });

        child.stdout.pipe(process.stdout);
        child.stderr.pipe(process.stderr);

        child.once("exit", () => {
          clearInterval(interval);
          res();
        });
      }),
  );
}

async function ensureUnpackedVersion(version: string): Promise<void> {
  const unpackedPath = getUnpackedVersionDirectory(version);

  if (await exists(unpackedPath)) return;
  if (runningUnpackTasks[version]) return runningUnpackTasks[version];

  const result = unpackVersion(version).finally(() => delete runningUnpackTasks[version]);
  runningUnpackTasks[version] = result;

  return result;
}

interface BlockModelData {
  parent: string;
  textures: Record<string, string>;
}

function stripMinecraftNamespace(resource: string): string {
  return resource.substring(resource.indexOf("/") + 1);
}

async function getUnpackedResource(version: string, resource: string): Promise<string> {
  const unpackedVersion = getUnpackedVersionDirectory(version);
  const itemPath = path.join(unpackedVersion, resource);

  return itemPath;
}

const RegistriesSchema = z.record(
  z.string(),
  z.object({
    entries: z.record(z.string(), z.object({ protocol_id: z.number() })),
  }),
);

async function getItemComponents(version: string): Promise<string[]> {
  const unpackedVersion = getUnpackedVersionDirectory(version);
  const reportsPath = path.join(unpackedVersion, "datagen", "generated", "reports");
  const registriesPath = path.join(reportsPath, "registries.json");

  const registriesRaw = await fs.readFile(registriesPath, { encoding: "utf-8" });
  const registries = RegistriesSchema.parse(JSON.parse(registriesRaw));
  const componentRegistry = registries["minecraft:data_component_type"]!;

  return Object.keys(componentRegistry.entries);
}

async function getUnpackedItemResource(version: string, id: string): Promise<string> {
  id = id.substring(id.indexOf(":") + 1);

  const unpackedVersion = getUnpackedVersionDirectory(version);
  const itemPath = path.join(unpackedVersion, "textures", "item", `${id}.png`);
  if (await exists(itemPath)) return itemPath;

  const blockModel = await fs.readFile(path.join(unpackedVersion, "models", "block", `${id}.json`), {
    encoding: "utf-8",
  });
  const blockData: BlockModelData = JSON.parse(blockModel);

  let texture: string;

  if ("side" in blockData.textures) {
    texture = blockData.textures.side;
  } else {
    texture = Object.values(blockData.textures)[0]!;
  }

  return path.join(unpackedVersion, "textures", "block", `${stripMinecraftNamespace(texture)}.png`);
}

export class ItemEditorProvider implements vscode.CustomEditorProvider<ItemEditorDocument> {
  constructor(private ctx: vscode.ExtensionContext) {}

  private _onDidChangeCustomDocument = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<ItemEditorDocument> | vscode.CustomDocumentContentChangeEvent<ItemEditorDocument>
  >();

  public onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  public async saveCustomDocument(document: ItemEditorDocument, cancellation: vscode.CancellationToken): Promise<void> {
    await this.saveCustomDocumentAs(document, document.uri, cancellation);
  }

  public async saveCustomDocumentAs(
    document: ItemEditorDocument,
    destination: vscode.Uri,
    cancellation: vscode.CancellationToken,
  ): Promise<void> {
    await vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(JSON.stringify(document.item)));
  }

  public revertCustomDocument(document: ItemEditorDocument, cancellation: vscode.CancellationToken): Thenable<void> {
    throw new Error("Method not implemented.");
  }

  public async backupCustomDocument(
    document: ItemEditorDocument,
    context: vscode.CustomDocumentBackupContext,
    cancellation: vscode.CancellationToken,
  ): Promise<vscode.CustomDocumentBackup> {
    this.saveCustomDocumentAs(document, context.destination, cancellation);
    return { id: context.destination.toString(), delete: async () => vscode.workspace.fs.delete(context.destination) };
  }

  public async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    token: vscode.CancellationToken,
  ): Promise<ItemEditorDocument> {
    return new ItemEditorDocument(this.ctx, openContext, this._onDidChangeCustomDocument, uri).init();
  }

  public async resolveCustomEditor(
    document: ItemEditorDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const scriptUri = webviewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, "dist", "item-editor/index.js"),
    );

    const styleUri = webviewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, "dist", "item-editor/index.css"),
    );

    const minecraftVersions: string[] = await getMinecraftVersions();

    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = /* html */ `
      <!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleUri}" rel="stylesheet" />
				<title>Item Editor</title>
			</head>
			<body>
        <div id="root"></div>
				<script src="${scriptUri}"></script>
			</body>
			</html>
    `;

    webviewPanel.webview.onDidReceiveMessage(async (data) => {
      console.log("CLIENT MESSAGE", data);
      const parsed = ClientMessages.safeParse(data);
      if (!parsed.success) return;

      switch (parsed.data.type) {
        case "get-item-texture": {
          const versions = await getMinecraftVersions();
          const parsedItem = parsed.data.item;

          if (!versions.includes(parsedItem.minecraftVersion)) return;

          await ensureUnpackedVersion(parsedItem.minecraftVersion);
          const path = await getUnpackedItemResource(parsedItem.minecraftVersion, parsedItem.id);
          const content = await fs.readFile(path, { encoding: "base64" });

          webviewPanel.webview.postMessage({
            type: "item-texture",
            item: parsedItem,
            texture: content,
          } satisfies IServerMessages);

          break;
        }

        case "get-resource": {
          const versions = await getMinecraftVersions();
          if (!versions.includes(parsed.data.version)) return;

          await ensureUnpackedVersion(parsed.data.version);
          const path = await getUnpackedResource(parsed.data.version, parsed.data.resource);
          const content = await fs.readFile(path, { encoding: "base64" });

          webviewPanel.webview.postMessage({
            type: "resource",
            version: parsed.data.version,
            resource: parsed.data.resource,
            texture: content,
          } satisfies IServerMessages);

          break;
        }

        case "update-item": {
          if (parsed.data.item) {
            document.write(parsed.data.item);

            webviewPanel.webview.postMessage({
              type: "update-item-components",
              components: await getItemComponents(parsed.data.item.minecraftVersion),
            } satisfies IServerMessages);
          }

          break;
        }

        case "ready": {
          webviewPanel.webview.postMessage({
            type: "update-item",
            item: document.item,
          } satisfies IServerMessages);

          webviewPanel.webview.postMessage({
            type: "update-versions",
            versions: minecraftVersions,
          } satisfies IServerMessages);

          if (document.item?.minecraftVersion) {
            webviewPanel.webview.postMessage({
              type: "update-item-components",
              components: await getItemComponents(document.item.minecraftVersion),
            } satisfies IServerMessages);
          }

          break;
        }
      }
    });
  }
}

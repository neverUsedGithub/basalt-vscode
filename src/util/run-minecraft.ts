import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

type MCVersionLibraryOS = "windows" | "linux" | "osx";

interface MCVersionLibraryRule {
  action: "allow";
  os: { name: MCVersionLibraryOS };
}

interface MCVersionLibrary {
  downloads: {
    artifact: {
      path: string;
      sha1: string;
      size: number;
      url: string;
    };
  };
  name: string;
  rules?: MCVersionLibraryRule[];
}

interface MCVersionData {
  libraries: MCVersionLibrary[];
}

export async function getDatagenRunCommand(
  dotMinecraft: string,
  version: string,
  flags: string[],
): Promise<[string, ...string[]]> {
  const platform = os.platform();

  const versionJarPath = path.join(dotMinecraft, "versions", version, `${version}.jar`);
  const versionDataPath = path.join(dotMinecraft, "versions", version, `${version}.json`);

  const versionData: MCVersionData = JSON.parse(await fs.readFile(versionDataPath, { encoding: "utf-8" }));
  const classPathSep = platform === "win32" ? ";" : ":";
  const libPlatform: MCVersionLibraryOS = platform === "win32" ? "windows" : platform === "darwin" ? "osx" : "linux";

  const classPath: string[] = [];

  libraryLoop: for (const library of versionData.libraries) {
    if (library.rules) {
      for (const rule of library.rules) {
        if (rule.action === "allow") {
          if (rule.os && rule.os.name !== libPlatform) continue libraryLoop;
        }
      }
    }

    classPath.push(path.join(dotMinecraft, "libraries", library.downloads.artifact.path));
  }

  classPath.push(versionJarPath);

  return ["java", "-cp", classPath.join(classPathSep), "net.minecraft.data.Main", ...flags];
}

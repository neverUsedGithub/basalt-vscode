import { inspect } from "node:util";

import type { OutputChannel } from "vscode";

function getLogDate(): string {
  const now = new Date();
  const ampm = now.getHours() >= 12 ? "PM" : "AM";
  const hours = now.getHours() === 0 ? 12 : now.getHours() % 12;
  return `${`${hours}`.padStart(2, "0")}:${`${now.getMinutes()}`.padStart(2, "0")}:${`${now.getSeconds()}`.padStart(2, "0")} ${ampm}`;
}

export function logMessage(output: OutputChannel, level: "Warn" | "Info" | "Error", ...data: any[]) {
  output.appendLine(
    `[${level.padEnd(5, " ")} - ${getLogDate()}] ${data.map((v) => (typeof v === "string" ? v : inspect(v))).join(" ")}`,
  );
}

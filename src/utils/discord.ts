import { execFile, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface DiscordClient {
  title: string;
  processName: string;
  installDir: string;
}

const localAppData =
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");

const discordClients: DiscordClient[] = [
  {
    title: "Discord",
    processName: "Discord.exe",
    installDir: path.join(localAppData, "Discord"),
  },
  {
    title: "Discord PTB",
    processName: "DiscordPTB.exe",
    installDir: path.join(localAppData, "DiscordPTB"),
  },
  {
    title: "Discord Canary",
    processName: "DiscordCanary.exe",
    installDir: path.join(localAppData, "DiscordCanary"),
  },
];

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message));
        return;
      }

      resolve(stdout);
    });
  });
}

async function isProcessRunning(processName: string): Promise<boolean> {
  try {
    const output = await run("tasklist", [
      "/FI",
      `IMAGENAME eq ${processName}`,
    ]);
    return output.toLowerCase().includes(processName.toLowerCase());
  } catch {
    return false;
  }
}

function startDiscord(client: DiscordClient): boolean {
  const updateExe = path.join(client.installDir, "Update.exe");
  if (!fs.existsSync(updateExe)) return false;

  const child = spawn(updateExe, ["--processStart", client.processName], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();
  return true;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function restartRunningDiscordClients(): Promise<string[]> {
  const restarted: string[] = [];

  for (const client of discordClients) {
    const running = await isProcessRunning(client.processName);
    if (!running) continue;

    try {
      await run("taskkill", ["/IM", client.processName, "/F"]);
    } catch {
      // Continue and try to relaunch anyway.
    }

    await wait(1500);

    if (startDiscord(client)) {
      restarted.push(client.title);
    }
  }

  return restarted;
}

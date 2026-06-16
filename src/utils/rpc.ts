import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const CONFIG_FILE = path.join(
  os.tmpdir(),
  "discord-rpc-raycast-config.json",
);
export const STOP_SIGNAL_FILE = path.join(
  os.tmpdir(),
  "discord-rpc-raycast-stop",
);
export const BRIDGE_SCRIPT_FILE = path.join(
  os.tmpdir(),
  "discord-rpc-raycast-bridge.js",
);
export const PID_FILE = path.join(os.tmpdir(), "discord-rpc-raycast.pid");

const DATA_DIR = path.join(os.homedir(), ".raycast-discord-rpc");
const PROFILES_FILE = path.join(DATA_DIR, "profiles.json");
const PRESETS_FILE = path.join(DATA_DIR, "presets.json");

/**
 * Activity types matching Discord's ActivityType enum.
 * Matches the Vencord CustomRPC plugin options.
 */
export enum ActivityType {
  PLAYING = 0,
  STREAMING = 1,
  LISTENING = 2,
  WATCHING = 3,
  COMPETING = 5,
}

/**
 * Timestamp display modes, matching Vencord's CustomRPC plugin.
 */
export enum TimestampMode {
  NONE = "none",
  NOW = "now",
  TIME = "time",
  CUSTOM = "custom",
}

export interface RpcConfig {
  clientId: string;
  appName: string;
  details?: string;
  detailsUrl?: string;
  state?: string;
  stateUrl?: string;
  activityType: ActivityType;
  streamLink?: string;
  timestampMode: TimestampMode;
  startTimestamp?: number;
  endTimestamp?: number;
  largeImageKey?: string;
  largeImageText?: string;
  largeImageUrl?: string;
  smallImageKey?: string;
  smallImageText?: string;
  smallImageUrl?: string;
  buttonOneText?: string;
  buttonOneUrl?: string;
  buttonTwoText?: string;
  buttonTwoUrl?: string;
  partySize?: number;
  partyMaxSize?: number;
}

/**
 * Generates the bridge script content that runs as a background process
 * to maintain a persistent Discord RPC connection.
 */
function generateBridgeScript(
  configPath: string,
  stopSignalPath: string,
): string {
  // Resolve the discord-rpc module relative to the extension's node_modules
  const extensionDir = path.resolve(__dirname, "..");
  const rpcModulePath = path.join(extensionDir, "node_modules", "discord-rpc");

  return `
const path = require("path");
const fs = require("fs");

// Load discord-rpc from the extension's node_modules
const { Client } = require(${JSON.stringify(rpcModulePath)});

const CONFIG_PATH = ${JSON.stringify(configPath)};
const STOP_PATH = ${JSON.stringify(stopSignalPath)};

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error("Config file not found:", CONFIG_PATH);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

const initialConfig = readConfig();
const client = new Client({ transport: "ipc" });

let ready = false;
let lastConfigText = "";

function buildActivity(config) {
  const activity = {
    details: config.details || undefined,
    state: config.state || undefined,
    startTimestamp: config.startTimestamp || undefined,
    endTimestamp: config.endTimestamp || undefined,
    largeImageKey: config.largeImageKey || undefined,
    largeImageText: config.largeImageText || undefined,
    smallImageKey: config.smallImageKey || undefined,
    smallImageText: config.smallImageText || undefined,
    instance: true,
  };

  // Add buttons if configured
  const buttons = [];
  if (config.buttonOneText) {
    buttons.push({ label: config.buttonOneText, url: config.buttonOneUrl || "" });
  }
  if (config.buttonTwoText) {
    buttons.push({ label: config.buttonTwoText, url: config.buttonTwoUrl || "" });
  }
  if (buttons.length > 0) {
    activity.buttons = buttons;
  }

  // Add party info if configured
  if (config.partySize && config.partyMaxSize) {
    activity.partySize = config.partySize;
    activity.partyMax = config.partyMaxSize;
  }

  // Clean undefined values
  Object.keys(activity).forEach((key) => {
    if (activity[key] === undefined) delete activity[key];
  });

  return activity;
}

async function applyConfig(config) {
  if (!ready) return;
  await client.setActivity(buildActivity(config));
  console.log("Discord Rich Presence updated successfully.");
}

function readConfigText() {
  return fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, "utf-8") : "";
}

function pollConfigChanges() {
  try {
    const nextConfigText = readConfigText();
    if (!nextConfigText || nextConfigText === lastConfigText) return;

    lastConfigText = nextConfigText;
    const nextConfig = JSON.parse(nextConfigText);
    applyConfig(nextConfig).catch((err) => {
      console.error("Failed to apply updated config:", err.message);
    });
  } catch (err) {
    console.error("Failed to read updated config:", err.message);
  }
}

client.on("ready", () => {
  ready = true;
  lastConfigText = readConfigText();
  applyConfig(initialConfig).catch((err) => {
    console.error("Failed to set initial Rich Presence:", err.message);
  });
});

client.on("disconnected", () => {
  process.exit(0);
});

client.login({ clientId: initialConfig.clientId }).catch((err) => {
  console.error("Failed to connect to Discord:", err.message);
  console.error(
    "Make sure Discord is running and Activity Sharing is enabled in Discord Settings > Activity Privacy."
  );
  process.exit(1);
});

// Monitor for stop signal
const stopInterval = setInterval(() => {
  try {
    if (fs.existsSync(STOP_PATH)) {
      console.log("Stop signal received. Disconnecting...");
      fs.unlinkSync(STOP_PATH);
      clearInterval(stopInterval);
      clearInterval(configInterval);
      client.destroy().catch(() => {});
      process.exit(0);
    }
  } catch {
    // File might be deleted between check and unlink
  }
}, 2000);

// Poll config changes so Raycast form submissions update live
// without restarting the bridge process.
const configInterval = setInterval(pollConfigChanges, 1000);

// Keep process alive
process.stdin.resume();
`;
}

/**
 * Spawns the background bridge process that maintains the Discord RPC connection.
 * Returns the child process PID (if we could get it) or null.
 */
export function writeBridgeConfig(config: RpcConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export function spawnBridge(config: RpcConfig): number | null {
  // Write config to temp file
  writeBridgeConfig(config);

  // Clean up any previous stop signal
  try {
    fs.unlinkSync(STOP_SIGNAL_FILE);
  } catch {
    // File doesn't exist, that's fine
  }

  // Generate and write the bridge script
  const bridgeScript = generateBridgeScript(CONFIG_FILE, STOP_SIGNAL_FILE);
  fs.writeFileSync(BRIDGE_SCRIPT_FILE, bridgeScript, "utf-8");

  // Spawn the bridge as a detached child process
  const child = spawn(process.execPath, [BRIDGE_SCRIPT_FILE], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();

  if (child.pid) {
    fs.writeFileSync(PID_FILE, String(child.pid), "utf-8");
  }

  return child.pid || null;
}

/**
 * Sends a stop signal to the running bridge process.
 * Returns true if a stop signal was written, false if no bridge was running.
 */
export function stopBridge(): boolean {
  try {
    fs.writeFileSync(STOP_SIGNAL_FILE, Date.now().toString(), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if the bridge is currently running by checking for the config file
 * and the absence of a stop signal.
 */
export function isBridgeRunning(): boolean {
  if (fs.existsSync(STOP_SIGNAL_FILE)) return false;

  try {
    const pid = Number(fs.readFileSync(PID_FILE, "utf-8"));
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current config (if any).
 */
export function getCurrentConfig(): RpcConfig | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {
    // Corrupt or unreadable
  }
  return null;
}

// ── Profile persistence ──────────────────────────────────────────

type ProfilesMap = Record<string, RpcConfig>;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readProfiles(): ProfilesMap {
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      return JSON.parse(fs.readFileSync(PROFILES_FILE, "utf-8"));
    }
  } catch {
    // Corrupt – start fresh
  }
  return {};
}

function writeProfiles(profiles: ProfilesMap): void {
  ensureDataDir();
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), "utf-8");
}

/**
 * Save an RPC config as a named profile keyed by its clientId.
 * This lets you paste an application ID later and instantly restore
 * all previously configured fields.
 */
export function saveProfile(config: RpcConfig): void {
  const profiles = readProfiles();
  profiles[config.clientId] = config;
  writeProfiles(profiles);
}

/**
 * Load a previously saved profile by application ID.
 * Returns null if no profile exists for that ID.
 */
export function loadProfile(clientId: string): RpcConfig | null {
  const profiles = readProfiles();
  return profiles[clientId] ?? null;
}

/**
 * Return every saved profile, newest first.
 */
export function getAllProfiles(): RpcConfig[] {
  const profiles = readProfiles();
  return Object.values(profiles).reverse();
}

/**
 * Delete a saved profile by application ID.
 */
export function deleteProfile(clientId: string): boolean {
  const profiles = readProfiles();
  if (profiles[clientId]) {
    delete profiles[clientId];
    writeProfiles(profiles);

    return true;
  }
  return false;
}

// ── Presets ──────────────────────────────────────────────────────

export interface RpcPreset {
  name: string;
  config: RpcConfig;
  updatedAt: number;
}

type PresetsMap = Record<string, Record<string, RpcPreset>>;

function readPresets(): PresetsMap {
  try {
    if (fs.existsSync(PRESETS_FILE)) {
      return JSON.parse(fs.readFileSync(PRESETS_FILE, "utf-8"));
    }
  } catch {
    // Corrupt – start fresh
  }
  return {};
}

function writePresets(presets: PresetsMap): void {
  ensureDataDir();
  fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2), "utf-8");
}

export function getPresetsForApp(clientId: string): RpcPreset[] {
  if (!clientId) return [];

  const presets = readPresets()[clientId] ?? {};
  return Object.values(presets).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadPreset(clientId: string, name: string): RpcPreset | null {
  if (!clientId || !name) return null;

  const presets = readPresets();
  return presets[clientId]?.[name] ?? null;
}

export function savePreset(
  clientId: string,
  name: string,
  config: RpcConfig,
): RpcPreset {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Preset name is required.");
  if (!clientId)
    throw new Error("Application ID is required before saving a preset.");

  const presets = readPresets();
  presets[clientId] ??= {};

  const preset: RpcPreset = {
    name: trimmedName,
    config: {
      ...config,
      clientId,
    },
    updatedAt: Date.now(),
  };

  presets[clientId][trimmedName] = preset;
  writePresets(presets);

  return preset;
}

export function deletePreset(clientId: string, name: string): boolean {
  const presets = readPresets();
  if (!presets[clientId]?.[name]) return false;

  delete presets[clientId][name];
  writePresets(presets);
  return true;
}

// ── Vencord CustomRPC importer ───────────────────────────────────

interface VencordSettings {
  plugins?: Record<
    string,
    {
      enabled?: boolean;
      [setting: string]: unknown;
    }
  >;
}

/** Possible paths where Vencord stores its settings.json on Windows.
 *  Covers Stable, PTB, and Canary — all resolve to the same
 *  %APPDATA%/Vencord (or VencordData) regardless of branch. */
function getVencordSettingsPaths(): string[] {
  const appData =
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const home = os.homedir();

  return [
    // Default location (all Discord branches, when DISCORD_USER_DATA_DIR is set)
    path.join(appData, "VencordData", "settings", "settings.json"),
    // Default location (all Discord branches, when derived from userData)
    path.join(appData, "Vencord", "settings", "settings.json"),
    // Also check native-settings.json in both dirs
    path.join(appData, "VencordData", "settings", "native-settings.json"),
    path.join(appData, "Vencord", "settings", "native-settings.json"),
    // Some setups use LOCALAPPDATA
    path.join(
      process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
      "Vencord",
      "settings",
      "settings.json",
    ),
  ];
}

/** Map Vencord's numeric TimestampMode to our string enum. */
function mapVencordTimestamp(mode: number): TimestampMode {
  switch (mode) {
    case 1:
      return TimestampMode.NOW;
    case 2:
      return TimestampMode.TIME;
    case 3:
      return TimestampMode.CUSTOM;
    default:
      return TimestampMode.NONE;
  }
}

/**
 * Try to read Vencord's settings.json and extract the FIRST
 * CustomRPC configuration found, regardless of app ID.
 */
export function importFirstFromVencord(): RpcConfig | null {
  const paths = getVencordSettingsPaths();

  for (const settingsPath of paths) {
    let raw: string;
    try {
      raw = fs.readFileSync(settingsPath, "utf-8");
    } catch {
      continue;
    }

    let settings: VencordSettings;
    try {
      settings = JSON.parse(raw);
    } catch {
      continue;
    }

    const customRpc = settings.plugins?.CustomRPC;
    if (!customRpc?.appID) continue;

    const clientId = customRpc.appID as string;

    const config: RpcConfig = {
      clientId,
      appName: (customRpc.appName as string) || "",
      details: customRpc.details as string | undefined,
      detailsUrl: customRpc.detailsURL as string | undefined,
      state: customRpc.state as string | undefined,
      stateUrl: customRpc.stateURL as string | undefined,
      activityType: ((customRpc.type as number) ??
        ActivityType.PLAYING) as ActivityType,
      streamLink: customRpc.streamLink as string | undefined,
      timestampMode: mapVencordTimestamp(customRpc.timestampMode as number),
      startTimestamp: customRpc.startTime as number | undefined,
      endTimestamp: customRpc.endTime as number | undefined,
      largeImageKey: customRpc.imageBig as string | undefined,
      largeImageText: customRpc.imageBigTooltip as string | undefined,
      largeImageUrl: customRpc.imageBigURL as string | undefined,
      smallImageKey: customRpc.imageSmall as string | undefined,
      smallImageText: customRpc.imageSmallTooltip as string | undefined,
      smallImageUrl: customRpc.imageSmallURL as string | undefined,
      buttonOneText: customRpc.buttonOneText as string | undefined,
      buttonOneUrl: customRpc.buttonOneURL as string | undefined,
      buttonTwoText: customRpc.buttonTwoText as string | undefined,
      buttonTwoUrl: customRpc.buttonTwoURL as string | undefined,
      partySize: customRpc.partySize as number | undefined,
      partyMaxSize: customRpc.partyMaxSize as number | undefined,
    };

    return config;
  }

  return null;
}

/**
 * Try to read Vencord's settings.json and extract the
 * CustomRPC configuration matching the given clientId.
 *
 * This lets you paste an app ID you already configured in
 * Vencord's CustomRPC plugin and instantly import every field.
 */
export function importFromVencord(clientId: string): RpcConfig | null {
  const paths = getVencordSettingsPaths();

  for (const settingsPath of paths) {
    let raw: string;
    try {
      raw = fs.readFileSync(settingsPath, "utf-8");
    } catch {
      continue; // file doesn't exist
    }

    let settings: VencordSettings;
    try {
      settings = JSON.parse(raw);
    } catch {
      continue;
    }

    const customRpc = settings.plugins?.CustomRPC;
    if (!customRpc) continue;

    // Check if this profile's appId matches
    const storedId = customRpc.appID as string | undefined;
    if (storedId !== clientId) continue;

    // Build an RpcConfig from Vencord's settings
    const config: RpcConfig = {
      clientId,
      appName: (customRpc.appName as string) || "",
      details: customRpc.details as string | undefined,
      detailsUrl: customRpc.detailsURL as string | undefined,
      state: customRpc.state as string | undefined,
      stateUrl: customRpc.stateURL as string | undefined,
      activityType: ((customRpc.type as number) ??
        ActivityType.PLAYING) as ActivityType,
      streamLink: customRpc.streamLink as string | undefined,
      timestampMode: mapVencordTimestamp(customRpc.timestampMode as number),
      startTimestamp: customRpc.startTime as number | undefined,
      endTimestamp: customRpc.endTime as number | undefined,
      largeImageKey: customRpc.imageBig as string | undefined,
      largeImageText: customRpc.imageBigTooltip as string | undefined,
      largeImageUrl: customRpc.imageBigURL as string | undefined,
      smallImageKey: customRpc.imageSmall as string | undefined,
      smallImageText: customRpc.imageSmallTooltip as string | undefined,
      smallImageUrl: customRpc.imageSmallURL as string | undefined,
      buttonOneText: customRpc.buttonOneText as string | undefined,
      buttonOneUrl: customRpc.buttonOneURL as string | undefined,
      buttonTwoText: customRpc.buttonTwoText as string | undefined,
      buttonTwoUrl: customRpc.buttonTwoURL as string | undefined,
      partySize: customRpc.partySize as number | undefined,
      partyMaxSize: customRpc.partyMaxSize as number | undefined,
    };

    return config;
  }

  return null;
}

/** Map our string TimestampMode back to Vencord's numeric enum. */
function reverseTimestamp(mode: TimestampMode): number {
  switch (mode) {
    case TimestampMode.NOW:
      return 1;
    case TimestampMode.TIME:
      return 2;
    case TimestampMode.CUSTOM:
      return 3;
    default:
      return 0;
  }
}

/**
 * Write a configuration back to Vencord's settings.json so the
 * CustomRPC plugin picks it up next time Discord (Stable, PTB,
 * or Canary) launches.
 *
 * This makes Raycast a two-way editor: import from Vencord on
 * paste, edit in Raycast, and the changes land back in Vencord.
 */
export function exportToVencord(config: RpcConfig): boolean {
  const paths = getVencordSettingsPaths();

  for (const settingsPath of paths) {
    let raw: string;
    try {
      raw = fs.readFileSync(settingsPath, "utf-8");
    } catch {
      continue;
    }

    let settings: VencordSettings;
    try {
      settings = JSON.parse(raw);
    } catch {
      continue;
    }

    // Ensure the plugins.CustomRPC object exists
    if (!settings.plugins) settings.plugins = {};
    if (!settings.plugins.CustomRPC) settings.plugins.CustomRPC = {};

    const c = settings.plugins.CustomRPC;

    // Map our RpcConfig back to Vencord's field names
    c.enabled = true;
    c.appID = config.clientId;
    c.appName = config.appName;
    c.details = config.details;
    c.detailsURL = config.detailsUrl;
    c.state = config.state;
    c.stateURL = config.stateUrl;
    c.type = config.activityType;
    c.streamLink = config.streamLink;
    c.timestampMode = reverseTimestamp(config.timestampMode);
    c.startTime = config.startTimestamp;
    c.endTime = config.endTimestamp;
    c.imageBig = config.largeImageKey;
    c.imageBigTooltip = config.largeImageText;
    c.imageBigURL = config.largeImageUrl;
    c.imageSmall = config.smallImageKey;
    c.imageSmallTooltip = config.smallImageText;
    c.imageSmallURL = config.smallImageUrl;
    c.buttonOneText = config.buttonOneText;
    c.buttonOneURL = config.buttonOneUrl;
    c.buttonTwoText = config.buttonTwoText;
    c.buttonTwoURL = config.buttonTwoUrl;
    c.partySize = config.partySize;
    c.partyMaxSize = config.partyMaxSize;

    // Clean up any undefined keys so Vencord doesn't choke
    for (const key of Object.keys(c)) {
      if (c[key] === undefined) delete c[key];
    }

    try {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify(settings, null, 2),
        "utf-8",
      );
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

/**
 * Disable Vencord's CustomRPC plugin in settings.json.
 *
 * This mirrors toggling the plugin off in Vencord's UI. Vencord keeps
 * settings in memory while Discord is running, so a Discord restart/reload
 * may still be required before Vencord itself observes the change.
 */
export interface VencordCustomRpcToggleResult {
  foundSettings: boolean;
  foundPlugin: boolean;
  wasEnabled: boolean;
  changed: boolean;
}

export function disableVencordCustomRpc(): VencordCustomRpcToggleResult {
  const paths = getVencordSettingsPaths();
  let foundSettings = false;

  for (const settingsPath of paths) {
    let raw: string;
    try {
      raw = fs.readFileSync(settingsPath, "utf-8");
    } catch {
      continue;
    }

    let settings: VencordSettings;
    try {
      settings = JSON.parse(raw);
    } catch {
      continue;
    }

    foundSettings = true;

    if (!settings.plugins) settings.plugins = {};
    const customRpc = settings.plugins.CustomRPC;

    if (!customRpc) continue;

    const wasEnabled = customRpc.enabled !== false;
    customRpc.enabled = false;

    try {
      fs.writeFileSync(
        settingsPath,
        JSON.stringify(settings, null, 2),
        "utf-8",
      );
      return {
        foundSettings: true,
        foundPlugin: true,
        wasEnabled,
        changed: wasEnabled,
      };
    } catch {
      continue;
    }
  }

  return {
    foundSettings,
    foundPlugin: false,
    wasEnabled: false,
    changed: false,
  };
}

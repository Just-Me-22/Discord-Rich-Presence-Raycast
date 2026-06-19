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
export const STATUS_FILE = path.join(
  os.tmpdir(),
  "discord-rpc-raycast-status.json",
);

const DATA_DIR = path.join(os.homedir(), ".raycast-discord-rpc");
const PROFILES_FILE = path.join(DATA_DIR, "profiles.json");
const PRESETS_FILE = path.join(DATA_DIR, "presets.json");
const BRIDGE_READY_TIMEOUT_MS = 6000;
const BRIDGE_STOP_TIMEOUT_MS = 3000;
const BRIDGE_POLL_MS = 250;

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

interface BridgeStatus {
  pid?: number;
  clientId?: string;
  ready?: boolean;
  lastAppliedAt?: number;
  lastError?: string | null;
  updatedAt?: number;
}

export interface BridgeApplyResult {
  connected: boolean;
  started: boolean;
  restarted: boolean;
  error?: string;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readBridgePid(): number | null {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, "utf-8"));
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeFileIfExists(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Already gone.
  }
}

function readBridgeStatus(): BridgeStatus | null {
  try {
    if (!fs.existsSync(STATUS_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8"));
  } catch {
    return null;
  }
}

async function waitForBridgeReady(
  clientId: string,
  minAppliedAt: number,
  timeoutMs = BRIDGE_READY_TIMEOUT_MS,
): Promise<BridgeStatus | null> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: BridgeStatus | null = null;

  while (Date.now() < deadline) {
    lastStatus = readBridgeStatus();
    if (
      lastStatus?.ready &&
      lastStatus.clientId === clientId &&
      (lastStatus.lastAppliedAt ?? 0) >= minAppliedAt
    ) {
      return lastStatus;
    }

    if (lastStatus?.lastError && !isBridgeRunning()) {
      return lastStatus;
    }

    await wait(BRIDGE_POLL_MS);
  }

  return lastStatus;
}

/**
 * Generates the bridge script content that runs as a background process
 * to maintain a persistent Discord RPC connection.
 */
function generateBridgeScript(
  configPath: string,
  stopSignalPath: string,
  statusPath: string,
): string {
  return `
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const CONFIG_PATH = ${JSON.stringify(configPath)};
const STOP_PATH = ${JSON.stringify(stopSignalPath)};
const STATUS_PATH = ${JSON.stringify(statusPath)};
const OPCODE_HANDSHAKE = 0;
const OPCODE_FRAME = 1;
const OPCODE_CLOSE = 2;
const OPCODE_PING = 3;
const OPCODE_PONG = 4;
const CONNECT_TIMEOUT_MS = 1500;

let client = null;
let ready = false;
let activeClientId = null;
let lastConfigText = "";
let reconnecting = false;

function readConfigText() {
  return fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, "utf-8") : "";
}

function readConfig() {
  const text = readConfigText();
  if (!text) throw new Error("Config file not found: " + CONFIG_PATH);
  return JSON.parse(text);
}

function writeStatus(update) {
  let current = {};
  try {
    if (fs.existsSync(STATUS_PATH)) {
      current = JSON.parse(fs.readFileSync(STATUS_PATH, "utf-8"));
    }
  } catch {
    current = {};
  }

  fs.writeFileSync(
    STATUS_PATH,
    JSON.stringify(
      {
        ...current,
        pid: process.pid,
        clientId: activeClientId,
        ready,
        ...update,
        updatedAt: Date.now(),
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function getIpcPath(index) {
  if (process.platform === "win32") {
    return "\\\\\\\\?\\\\pipe\\\\discord-ipc-" + index;
  }

  const baseDirs = [
    process.env.XDG_RUNTIME_DIR,
    process.env.TMPDIR,
    process.env.TMP,
    process.env.TEMP,
    "/tmp",
  ].filter(Boolean);

  return path.join(baseDirs[0] || os.tmpdir(), "discord-ipc-" + index);
}

function encodePacket(opcode, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(8);
  header.writeInt32LE(opcode, 0);
  header.writeInt32LE(data.length, 4);
  return Buffer.concat([header, data]);
}

function decodePackets(buffer) {
  const packets = [];
  let offset = 0;

  while (buffer.length - offset >= 8) {
    const opcode = buffer.readInt32LE(offset);
    const length = buffer.readInt32LE(offset + 4);
    if (buffer.length - offset - 8 < length) break;

    const body = buffer.slice(offset + 8, offset + 8 + length).toString("utf-8");
    let payload = null;
    try {
      payload = body ? JSON.parse(body) : null;
    } catch {
      payload = null;
    }

    packets.push({ opcode, payload });
    offset += 8 + length;
  }

  return {
    packets,
    rest: buffer.slice(offset),
  };
}

function normalizeTimestamp(value) {
  if (!value) return undefined;
  return value > 9999999999 ? Math.floor(value / 1000) : value;
}

function buildActivity(config) {
  const activity = {
    type: config.activityType,
    url: config.activityType === 1 ? config.streamLink || undefined : undefined,
    details: config.details || undefined,
    state: config.state || undefined,
    instance: true,
  };

  const timestamps = {};
  if (config.startTimestamp) timestamps.start = normalizeTimestamp(config.startTimestamp);
  if (config.endTimestamp) timestamps.end = normalizeTimestamp(config.endTimestamp);
  if (Object.keys(timestamps).length > 0) activity.timestamps = timestamps;

  const assets = {};
  if (config.largeImageKey) assets.large_image = config.largeImageKey;
  if (config.largeImageText) assets.large_text = config.largeImageText;
  if (config.smallImageKey) assets.small_image = config.smallImageKey;
  if (config.smallImageText) assets.small_text = config.smallImageText;
  if (Object.keys(assets).length > 0) activity.assets = assets;

  const buttons = [];
  if (config.buttonOneText && config.buttonOneUrl) {
    buttons.push({ label: config.buttonOneText, url: config.buttonOneUrl });
  }
  if (config.buttonTwoText && config.buttonTwoUrl) {
    buttons.push({ label: config.buttonTwoText, url: config.buttonTwoUrl });
  }
  if (buttons.length > 0) {
    activity.buttons = buttons;
  }

  if (config.partySize && config.partyMaxSize) {
    activity.party = {
      size: [config.partySize, config.partyMaxSize],
    };
  }

  Object.keys(activity).forEach((key) => {
    if (activity[key] === undefined) delete activity[key];
  });

  return activity;
}

class DiscordIpcClient {
  constructor() {
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.readyResolver = null;
    this.readyRejecter = null;
  }

  async connect(clientId) {
    this.socket = await this.connectSocket();
    this.socket.on("data", (data) => this.handleData(data));
    this.socket.on("close", () => this.rejectAll(new Error("Discord IPC connection closed")));
    this.socket.on("error", (err) => this.rejectAll(err));

    const readyPromise = new Promise((resolve, reject) => {
      this.readyResolver = resolve;
      this.readyRejecter = reject;
    });

    this.send(OPCODE_HANDSHAKE, { v: 1, client_id: clientId });
    await readyPromise;
  }

  connectSocket() {
    const attempts = [];
    for (let i = 0; i < 10; i += 1) {
      attempts.push(this.tryConnectPath(getIpcPath(i)));
    }

    return Promise.any(attempts).catch(() => {
      throw new Error("Could not connect to Discord IPC. Make sure Discord is running.");
    });
  }

  tryConnectPath(ipcPath) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(ipcPath);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("Timed out connecting to " + ipcPath));
      }, CONNECT_TIMEOUT_MS);

      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  send(opcode, payload) {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("Discord IPC socket is not connected");
    }
    this.socket.write(encodePacket(opcode, payload));
  }

  request(payload) {
    const nonce =
      Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    const requestPayload = { ...payload, nonce };

    return new Promise((resolve, reject) => {
      this.pending.set(nonce, { resolve, reject });
      try {
        this.send(OPCODE_FRAME, requestPayload);
      } catch (error) {
        this.pending.delete(nonce);
        reject(error);
      }
    });
  }

  async setActivity(activity) {
    await this.request({
      cmd: "SET_ACTIVITY",
      args: {
        pid: process.pid,
        activity,
      },
    });
  }

  async clearActivity() {
    await this.setActivity(null);
  }

  destroy() {
    if (this.socket && !this.socket.destroyed) {
      this.socket.end();
      this.socket.destroy();
    }
    this.rejectAll(new Error("Discord IPC client destroyed"));
  }

  handleData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    const decoded = decodePackets(this.buffer);
    this.buffer = decoded.rest;

    for (const packet of decoded.packets) {
      this.handlePacket(packet);
    }
  }

  handlePacket(packet) {
    if (packet.opcode === OPCODE_PING) {
      this.send(OPCODE_PONG, packet.payload || {});
      return;
    }

    if (packet.opcode === OPCODE_CLOSE) {
      this.rejectAll(new Error("Discord closed the IPC connection"));
      return;
    }

    if (packet.opcode !== OPCODE_FRAME || !packet.payload) return;

    const payload = packet.payload;
    if (payload.cmd === "DISPATCH" && payload.evt === "READY") {
      this.readyResolver?.(payload);
      this.readyResolver = null;
      this.readyRejecter = null;
      return;
    }

    if (payload.cmd === "DISPATCH" && payload.evt === "ERROR") {
      const error = new Error(payload.data?.message || "Discord IPC error");
      this.readyRejecter?.(error);
      this.readyRejecter = null;
      return;
    }

    if (!payload.nonce || !this.pending.has(payload.nonce)) return;

    const pending = this.pending.get(payload.nonce);
    this.pending.delete(payload.nonce);

    if (payload.evt === "ERROR") {
      pending.reject(new Error(payload.data?.message || "Discord IPC request failed"));
      return;
    }

    pending.resolve(payload);
  }

  rejectAll(error) {
    this.readyRejecter?.(error);
    this.readyResolver = null;
    this.readyRejecter = null;

    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

async function applyConfig(config) {
  if (!ready || !client) return;
  await client.setActivity(buildActivity(config));
  writeStatus({
    clientId: config.clientId,
    ready: true,
    lastAppliedAt: Date.now(),
    lastError: null,
  });
}

async function disconnectCurrentClient() {
  const previousClient = client;
  client = null;
  ready = false;
  activeClientId = null;

  if (!previousClient) return;

  try {
    await previousClient.clearActivity();
  } catch {
    // Ignore clear failures during reconnect/stop.
  }
  try {
    previousClient.destroy();
  } catch {
    // Ignore destroy failures during reconnect/stop.
  }
}

async function connect(config) {
  if (client && activeClientId === config.clientId) {
    await applyConfig(config);
    return;
  }

  await disconnectCurrentClient();
  activeClientId = config.clientId;
  writeStatus({ clientId: activeClientId, ready: false, lastError: null });

  client = new DiscordIpcClient();
  try {
    await client.connect(config.clientId);
    ready = true;
    writeStatus({ clientId: activeClientId, ready: true, lastError: null });
    await applyConfig(config);
  } catch (err) {
    writeStatus({
      clientId: config.clientId,
      ready: false,
      lastError:
        err && typeof err.message === "string"
          ? err.message
          : "Failed to connect to Discord",
    });
    process.exit(1);
  }
}

function pollConfigChanges() {
  try {
    const nextConfigText = readConfigText();
    if (!nextConfigText || nextConfigText === lastConfigText) return;

    lastConfigText = nextConfigText;
    const nextConfig = JSON.parse(nextConfigText);
    connect(nextConfig).catch((err) => {
      writeStatus({
        ready: false,
        lastError:
          err && typeof err.message === "string"
            ? err.message
            : "Failed to apply updated config",
      });
    });
  } catch (err) {
    writeStatus({
      ready: false,
      lastError:
        err && typeof err.message === "string"
          ? err.message
          : "Failed to read updated config",
    });
  }
}

const initialConfig = readConfig();
lastConfigText = readConfigText();
writeStatus({ pid: process.pid, clientId: initialConfig.clientId, ready: false, lastError: null });
connect(initialConfig).catch((err) => {
  writeStatus({
    ready: false,
    lastError:
      err && typeof err.message === "string"
        ? err.message
        : "Failed to connect to Discord",
  });
  process.exit(1);
});

const configInterval = setInterval(pollConfigChanges, 1000);

const stopInterval = setInterval(() => {
  try {
    if (!fs.existsSync(STOP_PATH)) return;

    fs.unlinkSync(STOP_PATH);
    clearInterval(stopInterval);
    clearInterval(configInterval);
    disconnectCurrentClient().finally(() => {
      writeStatus({ ready: false, lastError: "Stopped" });
      process.exit(0);
    });
  } catch {
    // File might be deleted between check and unlink.
  }
}, 1000);

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
  writeBridgeConfig(config);

  removeFileIfExists(STOP_SIGNAL_FILE);
  removeFileIfExists(STATUS_FILE);

  const bridgeScript = generateBridgeScript(
    CONFIG_FILE,
    STOP_SIGNAL_FILE,
    STATUS_FILE,
  );
  fs.writeFileSync(BRIDGE_SCRIPT_FILE, bridgeScript, "utf-8");

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
  const pid = readBridgePid();

  try {
    fs.writeFileSync(STOP_SIGNAL_FILE, Date.now().toString(), "utf-8");
    return pid !== null;
  } catch {
    return false;
  }
}

async function stopBridgeAndWait(
  timeoutMs = BRIDGE_STOP_TIMEOUT_MS,
): Promise<boolean> {
  const pid = readBridgePid();
  const signaled = stopBridge();
  if (!pid) return signaled;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) {
      removeFileIfExists(PID_FILE);
      return true;
    }
    await wait(BRIDGE_POLL_MS);
  }

  try {
    process.kill(pid);
  } catch {
    // Already stopped or inaccessible.
  }

  removeFileIfExists(PID_FILE);
  removeFileIfExists(STATUS_FILE);
  return true;
}

/**
 * Checks if the bridge process recorded by the PID file is currently running.
 */
export function isBridgeRunning(): boolean {
  if (fs.existsSync(STOP_SIGNAL_FILE)) return false;

  const pid = readBridgePid();
  if (!pid) {
    return false;
  }
  if (isPidRunning(pid)) return true;

  removeFileIfExists(PID_FILE);
  removeFileIfExists(STATUS_FILE);
  return false;
}

export async function applyConfigViaBridge(
  config: RpcConfig,
): Promise<BridgeApplyResult> {
  const existingConfig = getCurrentConfig();
  const requestedAt = Date.now();
  const running = isBridgeRunning();
  const needsRestart =
    running &&
    Boolean(existingConfig?.clientId) &&
    existingConfig?.clientId !== config.clientId;

  if (!running && readBridgePid()) {
    await stopBridgeAndWait();
  }

  if (needsRestart) {
    await stopBridgeAndWait();
  }

  if (running && !needsRestart) {
    writeBridgeConfig(config);
    const status = await waitForBridgeReady(config.clientId, requestedAt);
    return {
      connected: Boolean(status?.ready && status.clientId === config.clientId),
      started: false,
      restarted: false,
      error: status?.lastError ?? undefined,
    };
  }

  const pid = spawnBridge(config);
  if (!pid) {
    return {
      connected: false,
      started: false,
      restarted: needsRestart,
      error: "Could not start the Discord RPC bridge.",
    };
  }

  const status = await waitForBridgeReady(config.clientId, requestedAt);
  return {
    connected: Boolean(status?.ready && status.clientId === config.clientId),
    started: true,
    restarted: needsRestart,
    error: status?.lastError ?? undefined,
  };
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
 *  Covers Stable, PTB, and Canary (Vencord installed into Discord) as
 *  well as Vesktop (which ships Vencord built-in and stores its
 *  settings under the Vesktop userData directory). */
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
    // Vesktop ships Vencord built-in; its settings live under the
    // Vesktop userData directory rather than the shared Vencord dir.
    path.join(appData, "vesktop", "settings", "settings.json"),
    path.join(appData, "vesktop", "settings", "native-settings.json"),
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
 * Canary) or Vesktop launches.
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

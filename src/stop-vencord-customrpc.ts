import { showHUD, showToast, Toast } from "@raycast/api";
import { restartRunningDiscordClients } from "./utils/discord";
import {
  disableVencordCustomRpc,
  isBridgeRunning,
  stopBridge,
} from "./utils/rpc";

export default async function Command() {
  try {
    const bridgeWasRunning = isBridgeRunning();

    if (bridgeWasRunning) {
      stopBridge();
    }

    const vencordResult = disableVencordCustomRpc();

    // Restart Discord so Vencord picks up the disabled state immediately
    const restarted = await restartRunningDiscordClients();

    if (vencordResult.changed && restarted.length > 0) {
      await showHUD(
        `🎮 Vencord CustomRPC disabled. ${restarted.join(", ")} restarted.`,
      );
      return;
    }

    if (vencordResult.changed) {
      await showHUD(
        "Vencord CustomRPC disabled. Discord was not running, so no restart needed.",
      );
      return;
    }

    if (bridgeWasRunning && restarted.length > 0) {
      await showHUD(
        `🎮 Rich Presence bridge stopped. ${restarted.join(", ")} restarted.`,
      );
      return;
    }

    if (bridgeWasRunning) {
      await showHUD("🎮 Rich Presence bridge stopped.");
      return;
    }

    if (vencordResult.foundPlugin && !vencordResult.wasEnabled) {
      await showHUD("Vencord CustomRPC is already disabled.");
      return;
    }

    if (vencordResult.foundSettings && !vencordResult.foundPlugin) {
      await showHUD("Vencord settings found, but CustomRPC is not configured.");
      return;
    }

    await showHUD("Could not find Vencord CustomRPC settings to disable.");
  } catch (error) {
    await showToast({
      title: "Failed to stop Vencord CustomRPC",
      message: error instanceof Error ? error.message : "Unknown error",
      style: Toast.Style.Failure,
    });
  }
}

import { showHUD, showToast, Toast } from "@raycast/api";
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

    if (bridgeWasRunning && vencordResult.changed) {
      await showHUD(
        "🎮 Rich Presence stopped and Vencord CustomRPC disabled. Restart Discord if it stays visible.",
      );
      return;
    }

    if (vencordResult.changed) {
      await showHUD(
        "Vencord CustomRPC disabled. Restart Discord if the presence stays visible.",
      );
      return;
    }

    if (bridgeWasRunning && vencordResult.foundPlugin) {
      await showHUD(
        "🎮 Rich Presence bridge stopped. Vencord CustomRPC was already disabled in settings.",
      );
      return;
    }

    if (bridgeWasRunning) {
      await showHUD("🎮 Rich Presence bridge stopped.");
      return;
    }

    if (vencordResult.foundPlugin && !vencordResult.wasEnabled) {
      await showHUD("Vencord CustomRPC is already disabled in settings.");
      return;
    }

    if (vencordResult.foundSettings && !vencordResult.foundPlugin) {
      await showHUD("Vencord settings found, but CustomRPC is not configured.");
      return;
    }

    await showHUD("Could not find Vencord CustomRPC settings to disable.");
  } catch (error) {
    await showToast({
      title: "Failed to stop Rich Presence",
      message: error instanceof Error ? error.message : "Unknown error",
      style: Toast.Style.Failure,
    });
  }
}

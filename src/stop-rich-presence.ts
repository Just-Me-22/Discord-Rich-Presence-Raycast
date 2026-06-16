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

    const disabledVencordPlugin = disableVencordCustomRpc();

    if (bridgeWasRunning && disabledVencordPlugin) {
      await showHUD(
        "🎮 Rich Presence stopped. Vencord CustomRPC disabled; restart Discord if it stays visible.",
      );
      return;
    }

    if (bridgeWasRunning) {
      await showHUD("🎮 Rich Presence stopped.");
      return;
    }

    if (disabledVencordPlugin) {
      await showHUD(
        "Vencord CustomRPC disabled. Restart Discord if the presence stays visible.",
      );
      return;
    }

    await showHUD("No Vencord CustomRPC settings found to disable.");
  } catch (error) {
    await showToast({
      title: "Failed to stop Rich Presence",
      message: error instanceof Error ? error.message : "Unknown error",
      style: Toast.Style.Failure,
    });
  }
}

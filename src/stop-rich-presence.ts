import { showHUD, showToast, Toast } from "@raycast/api";
import { isBridgeRunning, stopBridge } from "./utils/rpc";

export default async function Command() {
  if (!isBridgeRunning()) {
    await showHUD("No active Discord Rich Presence to stop.");
    return;
  }

  try {
    stopBridge();
    await showHUD("🎮 Discord Rich Presence stopped.");
  } catch (error) {
    await showToast({
      title: "Failed to stop Rich Presence",
      message: error instanceof Error ? error.message : "Unknown error",
      style: Toast.Style.Failure,
    });
  }
}

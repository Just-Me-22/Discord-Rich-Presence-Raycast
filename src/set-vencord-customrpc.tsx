import {
  Action,
  ActionPanel,
  Form,
  getPreferenceValues,
  showToast,
  Toast,
} from "@raycast/api";
import { useMemo, useState } from "react";
import { restartRunningDiscordClients } from "./utils/discord";
import {
  ActivityType,
  applyConfigLive,
  deletePreset,
  exportToVencord,
  getAllProfiles,
  getCurrentConfig,
  getPresetsForApp,
  importFirstFromVencord,
  importFromVencord,
  loadPreset,
  loadProfile,
  RpcConfig,
  savePreset,
  saveProfile,
  TimestampMode,
} from "./utils/rpc";

interface Preferences {
  defaultAppId?: string;
}

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const currentConfig = getCurrentConfig();

  // Resolve the best initial config: Vencord → running bridge → nothing.
  // Vencord should be the source of truth because this extension is meant
  // to edit the CustomRPC plugin settings from Raycast.
  const initialConfig = useMemo(() => {
    return importFirstFromVencord() ?? currentConfig;
  }, []);

  const [appId, setAppId] = useState(
    initialConfig?.clientId || preferences.defaultAppId || "",
  );
  const [appName, setAppName] = useState(initialConfig?.appName || "");
  const [details, setDetails] = useState(initialConfig?.details || "");
  const [detailsUrl, setDetailsUrl] = useState(initialConfig?.detailsUrl || "");
  const [state, setState] = useState(initialConfig?.state || "");
  const [stateUrl, setStateUrl] = useState(initialConfig?.stateUrl || "");
  const [activityType, setActivityType] = useState<string>(
    String(initialConfig?.activityType ?? ActivityType.PLAYING),
  );
  const [streamLink, setStreamLink] = useState(initialConfig?.streamLink || "");
  const [timestampMode, setTimestampMode] = useState<string>(
    initialConfig?.timestampMode || TimestampMode.NONE,
  );
  const [startTimestamp, setStartTimestamp] = useState<Date | null>(
    initialConfig?.startTimestamp
      ? new Date(initialConfig.startTimestamp)
      : null,
  );
  const [endTimestamp, setEndTimestamp] = useState<Date | null>(
    initialConfig?.endTimestamp ? new Date(initialConfig.endTimestamp) : null,
  );
  const [largeImageKey, setLargeImageKey] = useState(
    initialConfig?.largeImageKey || "",
  );
  const [largeImageText, setLargeImageText] = useState(
    initialConfig?.largeImageText || "",
  );
  const [largeImageUrl, setLargeImageUrl] = useState(
    initialConfig?.largeImageUrl || "",
  );
  const [smallImageKey, setSmallImageKey] = useState(
    initialConfig?.smallImageKey || "",
  );
  const [smallImageText, setSmallImageText] = useState(
    initialConfig?.smallImageText || "",
  );
  const [smallImageUrl, setSmallImageUrl] = useState(
    initialConfig?.smallImageUrl || "",
  );
  const [buttonOneText, setButtonOneText] = useState(
    initialConfig?.buttonOneText || "",
  );
  const [buttonOneUrl, setButtonOneUrl] = useState(
    initialConfig?.buttonOneUrl || "",
  );
  const [buttonTwoText, setButtonTwoText] = useState(
    initialConfig?.buttonTwoText || "",
  );
  const [buttonTwoUrl, setButtonTwoUrl] = useState(
    initialConfig?.buttonTwoUrl || "",
  );
  const [partySize, setPartySize] = useState(
    initialConfig?.partySize?.toString() || "",
  );
  const [partyMaxSize, setPartyMaxSize] = useState(
    initialConfig?.partyMaxSize?.toString() || "",
  );
  const [presetName, setPresetName] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [presetVersion, setPresetVersion] = useState(0);

  // Validation errors
  const [appIdError, setAppIdError] = useState<string | undefined>();
  const [appNameError, setAppNameError] = useState<string | undefined>();
  const [streamLinkError, setStreamLinkError] = useState<string | undefined>();

  function validateAppId(value: string): string | undefined {
    if (!value) return "Application ID is required";
    if (!/^\d{16,21}$/.test(value))
      return "Must be a valid Discord application ID (16-21 digits)";
    return undefined;
  }

  function validateAppName(value: string): string | undefined {
    if (!value) return "Application name is required";
    if (value.length > 128) return "Must be at most 128 characters";
    return undefined;
  }

  function validateStreamLink(value: string): string | undefined {
    if (!value) return undefined;
    if (!/^https?:\/\/(www\.)?(twitch\.tv|youtube\.com)\/\w+/.test(value))
      return "Must be a valid Twitch or YouTube URL";
    return undefined;
  }

  /** Populate every form field from a saved RpcConfig. */
  function applyProfile(profile: RpcConfig) {
    setAppId(profile.clientId);
    setAppName(profile.appName);
    setDetails(profile.details || "");
    setDetailsUrl(profile.detailsUrl || "");
    setState(profile.state || "");
    setStateUrl(profile.stateUrl || "");
    setActivityType(String(profile.activityType));
    setStreamLink(profile.streamLink || "");
    setTimestampMode(profile.timestampMode);
    setStartTimestamp(
      profile.startTimestamp ? new Date(profile.startTimestamp) : null,
    );
    setEndTimestamp(
      profile.endTimestamp ? new Date(profile.endTimestamp) : null,
    );
    setLargeImageKey(profile.largeImageKey || "");
    setLargeImageText(profile.largeImageText || "");
    setLargeImageUrl(profile.largeImageUrl || "");
    setSmallImageKey(profile.smallImageKey || "");
    setSmallImageText(profile.smallImageText || "");
    setSmallImageUrl(profile.smallImageUrl || "");
    setButtonOneText(profile.buttonOneText || "");
    setButtonOneUrl(profile.buttonOneUrl || "");
    setButtonTwoText(profile.buttonTwoText || "");
    setButtonTwoUrl(profile.buttonTwoUrl || "");
    setPartySize(profile.partySize?.toString() || "");
    setPartyMaxSize(profile.partyMaxSize?.toString() || "");
    setAppIdError(undefined);
    setAppNameError(undefined);
    setStreamLinkError(undefined);
  }

  /** When the user types/pastes an app ID, try to load a saved profile
   *  from Raycast first, then try Vencord's settings as a fallback. */
  function handleAppIdChange(value: string) {
    setAppId(value);
    setAppIdError(undefined);
    setSelectedPreset("");

    if (/^\d{16,21}$/.test(value)) {
      // 1) Try importing from Vencord's CustomRPC plugin first.
      // This reads whatever values the user currently has configured there.
      const vencordConfig = importFromVencord(value);
      if (vencordConfig) {
        applyProfile(vencordConfig);
        saveProfile(vencordConfig);
        showToast({
          title: "Imported from Vencord CustomRPC",
          style: Toast.Style.Success,
        });
        return;
      }

      // 2) Fall back to a Raycast-saved profile only if Vencord has no match.
      const profile = loadProfile(value);
      if (profile) {
        applyProfile(profile);
        showToast({
          title: "Loaded saved profile",
          style: Toast.Style.Success,
        });
        return;
      }

      showToast({
        title: "No Vencord config found for this app ID",
        message: "Fill out the form manually — it will be saved for next time.",
        style: Toast.Style.Animated,
      });
    }
  }

  const savedProfiles = useMemo(() => getAllProfiles(), []);
  const appPresets = useMemo(
    () => getPresetsForApp(appId),
    [appId, presetVersion],
  );

  function buildConfig(): RpcConfig {
    const config: RpcConfig = {
      clientId: appId,
      appName,
      details: details || undefined,
      detailsUrl: detailsUrl || undefined,
      state: state || undefined,
      stateUrl: stateUrl || undefined,
      activityType: parseInt(activityType) as ActivityType,
      streamLink:
        activityType === String(ActivityType.STREAMING)
          ? streamLink
          : undefined,
      timestampMode: timestampMode as TimestampMode,
      startTimestamp: startTimestamp?.getTime(),
      endTimestamp: endTimestamp?.getTime(),
      largeImageKey: largeImageKey || undefined,
      largeImageText: largeImageText || undefined,
      largeImageUrl: largeImageUrl || undefined,
      smallImageKey: smallImageKey || undefined,
      smallImageText: smallImageText || undefined,
      smallImageUrl: smallImageUrl || undefined,
      buttonOneText: buttonOneText || undefined,
      buttonOneUrl: buttonOneUrl || undefined,
      buttonTwoText: buttonTwoText || undefined,
      buttonTwoUrl: buttonTwoUrl || undefined,
      partySize: partySize ? parseInt(partySize) : undefined,
      partyMaxSize: partyMaxSize ? parseInt(partyMaxSize) : undefined,
    };

    switch (timestampMode) {
      case TimestampMode.NOW:
        config.startTimestamp = Date.now();
        config.endTimestamp = undefined;
        break;
      case TimestampMode.TIME:
        config.startTimestamp =
          Date.now() -
          (new Date().getHours() * 3600 +
            new Date().getMinutes() * 60 +
            new Date().getSeconds()) *
            1000;
        config.endTimestamp = undefined;
        break;
      case TimestampMode.CUSTOM:
        break;
      case TimestampMode.NONE:
      default:
        config.startTimestamp = undefined;
        config.endTimestamp = undefined;
        break;
    }

    return config;
  }

  async function handleSubmit() {
    // Validate required fields
    const appIdErr = validateAppId(appId);
    const appNameErr = validateAppName(appName);
    setAppIdError(appIdErr);
    setAppNameError(appNameErr);

    // Validate stream link if streaming
    let streamErr: string | undefined;
    if (isStreaming) {
      streamErr = validateStreamLink(streamLink);
      setStreamLinkError(streamErr);
    }

    if (appIdErr || appNameErr || streamErr) {
      await showToast({
        title: "Please fix the errors",
        style: Toast.Style.Failure,
      });
      return;
    }

    const config = buildConfig();

    // Persist this config as a named profile so pasting the
    // app ID later instantly restores all fields.
    saveProfile(config);

    // Also write back to Vencord's settings.json so the
    // CustomRPC plugin stays in sync (picks up on next launch).
    const synced = exportToVencord(config);

    try {
      if (synced) {
        const restarted = await restartRunningDiscordClients();
        if (restarted.length > 0) {
          await showToast({
            title: "Discord Rich Presence updated",
            message: `Vencord settings saved. Restarted ${restarted.join(", ")}.`,
            style: Toast.Style.Success,
          });
          return;
        }

        await showToast({
          title: "Rich Presence saved",
          message: "Vencord settings saved. Discord was not running.",
          style: Toast.Style.Success,
        });
        return;
      }

      const liveResult = await applyConfigLive(config);

      if (liveResult.live) {
        const message = synced
          ? "Live activity updated. Vencord settings were saved for next launch."
          : "Live activity updated. Vencord settings file was not found.";
        await showToast({
          title: "Discord Rich Presence updated",
          message,
          style: Toast.Style.Success,
        });
      } else {
        await showToast({
          title: "Rich Presence saved",
          message:
            liveResult.error ??
            "Could not confirm the live Discord RPC bridge is connected.",
          style: Toast.Style.Success,
        });
      }
    } catch (error) {
      await showToast({
        title: "Failed to set Rich Presence",
        message: error instanceof Error ? error.message : "Unknown error",
        style: Toast.Style.Failure,
      });
    }
  }

  async function handleRestartDiscord() {
    const toast = await showToast({
      title: "Restarting Discord…",
      message: "Reloading Vencord CustomRPC settings from disk",
      style: Toast.Style.Animated,
    });

    try {
      const restarted = await restartRunningDiscordClients();

      if (restarted.length === 0) {
        toast.style = Toast.Style.Failure;
        toast.title = "No running Discord clients found";
        return;
      }

      toast.style = Toast.Style.Success;
      toast.title = `Restarted ${restarted.join(", ")}`;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to restart Discord";
      toast.message = error instanceof Error ? error.message : "Unknown error";
    }
  }

  async function handleSavePreset() {
    const appIdErr = validateAppId(appId);
    const appNameErr = validateAppName(appName);
    setAppIdError(appIdErr);
    setAppNameError(appNameErr);

    if (appIdErr || appNameErr) {
      await showToast({
        title: "Fix Application ID and Name first",
        style: Toast.Style.Failure,
      });
      return;
    }

    try {
      const preset = savePreset(appId, presetName, buildConfig());
      setSelectedPreset(preset.name);
      setPresetVersion((v) => v + 1);
      await showToast({
        title: "Preset saved",
        message: preset.name,
        style: Toast.Style.Success,
      });
    } catch (error) {
      await showToast({
        title: "Failed to save preset",
        message: error instanceof Error ? error.message : "Unknown error",
        style: Toast.Style.Failure,
      });
    }
  }

  async function handleDeletePreset() {
    if (!selectedPreset) {
      await showToast({
        title: "Select a preset first",
        style: Toast.Style.Failure,
      });
      return;
    }

    const deleted = deletePreset(appId, selectedPreset);
    if (deleted) {
      setSelectedPreset("");
      setPresetVersion((v) => v + 1);
      await showToast({
        title: "Preset deleted",
        style: Toast.Style.Success,
      });
    }
  }

  const isStreaming = activityType === String(ActivityType.STREAMING);
  const isPlaying = activityType === String(ActivityType.PLAYING);
  const isCustomTimestamp = timestampMode === TimestampMode.CUSTOM;

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Set Rich Presence"
            onSubmit={handleSubmit}
          />
          <Action
            title="Save Current Fields as Preset"
            onAction={handleSavePreset}
          />
          <Action title="Restart Discord" onAction={handleRestartDiscord} />
          {selectedPreset && (
            <Action
              title="Delete Selected Preset"
              onAction={handleDeletePreset}
            />
          )}
          <Action.OpenInBrowser
            title="Open Discord Developer Portal"
            url="https://discord.com/developers/applications"
          />
        </ActionPanel>
      }
      searchBarAccessory={
        <Form.LinkAccessory
          text="Dev Portal"
          target="https://discord.com/developers/applications"
        />
      }
    >
      <Form.Description
        title="Discord Rich Presence"
        text="Configure your custom Rich Presence status. You need a Discord Application ID from the Developer Portal."
      />

      {savedProfiles.length > 0 && (
        <Form.Dropdown
          id="savedProfile"
          title="Load Saved Profile"
          info="Quickly load a previously saved configuration"
          onChange={(clientId) => {
            const profile = loadProfile(clientId);
            if (profile) applyProfile(profile);
          }}
          value=""
        >
          <Form.Dropdown.Item value="" title="— Select a saved profile —" />
          {savedProfiles.map((p) => (
            <Form.Dropdown.Item
              key={p.clientId}
              value={p.clientId}
              title={`${p.appName} (${p.clientId})`}
            />
          ))}
        </Form.Dropdown>
      )}

      {/* Application Info */}
      <Form.Separator />
      <Form.TextField
        id="appId"
        title="Application ID"
        placeholder="1234567890123456789"
        value={appId}
        onChange={handleAppIdChange}
        error={appIdError}
        info="Paste your app ID to auto-load a saved profile. Get one at discord.com/developers/applications"
      />
      <Form.TextField
        id="appName"
        title="Application Name"
        placeholder="My Cool App"
        value={appName}
        onChange={(v) => {
          setAppName(v);
          setAppNameError(undefined);
        }}
        error={appNameError}
        info="The name that appears at the top of your Rich Presence"
      />

      {appPresets.length > 0 && (
        <Form.Dropdown
          id="preset"
          title="Load Preset"
          value={selectedPreset}
          info="Presets are saved per application ID"
          onChange={(name) => {
            setSelectedPreset(name);
            if (!name) return;

            const preset = loadPreset(appId, name);
            if (preset) {
              setPresetName(preset.name);
              applyProfile(preset.config);
              showToast({
                title: "Preset loaded",
                message: preset.name,
                style: Toast.Style.Success,
              });
            }
          }}
        >
          <Form.Dropdown.Item value="" title="— Select a preset —" />
          {appPresets.map((preset) => (
            <Form.Dropdown.Item
              key={preset.name}
              value={preset.name}
              title={preset.name}
            />
          ))}
        </Form.Dropdown>
      )}

      <Form.TextField
        id="presetName"
        title="Preset Name"
        placeholder="Gaming, Music, Working…"
        value={presetName}
        onChange={setPresetName}
        info="Use Ctrl+K → Save Current Fields as Preset to save these fields"
      />

      {/* Activity Details */}
      <Form.Separator />
      <Form.Description
        title="Activity Details"
        text="What's shown below your app name."
      />
      <Form.Dropdown
        id="activityType"
        title="Activity Type"
        value={activityType}
        onChange={setActivityType}
        info="The type of activity: Playing, Streaming, Listening, Watching, or Competing"
      >
        <Form.Dropdown.Item
          value={String(ActivityType.PLAYING)}
          title="Playing"
        />
        <Form.Dropdown.Item
          value={String(ActivityType.STREAMING)}
          title="Streaming"
        />
        <Form.Dropdown.Item
          value={String(ActivityType.LISTENING)}
          title="Listening"
        />
        <Form.Dropdown.Item
          value={String(ActivityType.WATCHING)}
          title="Watching"
        />
        <Form.Dropdown.Item
          value={String(ActivityType.COMPETING)}
          title="Competing"
        />
      </Form.Dropdown>
      <Form.TextField
        id="details"
        title="Details (line 1)"
        placeholder="What you're doing"
        value={details}
        onChange={setDetails}
        info="First line of text shown in your status (max 128 chars)"
      />
      <Form.TextField
        id="detailsUrl"
        title="Details URL"
        placeholder="https://..."
        value={detailsUrl}
        onChange={setDetailsUrl}
        info="Clickable URL for the details line"
      />
      <Form.TextField
        id="state"
        title="State (line 2)"
        placeholder="More details"
        value={state}
        onChange={setState}
        info="Second line of text shown in your status (max 128 chars)"
      />
      <Form.TextField
        id="stateUrl"
        title="State URL"
        placeholder="https://..."
        value={stateUrl}
        onChange={setStateUrl}
        info="Clickable URL for the state line"
      />

      {isStreaming && (
        <Form.TextField
          id="streamLink"
          title="Stream Link"
          placeholder="https://twitch.tv/yourchannel"
          value={streamLink}
          onChange={(v) => {
            setStreamLink(v);
            setStreamLinkError(undefined);
          }}
          error={streamLinkError}
          info="Your Twitch or YouTube stream URL"
        />
      )}

      {/* Timestamps */}
      <Form.Separator />
      <Form.Description
        title="Timestamps"
        text="How elapsed time is displayed."
      />
      <Form.Dropdown
        id="timestampMode"
        title="Timestamp Mode"
        value={timestampMode}
        onChange={setTimestampMode}
        info="How the time counter should behave"
      >
        <Form.Dropdown.Item value={TimestampMode.NONE} title="None" />
        <Form.Dropdown.Item
          value={TimestampMode.NOW}
          title="Since now (elapsed timer)"
        />
        <Form.Dropdown.Item
          value={TimestampMode.TIME}
          title="Current time of day"
        />
        <Form.Dropdown.Item
          value={TimestampMode.CUSTOM}
          title="Custom (set below)"
        />
      </Form.Dropdown>

      {isCustomTimestamp && (
        <>
          <Form.DatePicker
            id="startTimestamp"
            title="Start Time"
            value={startTimestamp}
            onChange={setStartTimestamp}
            type={Form.DatePicker.Type.DateTime}
            info="When the activity started"
          />
          <Form.DatePicker
            id="endTimestamp"
            title="End Time"
            value={endTimestamp}
            onChange={setEndTimestamp}
            type={Form.DatePicker.Type.DateTime}
            info="When the activity will end (shows countdown)"
          />
        </>
      )}

      {/* Images */}
      <Form.Separator />
      <Form.Description
        title="Images"
        text="Upload images in the Rich Presence > Art Assets section of your Discord application."
      />
      <Form.TextField
        id="largeImageKey"
        title="Large Image Key"
        placeholder="my-image-key"
        value={largeImageKey}
        onChange={setLargeImageKey}
        info="The asset key from Discord Developer Portal, or an image URL"
      />
      <Form.TextField
        id="largeImageText"
        title="Large Image Tooltip"
        placeholder="Image description"
        value={largeImageText}
        onChange={setLargeImageText}
        info="Text shown when hovering over the large image"
      />
      <Form.TextField
        id="largeImageUrl"
        title="Large Image Click URL"
        placeholder="https://..."
        value={largeImageUrl}
        onChange={setLargeImageUrl}
        info="Where clicking the large image goes"
      />
      <Form.TextField
        id="smallImageKey"
        title="Small Image Key"
        placeholder="my-small-key"
        value={smallImageKey}
        onChange={setSmallImageKey}
        info="The asset key for the small overlay image"
      />
      <Form.TextField
        id="smallImageText"
        title="Small Image Tooltip"
        placeholder="Small image description"
        value={smallImageText}
        onChange={setSmallImageText}
        info="Text shown when hovering over the small image"
      />
      <Form.TextField
        id="smallImageUrl"
        title="Small Image Click URL"
        placeholder="https://..."
        value={smallImageUrl}
        onChange={setSmallImageUrl}
        info="Where clicking the small image goes"
      />

      {/* Buttons */}
      <Form.Separator />
      <Form.Description
        title="Buttons"
        text="Up to two clickable buttons on your Rich Presence."
      />
      <Form.TextField
        id="buttonOneText"
        title="Button 1 Text"
        placeholder="Join me!"
        value={buttonOneText}
        onChange={setButtonOneText}
        info="Label for the first button (max 31 chars)"
      />
      <Form.TextField
        id="buttonOneUrl"
        title="Button 1 URL"
        placeholder="https://..."
        value={buttonOneUrl}
        onChange={setButtonOneUrl}
        info="URL for the first button"
      />
      <Form.TextField
        id="buttonTwoText"
        title="Button 2 Text"
        placeholder="Website"
        value={buttonTwoText}
        onChange={setButtonTwoText}
        info="Label for the second button (max 31 chars)"
      />
      <Form.TextField
        id="buttonTwoUrl"
        title="Button 2 URL"
        placeholder="https://..."
        value={buttonTwoUrl}
        onChange={setButtonTwoUrl}
        info="URL for the second button"
      />

      {/* Party */}
      {isPlaying && (
        <>
          <Form.Separator />
          <Form.Description
            title="Party"
            text="Show party size info (only for Playing type)."
          />
          <Form.TextField
            id="partySize"
            title="Party Size"
            placeholder="1"
            value={partySize}
            onChange={setPartySize}
            info="Current number of party members"
          />
          <Form.TextField
            id="partyMaxSize"
            title="Max Party Size"
            placeholder="5"
            value={partyMaxSize}
            onChange={setPartyMaxSize}
            info="Maximum number of party members"
          />
        </>
      )}
    </Form>
  );
}

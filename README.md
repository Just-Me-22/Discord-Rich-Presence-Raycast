# Vencord CustomRPC Integration

Control and customize your Discord Rich Presence directly from Raycast.

**⚠️ IMPORTANT NOTE:** This extension does *not* provide a standalone custom rich presence. It is specifically built for and requires the [CustomRPC plugin](https://github.com/Vencord/Vencord/tree/main/src/plugins/customRPC) from [Vencord](https://vencord.dev/). **If you do not use Vencord with the CustomRPC plugin enabled, this extension will not work for you.**

## Features

- **Live Updates**: Update your CustomRPC presence instantly through Raycast without restarting Discord.
- **Vencord Integration**: Seamlessly reads from and writes to your current CustomRPC settings inside Vencord (supports Stable, PTB, and Canary).
- **Profiles & Presets**: Keep track of your last-used profiles per Application ID and save reusable configurations to load instantly.
- **Easy Toggle**: Set or Stop your Rich Presence effortlessly with built-in commands.

## Prerequisites

- [Discord](https://discord.com/) must be installed and running locally.
- [Vencord](https://vencord.dev/) must be installed.
- The **CustomRPC** plugin must be enabled in your Vencord settings.
- **Activity Sharing** must be enabled in your Discord settings (`Settings` -> `Activity Privacy` -> `Share your detected activities with others`).

## Getting Started

1. Open the **Set Rich Presence** command.
2. Enter your **Application ID** or paste an existing one. If you have Vencord configured with CustomRPC, the fields will auto-fill from your existing settings.
3. Configure your custom presence (App Name, Details, State, Images, Buttons).
4. Hit `Cmd/Ctrl + Enter` to **Set Rich Presence**.

### Presets

You can save your current configuration as a preset for the current App ID. Open the action menu and select **Save as Preset**. Later, you can load it using the **Load Preset** dropdown menu.

## Known Limitations

- **Vencord In-Memory State**: Vencord caches its settings in-memory while Discord is running. Although this extension updates your live Discord presence immediately (via IPC bridge) and saves to your `settings.json`, Vencord's own settings UI will not reflect these changes until Discord is restarted.

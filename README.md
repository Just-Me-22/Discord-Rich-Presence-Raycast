# Discord Rich Presence Integration

Control and customize your Discord Rich Presence directly from Raycast.

This extension provides a rich interface to easily update your custom Discord Rich Presence on the fly using a background bridge. It is fully compatible with [Vencord's CustomRPC](https://vencord.dev/).

## Features

- **Live Updates**: Update your presence instantly through Raycast without restarting Discord.
- **Vencord Import**: Seamlessly import your current CustomRPC settings from Vencord automatically (supports Stable, PTB, and Canary).
- **Profiles & Presets**: Keep track of your last-used profiles per Application ID and save reusable configurations to load instantly.
- **Easy Toggle**: Set or Stop your Rich Presence effortlessly with built-in commands.

## Prerequisites

- [Discord](https://discord.com/) must be installed and running.
- **Activity Sharing** must be enabled in your Discord settings (`Settings` -> `Activity Privacy` -> `Share your detected activities with others`).
- You need a Discord Application ID from the [Discord Developer Portal](https://discord.com/developers/applications) if you aren't importing directly from Vencord.

## Getting Started

1. Open the **Set Rich Presence** command.
2. Enter your **Application ID** or paste an existing one. If you have Vencord installed and configured with CustomRPC, the fields will auto-fill automatically.
3. Configure your custom presence (App Name, Details, State, Images, Buttons).
4. Hit `Cmd/Ctrl + Enter` to **Set Rich Presence**.

### Presets

You can save your current configuration as a preset for the current App ID. Open the action menu and select **Save as Preset**. Later, you can load it using the **Load Preset** dropdown menu.

## Known Limitations

- **Vencord In-Memory State**: Vencord caches its settings in-memory while Discord is running. Although this extension updates your live Discord presence immediately (via IPC bridge), Vencord's own settings UI will not reflect these changes until Discord is restarted.
- Only works when the Discord desktop application is running locally.

# Discord Rich Presence Integration Changelog

## [Initial Release] - 2026-06-16

### Added
- **Live Presence Updates**: Added a background IPC bridge to push changes to Discord Rich Presence in real-time.
- **Vencord Integration**: Added seamless automatic import of `CustomRPC` settings from Vencord (`settings.json`). Supports Stable, PTB, and Canary installations.
- **Profiles & Presets System**:
  - Automatically save the last used profile for each Application ID.
  - Ability to save, load, and delete named Presets per Application ID.
- **Form Actions & Feedback**:
  - Non-destructive form actions to update presence with Toast notifications.
  - Friendly "Restart Discord" utility action for refreshing Vencord's in-memory state if needed.
- **Commands**:
  - `Set Vencord CustomRPC` to configure and deploy a custom presence.
  - `Stop Vencord CustomRPC` to disable the CustomRPC plugin and automatically restart Discord.

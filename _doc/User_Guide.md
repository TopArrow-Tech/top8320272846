# StagePilot — User guide

First time here? Follow these 8 steps to run a multi-screen show.

## Three ideas to start with

An event holds your show. A logical screen is a content destination such as Main or Side. A display is a physical TV or computer running a browser. Each display binds to one logical screen; several displays can share one screen.

## 1. Create an event

Open Activities → New activity, enter a name and save. The top dropdown selects the event you are editing. Screens, media and scenes belong to that event.

## 2. Add logical screens

Open Displays → Add screen. Create names such as Main and Welcome. This defines content destinations; it does not connect a physical TV yet.

## 3. Import images and videos

Open Media library → Import media and choose local files. PNG, JPG, GIF, WebP, MP4, WebM and MOV are supported, up to 256MB each. Files are copied into the app data directory. Add text directly in a scene. Start with one image before testing video.

## 4. Compose and save a scene

Open Scenes → New scene and name it. Select a logical screen at the top, then add text or choose an image/video. Configure each screen separately. Select a layer to drag it or edit X/Y/W/H percentages, region presets, stacking, text color, video mute and volume. Save the scene. A scene is one complete program across your screens. Choose an effect for the selected layer. Shorter cycles move faster. Display animations follow the screen timeline and pause with playback.

## 5. Open the LAN display service

Connect the controller and TVs to the same LAN. Open Connection & recovery, select the interface, accept the HTTP notice and open the LAN display service. Note the display address and six-digit pairing code. HTTP is unencrypted; use a trusted network. Codes last ten minutes and can be refreshed.

## 6. Pair each TV and assign its screen

Enter the complete display address in the TV browser, including http://, port and /display. Enter a device name and code, then request pairing. On the controller, open Displays, approve the pending request, choose its logical screen and save. Repeat for each device. Entering the code alone does not approve a display.

## 7. Enter display mode, then take a scene

After approval, click Enter display & enable audio on the TV. On the controller, open Scenes and take your saved scene. Playback is scheduled about three seconds ahead; slower displays may appear later. Displays shows online status, readiness, scene version and playback drift.

## 8. Run and finish the show

Prepare several scenes, then take them from Overview or Scenes during the show. Pause playback / Resume playback controls the timeline. Blackout & mute / Reveal & restore audio hides the picture and stops sound temporarily. Stop show clears the active output. Close LAN when finished. Stop the show and close LAN before creating or restoring a  Taking a scene updates only its configured screens. Other screens keep playing without going black or restarting. Configure several screens in one scene to switch them together. An explicitly saved empty layer layout clears that screen.

## Archive events and permanent deletion

Archiving moves an event from Activities to Archive manager without deleting media. Search by name or notes, inspect contents, restore, or review impact before permanent deletion. Restore an event to edit and run it again.

## Back up, share and restore work

Open Work backups, optionally enter a name and click Manual backup. All saved activities, archives, media, screens, scene layouts and effects go into a single file in the data directory backups folder. Unsaved edits are excluded. Open containing folder to copy or share it. On another computer install StagePilot, choose Import backup file, select the .spbackup file, review its contents and confirm restoration. Restoration replaces current work after saving a safety backup. Pair displays again. Deletion removes only the backup file; removing the file manually also removes its list entry on refresh. No scheduled or code backups.

## The TV cannot open the display address

Check that LAN is open, the full address and port are correct, and devices can reach each other. Guest Wi-Fi, AP isolation, VPNs or a firewall may block access. With multiple interfaces, choose the TV’s network. If a port is occupied, reset it while LAN is closed and open again.

## Connected but no picture

Check approval, the assigned logical screen, content for that screen in the scene, and whether the scene was saved and taken. Check that blackout is off. Waiting for a scene immediately after pairing is normal.

## No sound or video playback

Click Enter display & enable audio again on the TV. Unmute the video layer, raise its volume and check the TV volume. Codec support varies; H.264 MP4 is recommended. Convert unsupported videos using another tool before importing; the app does not transcode.

## Screens are out of sync

For synchronized playback, configure the target screens in one scene and take it together. Independently running scenes can have different versions. Inspect drift; prefer wired networking, similar hardware and media. Browsers do not guarantee frame accuracy.

## What happens after disconnect or restart

During disconnection, available content is retained and video can use existing buffers. Reconnection follows the current scene. Controller restart closes LAN and does not autoplay. Reopen LAN, then restore the last scene or take another scene manually.

## Where is data stored?

Activities, media and scenes stay in the platform data directory and are excluded from the app package. Do not move individual media files. Deletion shows affected scenes, screens and devices before confirmation and stops only affected screens.

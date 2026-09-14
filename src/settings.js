"use strict";

// Shared by the options page and content script. Missing/new settings stay on.
globalThis.YTWindowSettings = (() => {
  const controls = [
    ["play", "Play / pause", ".ytp-play-button"],
    ["previous", "Previous video", ".ytp-prev-button"],
    ["next", "Next video", ".ytp-next-button"],
    ["volume", "Mute and volume", ".ytp-volume-area"],
    ["time", "Elapsed time and duration", ".ytp-time-display"],
    ["chapter", "Chapter title", ".ytp-chapter-container"],
    ["progress", "Progress / seek bar", ".ytp-progress-bar-container"],
    ["ratings", "Like / dislike buttons", "#yt-window-rating-controls"],
    ["autoplay", "Autoplay switch", ":is(.ytp-autonav-toggle, .ytp-autonav-toggle-button-container, .ytp-autonav-toggle-button, .ytp-button:has(.ytp-autonav-toggle-button))"],
    ["captions", "Captions button", ".ytp-subtitles-button"],
    ["settings", "Quality, speed and settings", ".ytp-settings-button"],
    ["miniplayer", "Miniplayer", ".ytp-miniplayer-button"],
    ["pip", "Picture-in-picture", ".ytp-pip-button"],
    ["theater", "Theater mode", ".ytp-size-button"],
    ["cast", "Cast / play on TV", ".ytp-remote-button"],
    ["fullscreen", "Native fullscreen", ".ytp-fullscreen-button"],
    ["windowFullscreen", "Faux fullscreen", "#yt-window-fullscreen-button"],
    ["title", "Video overlay: video title", ".ytp-title"],
    ["watchLater", "Video overlay: watch later", ".ytp-watch-later-button"],
    ["share", "Video overlay: share", ".ytp-share-button"],
    ["cards", "Video overlay: info cards", ".ytp-cards-button"],
    ["more", "Video overlay: more actions", ".ytp-overflow-button"],
    ["headerMenu", "Menu (three lines)", "#guide-button", "header"],
    ["headerLogo", "YouTube logo", "#logo", "header"],
    ["headerSearch", "Search box and button", ":is(ytd-searchbox, yt-searchbox, #search-container, #search-button)", "header"],
    ["headerVoice", "Voice search (microphone)", "#voice-search-button", "header"],
    ["headerCreate", "Create", ":is(#create-icon, #buttons > ytd-button-renderer:has(button[aria-label='Create'], a[href*='/upload']), ytd-topbar-menu-button-renderer:has(button[aria-label='Create']), yt-button-shape:has(button[aria-label='Create']))", "header"],
    ["headerNotifications", "Notifications", "ytd-notification-topbar-button-renderer", "header"],
    ["headerProfile", "Profile / account", "#avatar-btn", "header"]
  ].map(([id, label, selector, group = "player"]) => ({ id, label, selector, group }));
  const key = "toolbarVisibility";
  function normalize(value) {
    const result = Object.fromEntries(controls.map(({ id }) => [id, value?.[id] !== false]));
    // Honor an existing hidden rating button when migrating separate switches.
    result.ratings = typeof value?.ratings === "boolean"
      ? value.ratings : value?.like !== false && value?.dislike !== false;
    return result;
  }

    const preferencesKey = "playerPreferences";
    const behaviors = [
      { id: "autoEnter", label: "Automatically enter faux fullscreen on playback", defaultValue: true },
      { id: "autoExit", label: "Exit when the video ends", defaultValue: true },
      { id: "keepToolbarVisible", label: "Keep the toolbar visible", defaultValue: false }
    ];
    function normalizePreferences(value) {
      const result = Object.fromEntries(behaviors.map(({ id, defaultValue }) =>
        [id, typeof value?.[id] === "boolean" ? value[id] : defaultValue]));
      result.theme = ["system", "light", "dark"].includes(value?.theme) ? value.theme : "system";
      return result;
    }
    return { controls, key, normalize, preferencesKey, behaviors, normalizePreferences };

})();

// Chromium loads this file as a service worker; Firefox loads the helper first.
if (typeof importScripts === "function") importScripts("extension-api.js");

YTWindowExtension.action.onClicked.addListener(() => {
  YTWindowExtension.runtime.openOptionsPage();
});

(() => {
  "use strict";


  const toolbarSettings = globalThis.YTWindowSettings;
  const toolbarStyle = document.createElement("style");
  toolbarStyle.id = "yt-window-toolbar-preferences";
  document.documentElement.appendChild(toolbarStyle);

  function applyToolbarPreferences(value) {
    const visibility = toolbarSettings.normalize(value);
    const scope = "html.yt-window-fullscreen #movie_player.yt-window-fullscreen-player";
    const rules = toolbarSettings.controls
      .filter(({ id }) => !visibility[id])
      .map(({ selector, group }) => {
        const target = group === "header"
          ? "html.yt-window-fullscreen #masthead-container"
          : scope;
        return target + " " + selector + " { display: none !important; }";
      });
    const css = rules.join("\n");
    if (toolbarStyle.textContent !== css) toolbarStyle.textContent = css;
    window.dispatchEvent(new Event("resize"));
  }


    let playerPreferences = toolbarSettings.normalizePreferences();
    let preferencesReady = false;
    const changedSettings = new Set();

    function applyPlayerPreferences(value) {
      playerPreferences = toolbarSettings.normalizePreferences(value);
      preferencesReady = true;
      document.documentElement.classList.toggle("yt-window-toolbar-pinned", playerPreferences.keepToolbarVisible);
      autoActivate();
      checkPlaybackEnded();
    }

    YTWindowExtension.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      for (const key of Object.keys(changes)) changedSettings.add(key);
      if (changes[toolbarSettings.key]) applyToolbarPreferences(changes[toolbarSettings.key].newValue);
      if (changes[toolbarSettings.preferencesKey]) applyPlayerPreferences(changes[toolbarSettings.preferencesKey].newValue);
    });
    YTWindowExtension.storage.local.get([toolbarSettings.key, toolbarSettings.preferencesKey]).then((result) => {
      if (!changedSettings.has(toolbarSettings.key)) applyToolbarPreferences(result[toolbarSettings.key]);
      if (!changedSettings.has(toolbarSettings.preferencesKey)) applyPlayerPreferences(result[toolbarSettings.preferencesKey]);
    }).catch(() => {
      if (!preferencesReady) applyPlayerPreferences();
    });

    const ROOT_CLASS = "yt-window-fullscreen";
  const PLAYER_CLASS = "yt-window-fullscreen-player";
  const BUTTON_ID = "yt-window-fullscreen-button";
  const SHORTS_CLASS = "yt-window-shorts";
  const RATING_ID = "yt-window-rating-controls";
  let ratingSource = null;
  const ratingObserver = new MutationObserver(updateRatingControls);

  function getActiveShort() {
    if (navigating || !isShortsPage()) return null;
    const reels = [...document.querySelectorAll("ytd-shorts ytd-reel-video-renderer")];
    const reel = reels.find(item => item.hasAttribute("is-active")) ||
      reels.find(item => {
        const video = item.querySelector("video");
        const bounds = item.getBoundingClientRect();
        return video && !video.paused && bounds.top < innerHeight && bounds.bottom > 0;
      });
    if (!reel) return null;
    const id = reel.getAttribute("video-id");
    if (id && id !== location.pathname.split("/")[2]) return null;
    return reel;
  }

  function getRatingSource() {
    if (isShortsPage()) return getActiveShort();
    const metadata = document.querySelector("ytd-watch-metadata");
    return metadata?.querySelector(
      "segmented-like-dislike-button-view-model, ytd-segmented-like-dislike-button-renderer"
    ) || metadata?.querySelector("#top-level-buttons-computed");
  }

  function getRatingButton(kind) {
    return getRatingSource()?.querySelector(
      kind + "-button-view-model button, #" + kind + "-button button, " +
      "#" + kind + "-button [role='button']"
    ) || null;
  }

  const rememberedCreators = new Set();
  const creatorChanges = new Set();
  const manuallyRatedVideos = new Set();
  const autoLikeAttempts = new Set();
  let navigating = false;
  let watchedVideo = "";
  let watchedSeconds = 0;
  let previousPosition = null;
  let previousTick = performance.now();

  YTWindowExtension.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith("autoLikeCreator:")) continue;
      creatorChanges.add(key);
      if (typeof change.newValue === "string") rememberedCreators.add(key);
      else rememberedCreators.delete(key);
    }
  });
  YTWindowExtension.storage.local.get(null).then(result => {
    for (const [key, name] of Object.entries(result)) {
      if (key.startsWith("autoLikeCreator:") && typeof name === "string" && !creatorChanges.has(key)) rememberedCreators.add(key);
    }
  }).catch(() => {});

  function getCreator() {
    if (navigating || !getVideoKey()) return null;
    let link;
    if (isShortsPage()) {
      link = getActiveShort()?.querySelector(
        "#channel-name a[href], ytd-channel-name a[href], " +
        "yt-reel-channel-bar-view-model a[href^='/@'], yt-reel-channel-bar-view-model a[href^='/channel/']"
      );
    } else {
      const watch = document.querySelector("ytd-watch-flexy");
      if (location.pathname !== "/watch" ||
          watch?.getAttribute("video-id") !== new URLSearchParams(location.search).get("v")) return null;
      link = document.querySelector("ytd-watch-metadata #owner ytd-channel-name a[href]");
    }
    if (!link) return null;
    const path = new URL(link.href, location.href).pathname.replace(/\/$/, "");
    if (!/^\/(channel\/[^/]+|@[^/]+)$/.test(path)) return null;
    const name = link.textContent.trim();
    return name ? { key: "autoLikeCreator:" + path, name } : null;
  }

  document.addEventListener("yt-navigate-start", () => {
    navigating = true;
    watchedVideo = "";
    watchedSeconds = 0;
    previousPosition = null;
  });
  document.addEventListener("yt-navigate-finish", () => { navigating = false; });

  document.addEventListener("click", event => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const button = event.target.closest("button, [role='button']");
    const toolbarKind = button?.closest("#" + RATING_ID) ? button.dataset.rating : null;
    const kind = toolbarKind || (button === getRatingButton("like") ? "like" :
      button === getRatingButton("dislike") ? "dislike" : null);
    if (!kind) return;
    const videoKey = getVideoKey();
    manuallyRatedVideos.add(videoKey);
    if (!preferencesReady || !playerPreferences.autoLike || kind !== "like") return;
    const creator = getCreator();
    const nativeButton = getRatingButton("like");
    if (!creator || nativeButton?.getAttribute("aria-pressed") !== "false") return;
    // Wait for YouTube to confirm the manual like before remembering its creator.
    let checks = 0;
    const timer = setInterval(() => {
      if (getVideoKey() !== videoKey || navigating || !playerPreferences.autoLike || ++checks > 10) {
        clearInterval(timer);
        return;
      }
      if (getRatingButton("like")?.getAttribute("aria-pressed") !== "true") return;
      clearInterval(timer);
      YTWindowExtension.storage.local.set({ [creator.key]: creator.name }).catch(() => {});
    }, 200);
  }, true);

  setInterval(() => {
    const now = performance.now();
    const elapsed = Math.min((now - previousTick) / 1000, 2);
    previousTick = now;
    const videoKey = getVideoKey();
    if (videoKey !== watchedVideo) {
      watchedVideo = videoKey;
      watchedSeconds = 0;
      previousPosition = null;
    }
    const player = isShortsPage()
      ? getActiveShort()?.querySelector(".html5-video-player") : getPlayer();
    const video = player?.querySelector("video");
    if (!preferencesReady || !playerPreferences.autoLike || navigating ||
        !videoKey || !video || video.paused || video.ended || video.seeking ||
        video.readyState < 3 || isShowingAd(player)) {
      previousPosition = null;
      return;
    }
    const position = video.currentTime;
    if (previousPosition !== null) {
      const advance = position - previousPosition;
      if (advance > 0 && advance <= elapsed * video.playbackRate + 0.5) watchedSeconds += elapsed;
    }
    previousPosition = position;
    // Short clips need a chance to qualify before playback stops at the end.
    const threshold = isShortsPage() && Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(25, video.duration * 0.9 / video.playbackRate) : (isShortsPage() ? 25 : 60);
    if (watchedSeconds < threshold || manuallyRatedVideos.has(videoKey) || autoLikeAttempts.has(videoKey)) return;
    const creator = getCreator();
    const like = getRatingButton("like");
    const dislike = getRatingButton("dislike");
    if (!creator || !rememberedCreators.has(creator.key) || !like || !dislike ||
        like.disabled || like.getAttribute("aria-disabled") === "true" ||
        like.getAttribute("aria-pressed") !== "false" ||
        dislike.getAttribute("aria-pressed") !== "false") return;
    autoLikeAttempts.add(videoKey);
    like.click();
  }, 1000);

  function updateRatingControls() {
    let group = document.getElementById(RATING_ID);
    // Keep the pill outside the time/chapter wrappers, which YouTube can clip.
    const timeDisplay = activePlayer?.querySelector(".ytp-time-display");
    const chapter = activePlayer?.querySelector(".ytp-chapter-container");
    const anchor = chapter || timeDisplay;
    const controls = isActive() && (
      anchor?.closest(".ytp-left-controls, .ytp-right-controls-left") ||
      anchor?.parentElement ||
      activePlayer?.querySelector(".ytp-left-controls, .ytp-right-controls-left, .ytp-chrome-controls")
    );
    let placementAnchor = anchor;
    while (placementAnchor && placementAnchor.parentElement !== controls) {
      placementAnchor = placementAnchor.parentElement;
    }
    if (!controls || isShortsPage()) {
      group?.remove();
      ratingObserver.disconnect();
      ratingSource = null;
      return;
    }
    const source = getRatingSource();
    if (source !== ratingSource) {
      ratingObserver.disconnect();
      ratingSource = source;
      if (source) ratingObserver.observe(source, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ["aria-pressed", "aria-label", "disabled", "aria-disabled"]
      });
    }
    if (!group || group.parentElement !== controls) {
      group?.remove();
      group = document.createElement("div");
      group.id = RATING_ID;
      for (const kind of ["like", "dislike"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ytp-button yt-window-rating-button";
        button.dataset.rating = kind;
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("viewBox", "0 0 24 24");
        icon.setAttribute("aria-hidden", "true");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M7 10H3v11h4V10Zm3 11h7a2 2 0 0 0 1.9-1.4l2-7A2 2 0 0 0 19 10h-6l1-5c.2-1-.5-2-1.5-2L7 10v11h3Z");
        if (kind === "dislike") path.setAttribute("transform", "rotate(180 12 12)");
        icon.appendChild(path);
        button.appendChild(icon);
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          // Resolve at click time because YouTube replaces nodes during navigation.
          const nativeButton = getRatingButton(kind);
          if (isActive() && nativeButton && !nativeButton.disabled &&
              nativeButton.getAttribute("aria-disabled") !== "true") {
            nativeButton.click();
            updateRatingControls();
          }
        });
        group.appendChild(button);
      }
    }
    // Chapters can appear or be replaced after the rating buttons are created.
    // Guard the move so our subtree observer does not keep triggering itself.
    if (placementAnchor && placementAnchor.nextElementSibling !== group) {
      controls.insertBefore(group, placementAnchor.nextSibling);
    } else if (!placementAnchor && group.parentElement !== controls) {
      controls.appendChild(group);
    }
    for (const button of group.querySelectorAll("button")) {
      const kind = button.dataset.rating;
      const nativeButton = getRatingButton(kind);
      button.disabled = !nativeButton || nativeButton.disabled ||
        nativeButton.getAttribute("aria-disabled") === "true";
      button.setAttribute("aria-pressed", String(
        nativeButton?.getAttribute("aria-pressed") === "true"
      ));
      const label = nativeButton?.getAttribute("aria-label") ||
        (kind === "like" ? "Like" : "Dislike");
      button.title = label;
      button.setAttribute("aria-label", label);
    }
  }

  // Capture also covers native/replaced controls and buttons that stop bubbling.
  document.addEventListener("click", (event) => {
    if (!isActive() || event.detail === 0 || !(event.target instanceof Element)) return;
    const button = event.target.closest("button, [role='button']");
    if (!button || !activePlayer?.contains(button) ||
        !button.closest(".ytp-chrome-bottom, .ytp-chrome-top")) return;

    // Let the click action finish first. Preserve focus moved into a menu/dialog,
    // and retain keyboard activation focus (click detail 0) for navigation.
    setTimeout(() => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && button.contains(focused)) focused.blur();
    });
  }, true);

  function isShortsPage() {
    return /^\/shorts(?:\/|$)/.test(location.pathname);
  }

  function isShortsVideo(video) {
    return isShortsPage() && video instanceof HTMLVideoElement &&
      !!video.closest("ytd-shorts") &&
      !isShowingAd(video.closest(".html5-video-player"));
  }

  function disableShortsLooping() {
    if (!isShortsPage()) return;
    for (const video of document.querySelectorAll("ytd-shorts video[loop]")) {
      if (isShortsVideo(video)) video.loop = false;
    }
  }

  // Native looping prevents the ended event. Watch for YouTube restoring it.
  const shortsLoopObserver = new MutationObserver(disableShortsLooping);
  shortsLoopObserver.observe(document.documentElement, {
    subtree: true, attributes: true, attributeFilter: ["loop"]
  });

  document.addEventListener("ended", (event) => {
    if (!isShortsVideo(event.target)) return;
    // Stop the site's ended handlers from starting another playback.
    event.stopImmediatePropagation();
    event.target.pause();
  }, true);

  document.addEventListener("play", disableShortsLooping, true);
  document.addEventListener("loadedmetadata", disableShortsLooping, true);

  let shortsResizeFrame = 0;
  let observedShorts = null;
  const shortsResizeObserver = new ResizeObserver(scheduleShortsResize);

  function clearShortsFit() {
    if (!observedShorts) return;
    observedShorts.style.removeProperty("--yt-window-shorts-scale");
    observedShorts.style.removeProperty("--yt-window-shorts-offset");
    observedShorts.style.removeProperty("--yt-window-shorts-stage-height");
    observedShorts.classList.remove("yt-window-shorts-stage");
    observedShorts.classList.remove("yt-window-shorts-fit");
  }

  function fitShortsBounds() {
    clearShortsFit();
    if (!isShortsPage() || !observedShorts || document.fullscreenElement) return;
    const feed = observedShorts;
    const viewport = window.visualViewport;
    const top = (viewport?.offsetTop || 0) + 12;
    const bottom = (viewport?.offsetTop || 0) +
      (viewport?.height || window.innerHeight) - 12;
    // Choose the visible reel before scaling. Offscreen feed items stay in place
    // relative to the active item, preserving YouTube's scrolling behaviour.
    const reels = [...feed.querySelectorAll("ytd-reel-video-renderer")];
    const reel = reels.reduce((best, item) => {
      const rect = item.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(bottom, rect.bottom) - Math.max(top, rect.top));
      return overlap > best.overlap ? { item, overlap } : best;
    }, { item: null, overlap: 0 }).item;
    if (!reel) return;

    const player = reel.querySelector("#player-container");
    if (!player) return;
    let bounds = player.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    // Scaling also shrinks the feed's scrollport. Give that scrollport enough
    // unscaled height to hold the entire player before applying the transform.
    const stageHeight = Math.ceil(Math.max(
      viewport?.height || window.innerHeight, bounds.height + 24
    ));
    feed.style.setProperty("--yt-window-shorts-stage-height", stageHeight + "px");
    feed.classList.add("yt-window-shorts-stage");
    // The larger scrollport can change native vertical alignment.
    bounds = player.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      clearShortsFit();
      return;
    }
    // Inner video elements can retain their source-sized bounds or offscreen
    // offsets. The visible player box is the sizing reference, not their union.
    const origin = feed.getBoundingClientRect().top;
    const availableHeight = Math.max(1, bottom - top);
    const scale = Math.min(1, availableHeight / bounds.height);
    const scaledHeight = bounds.height * scale;
    const scaledTop = origin + (bounds.top - origin) * scale;
    const targetTop = top + (availableHeight - scaledHeight) / 2;
    const offset = targetTop - scaledTop;
    // Transform their common ancestor once: player, preview, overlays and actions
    // all keep exactly the same relative positions and hit targets.
    feed.style.setProperty("--yt-window-shorts-scale", String(scale));
    feed.style.setProperty("--yt-window-shorts-offset", offset + "px");
    feed.classList.add("yt-window-shorts-fit");
  }

  function scheduleShortsResize() {
    if (shortsResizeFrame || !isShortsPage()) return;
    shortsResizeFrame = requestAnimationFrame(() => {
      shortsResizeFrame = 0;
      fitShortsBounds();
    });
  }

  function updateShortsLayout() {
    const shorts = isShortsPage();
    disableShortsLooping();
    if (shorts && isActive()) exit();
    const feed = shorts ? document.querySelector("ytd-shorts") : null;
    if (feed !== observedShorts) {
      clearShortsFit();
      shortsResizeObserver.disconnect();
      observedShorts = feed;
      if (feed) shortsResizeObserver.observe(feed);
    }
    if (shorts) scheduleShortsResize();
    else clearShortsFit();
    if (document.documentElement.classList.contains(SHORTS_CLASS) === shorts) return;
    document.documentElement.classList.toggle(SHORTS_CLASS, shorts);
    window.dispatchEvent(new Event("resize"));
  }
  let activePlayer = null;
  const manuallyExitedVideos = new Set();
  let chatHandledVideo = null;
  let endCheckTimer = null;
  const endObserver = new MutationObserver(checkPlaybackEnded);

  function isShowingAd(player) {
    return !!player && (player.classList.contains("ad-showing") ||
      player.classList.contains("ad-interrupting"));
  }

  function checkPlaybackEnded() {
    if (!preferencesReady || !playerPreferences.autoExit) return;
    if (!isActive() || !activePlayer || isShowingAd(activePlayer)) return;
    const video = activePlayer.querySelector("video");
    if (activePlayer.classList.contains("ended-mode") || video?.ended) exit();
  }



  function isActive() {
    return document.documentElement.classList.contains(ROOT_CLASS);
  }

  function getPlayer() {
    return document.querySelector("#movie_player");
  }

  function getVideoKey() {
    if (location.pathname === "/watch") {
      const videoId = new URLSearchParams(location.search).get("v");
      return videoId ? `watch:${videoId}` : null;
    }

    if (/^\/shorts\/[^/]+/.test(location.pathname)) {
      return "watch:" + location.pathname.split("/")[2];
    }

    if (/^\/(live|clip)\//.test(location.pathname)) {
      return location.pathname;
    }

    return null;
  }

  function updateButton() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;

    const active = isActive();
    button.dataset.active = String(active);
    const iconPath = button.querySelector("path");
    if (iconPath) {
      iconPath.setAttribute(
        "d",
        active
          ? "M8 4h2v6H4V8h4V4zm6 0h2v4h4v2h-6V4zM4 14h6v6H8v-4H4v-2zm10 0h6v2h-4v4h-2v-6z"
          : "M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z"
      );
    }
    button.title = active
      ? "Exit faux fullscreen (F)"
      : "Faux fullscreen (F)";
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(active));
  }

  function exit(manual = false) {
    if (manual) {
      const videoKey = getVideoKey();
      if (videoKey) manuallyExitedVideos.add(videoKey);
    }
    endObserver.disconnect();
    clearInterval(endCheckTimer);
    endCheckTimer = null;
    document.documentElement.classList.remove(ROOT_CLASS);
    activePlayer?.classList.remove(PLAYER_CLASS);
    activePlayer = null;
    updateRatingControls();
    updateButton();
    window.dispatchEvent(new Event("resize"));
  }

  function enter() {
    const player = getPlayer();
    if (!player) return;

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    endObserver.disconnect();
    clearInterval(endCheckTimer);
    activePlayer = player;
    endObserver.observe(player, { attributes: true, attributeFilter: ["class"] });
    endCheckTimer = setInterval(checkPlaybackEnded, 250);
    activePlayer.classList.add(PLAYER_CLASS);
    document.documentElement.classList.add(ROOT_CLASS);
    updateRatingControls();
    window.scrollTo(0, 0);
    updateButton();
    window.dispatchEvent(new Event("resize"));
  }

  function toggle() {
    if (isShortsPage()) return;
    if (isActive()) {
      exit(true);
    } else {
      manuallyExitedVideos.delete(getVideoKey());
      enter();
    }
  }

  function autoActivate() {
    if (!preferencesReady || !playerPreferences.autoEnter) return;
    const videoKey = getVideoKey();
    const player = getPlayer();
    const video = player?.querySelector("video");
    if (
      !videoKey ||
      manuallyExitedVideos.has(videoKey) ||
      !video ||
      video.paused ||
      video.ended ||
      video.readyState < 3 ||
      player.classList.contains("ended-mode") ||
      isShowingAd(player) ||
      document.fullscreenElement
    ) return;

    if (isActive() && activePlayer === player) return;
    if (activePlayer) exit();
    enter();
  }
  function closeChatIfPresent() {
    const videoKey = getVideoKey();
    if (!videoKey || videoKey === chatHandledVideo) return;

    const chat = document.querySelector(
      "ytd-live-chat-frame:not([collapsed]), #chat:not([collapsed])"
    );
    if (!chat) return;

    const closeButton = chat.querySelector(
      '#close-button button, button[aria-label="Close"], #show-hide-button button'
    );
    if (!closeButton) return;

    chatHandledVideo = videoKey;
    closeButton.click();
  }

  function addButton() {
    if (isShortsPage()) return;
    if (document.getElementById(BUTTON_ID)) return;

    const controls = document.querySelector(
      ".ytp-right-controls-right, .ytp-right-controls"
    );
    if (!controls || !getPlayer()) return;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.className = "ytp-button";
    button.type = "button";
    button.textContent = "";

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const iconPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    iconPath.setAttribute("fill", "currentColor");
    icon.appendChild(iconPath);
    button.appendChild(icon);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggle();
    });

    const theaterButton = document.querySelector(".ytp-size-button");
    const buttonContainer = theaterButton?.parentElement || controls;
    buttonContainer.insertBefore(
      button,
      theaterButton || buttonContainer.firstElementChild
    );
    updateButton();
  }

  const observer = new MutationObserver(() => {
    updateShortsLayout();
    addButton();
    autoActivate();
    closeChatIfPresent();
    if (isActive() && !document.contains(activePlayer)) exit();
    updateRatingControls();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  updateShortsLayout();
  addButton();
  autoActivate();
  closeChatIfPresent();

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isTyping =
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

    if (event.key === "Escape" && isActive()) {
      exit(true);
    } else if (
      event.key.toLowerCase() === "f" &&
      !isShortsPage() &&
      !isTyping &&
      !event.repeat &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggle();
    }
  }, true);

  // Recheck playback when YouTube reuses the player for a new video.
  for (const eventName of ["playing", "timeupdate"]) {
    document.addEventListener(eventName, (event) => {
      if (event.target instanceof HTMLVideoElement &&
          getPlayer()?.contains(event.target)) autoActivate();
    }, true);
  }

  document.addEventListener("scrollend", scheduleShortsResize, true);
  document.addEventListener("loadedmetadata", scheduleShortsResize, true);
  document.addEventListener("loadeddata", scheduleShortsResize, true);
  document.addEventListener("playing", scheduleShortsResize, true);
  document.addEventListener("emptied", scheduleShortsResize, true);
  document.addEventListener("fullscreenchange", scheduleShortsResize);
  window.addEventListener("resize", scheduleShortsResize);
  window.visualViewport?.addEventListener("resize", scheduleShortsResize);
  window.addEventListener("popstate", updateShortsLayout);
  document.addEventListener("yt-navigate-finish", () => {
    updateShortsLayout();
    if (!getVideoKey() && isActive()) exit();
    autoActivate();
  });
  // Media events do not bubble; capture also handles replacement video elements.
  document.addEventListener("ended", (event) => {
    const video = event.target;
    if (!preferencesReady || !playerPreferences.autoExit) return;
    if (
      !isActive() ||
      !(video instanceof HTMLVideoElement) ||
      !activePlayer?.contains(video) ||
      isShowingAd(activePlayer)
    ) return;

    exit();
  }, true);

  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement && isActive()) exit(true);
  });

  YTWindowExtension.runtime.onMessage.addListener((message) => {
    if (message?.type === "toggle-window-fullscreen") toggle();
  });

})();

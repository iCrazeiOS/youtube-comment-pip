(() => {
  const SHELL_CLASS = "yt-comment-pip-shell";
  const PLAYER_CLASS = "yt-comment-pip-player";
  const HANDLE_CLASS = "yt-comment-pip-handle";
  const CLOSE_CLASS = "yt-comment-pip-close";
  const RESIZE_CLASS = "yt-comment-pip-resize";
  const STAGE_CLASS = "yt-comment-pip-stage";
  const PLACEHOLDER_CLASS = "yt-comment-pip-placeholder";
  const SETTINGS_KEY = "ytCommentPipSettings";

  let player = null;
  let shell = null;
  let stage = null;
  let handle = null;
  let closeButton = null;
  let resizeHandle = null;
  let placeholder = null;
  let active = false;
  let dismissed = false;
  let checkQueued = false;
  let lastUrl = location.href;
  let settings = loadSettings();
  let dragState = null;
  let resizeState = null;
  let geometryFrame = 0;
  let aspectRatio = 16 / 9;

  function onWatchPage() {
    return location.hostname === "www.youtube.com" && location.pathname === "/watch";
  }

  function getPlayer() {
    return (
      document.querySelector("ytd-watch-flexy #player-container ytd-player") ||
      document.querySelector("ytd-watch-flexy ytd-player") ||
      document.querySelector("ytd-player") ||
      document.querySelector("#movie_player")
    );
  }

  function getComments() {
    return (
      document.querySelector("ytd-watch-flexy #comments") ||
      document.querySelector("ytd-comments#comments") ||
      document.querySelector("#comments")
    );
  }

  function visibleRatio(rect) {
    if (!rect.width || !rect.height) return 0;

    const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));

    return (visibleWidth * visibleHeight) / (rect.width * rect.height);
  }

  function commentsReached(element) {
    const rect = element.getBoundingClientRect();
    return rect.top <= window.innerHeight * 0.8 && rect.bottom > 0;
  }

  function sourcePlayerRect() {
    return (placeholder || player)?.getBoundingClientRect();
  }

  function getVideoElement() {
    return player?.querySelector?.("video.html5-main-video, video") || document.querySelector("video.html5-main-video, video");
  }

  function readAspectRatio() {
    const video = getVideoElement();
    const nextRatio = video?.videoWidth && video?.videoHeight ? video.videoWidth / video.videoHeight : 0;

    if (Number.isFinite(nextRatio) && nextRatio > 0) {
      aspectRatio = nextRatio;
    }

    return aspectRatio;
  }

  function floatingSize() {
    const gutter = window.innerWidth <= 700 ? 12 : 20;
    const preferredWidth = window.innerWidth <= 700 ? 320 : 430;
    const minWidth = Math.min(240, window.innerWidth - gutter * 2);
    const maxWidth = Math.max(minWidth, window.innerWidth - gutter * 2);
    const rawWidth = Number.isFinite(settings.width) ? settings.width : preferredWidth;
    const handleHeight = 24;
    const ratio = readAspectRatio();
    const maxVideoHeight = Math.max(120, window.innerHeight - gutter * 2 - handleHeight);
    const widthLimitedByViewportHeight = Math.floor(maxVideoHeight * ratio);
    const minVisibleWidth = Math.min(minWidth, Math.max(120, widthLimitedByViewportHeight));
    const maxVisibleWidth = Math.max(minVisibleWidth, Math.min(maxWidth, widthLimitedByViewportHeight));
    const width = Math.min(Math.max(rawWidth, minVisibleWidth), maxVisibleWidth);
    const videoHeight = Math.round(width / ratio);

    return {
      gutter,
      handleHeight,
      minWidth: minVisibleWidth,
      maxWidth: maxVisibleWidth,
      width,
      videoHeight,
      shellHeight: videoHeight + handleHeight
    };
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
      if (saved && typeof saved === "object") {
        return {
          left: Number.isFinite(saved.left) ? saved.left : null,
          top: Number.isFinite(saved.top) ? saved.top : null,
          width: Number.isFinite(saved.width) ? saved.width : null
        };
      }
    } catch {
      localStorage.removeItem(SETTINGS_KEY);
    }

    return { left: null, top: null, width: null };
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function defaultPosition() {
    const { gutter, width } = floatingSize();
    return {
      left: Math.max(gutter, window.innerWidth - width - gutter),
      top: Math.max(gutter, 84)
    };
  }

  function currentPosition() {
    if (Number.isFinite(settings.left) && Number.isFinite(settings.top)) {
      return { left: settings.left, top: settings.top };
    }

    return defaultPosition();
  }

  function clampPosition(nextPosition = currentPosition()) {
    const { gutter, width, shellHeight } = floatingSize();
    const maxLeft = Math.max(gutter, window.innerWidth - width - gutter);
    const maxTop = Math.max(gutter, window.innerHeight - shellHeight - gutter);

    return {
      left: Math.min(Math.max(nextPosition.left, gutter), maxLeft),
      top: Math.min(Math.max(nextPosition.top, gutter), maxTop)
    };
  }

  function clampWidth(width) {
    const { minWidth, maxWidth } = floatingSize();
    return Math.min(Math.max(width, minWidth), maxWidth);
  }

  function applyFloatingGeometry() {
    if (!shell) return;

    const { width, videoHeight, handleHeight } = floatingSize();
    const position = clampPosition();
    settings.left = position.left;
    settings.top = position.top;

    shell.style.setProperty("--yt-comment-pip-left", `${position.left}px`);
    shell.style.setProperty("--yt-comment-pip-top", `${position.top}px`);
    shell.style.setProperty("--yt-comment-pip-width", `${width}px`);
    shell.style.setProperty("--yt-comment-pip-video-height", `${videoHeight}px`);
    shell.style.setProperty("--yt-comment-pip-handle-height", `${handleHeight}px`);
  }

  function queueGeometry() {
    if (geometryFrame) return;
    geometryFrame = requestAnimationFrame(() => {
      geometryFrame = 0;
      applyFloatingGeometry();
    });
  }

  function notifyPlayerResize() {
    window.dispatchEvent(new Event("resize"));

    const moviePlayer = document.querySelector("#movie_player");
    if (moviePlayer && typeof moviePlayer.dispatchEvent === "function") {
      moviePlayer.dispatchEvent(new Event("resize", { bubbles: true }));
    }
  }

  function refreshVideoGeometry() {
    readAspectRatio();
    applyFloatingGeometry();
    notifyPlayerResize();
  }

  function watchVideoMetadata() {
    const video = getVideoElement();
    if (!video || video.dataset.ytCommentPipWatched === "true") return;

    video.dataset.ytCommentPipWatched = "true";
    video.addEventListener("loadedmetadata", refreshVideoGeometry);
    video.addEventListener("resize", refreshVideoGeometry);
  }

  function syncPlaceholderSize() {
    if (!placeholder || !player) return;

    const rect = player.getBoundingClientRect();
    placeholder.style.width = `${rect.width}px`;
    placeholder.style.height = `${rect.height}px`;
  }

  function createPlaceholder() {
    if (!player || placeholder) return;

    placeholder = document.createElement("div");
    placeholder.className = PLACEHOLDER_CLASS;
    syncPlaceholderSize();
    player.before(placeholder);
  }

  function removePlaceholder() {
    placeholder?.remove();
    placeholder = null;
  }

  function createShell() {
    if (shell) return;

    shell = document.createElement("div");
    shell.className = SHELL_CLASS;

    handle = document.createElement("button");
    handle.className = HANDLE_CLASS;
    handle.type = "button";
    handle.title = "Drag mini player";
    handle.setAttribute("aria-label", "Drag mini player");
    handle.addEventListener("pointerdown", startDrag);

    closeButton = document.createElement("button");
    closeButton.className = CLOSE_CLASS;
    closeButton.type = "button";
    closeButton.title = "Dismiss mini player";
    closeButton.setAttribute("aria-label", "Dismiss mini player");
    closeButton.addEventListener("click", dismissFloatingPlayer);

    resizeHandle = document.createElement("button");
    resizeHandle.className = RESIZE_CLASS;
    resizeHandle.type = "button";
    resizeHandle.title = "Resize mini player";
    resizeHandle.setAttribute("aria-label", "Resize mini player");
    resizeHandle.addEventListener("pointerdown", startResize);

    stage = document.createElement("div");
    stage.className = STAGE_CLASS;

    shell.append(handle, closeButton, resizeHandle, stage);
    document.body.append(shell);
  }

  function removeShell() {
    handle?.removeEventListener("pointerdown", startDrag);
    closeButton?.removeEventListener("click", dismissFloatingPlayer);
    resizeHandle?.removeEventListener("pointerdown", startResize);
    shell?.remove();
    shell = null;
    stage = null;
    handle = null;
    closeButton = null;
    resizeHandle = null;
    dragState = null;
    resizeState = null;
  }

  function dismissFloatingPlayer(event) {
    event?.preventDefault();
    event?.stopPropagation();
    dismissed = true;
    deactivate();
  }

  function startDrag(event) {
    if (!active || event.button !== 0) return;

    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const position = clampPosition();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: position.left,
      startTop: position.top
    };

    handle.addEventListener("pointermove", drag);
    handle.addEventListener("pointerup", stopDrag);
    handle.addEventListener("pointercancel", stopDrag);
  }

  function drag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    const position = clampPosition({
      left: dragState.startLeft + event.clientX - dragState.startX,
      top: dragState.startTop + event.clientY - dragState.startY
    });
    settings.left = position.left;
    settings.top = position.top;
    queueGeometry();
  }

  function stopDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    handle.removeEventListener("pointermove", drag);
    handle.removeEventListener("pointerup", stopDrag);
    handle.removeEventListener("pointercancel", stopDrag);
    handle.releasePointerCapture(event.pointerId);
    dragState = null;
    applyFloatingGeometry();
    saveSettings();
  }

  function startResize(event) {
    if (!active || event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeState = {
      target: event.currentTarget,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: floatingSize().width
    };

    event.currentTarget.addEventListener("pointermove", resize);
    event.currentTarget.addEventListener("pointerup", stopResize);
    event.currentTarget.addEventListener("pointercancel", stopResize);
  }

  function resize(event) {
    if (!resizeState || event.pointerId !== resizeState.pointerId) return;

    settings.width = clampWidth(resizeState.startWidth + event.clientX - resizeState.startX);
    const position = clampPosition();
    settings.left = position.left;
    settings.top = position.top;
    queueGeometry();
  }

  function stopResize(event) {
    if (!resizeState || event.pointerId !== resizeState.pointerId) return;

    resizeState.target.removeEventListener("pointermove", resize);
    resizeState.target.removeEventListener("pointerup", stopResize);
    resizeState.target.removeEventListener("pointercancel", stopResize);
    resizeState.target.releasePointerCapture(event.pointerId);
    resizeState = null;
    applyFloatingGeometry();
    saveSettings();
    notifyPlayerResize();
  }

  function activate() {
    if (active || !player) return;

    createPlaceholder();
    createShell();
    watchVideoMetadata();
    applyFloatingGeometry();

    player.classList.add(PLAYER_CLASS);
    stage.append(player);
    active = true;
    watchVideoMetadata();
    requestAnimationFrame(notifyPlayerResize);
  }

  function deactivate() {
    if (!active) return;

    if (placeholder?.isConnected && player?.isConnected) {
      placeholder.before(player);
    }

    player?.classList.remove(PLAYER_CLASS);
    removeShell();
    removePlaceholder();
    active = false;
    requestAnimationFrame(notifyPlayerResize);
  }

  function reset() {
    deactivate();
    player = null;
    dismissed = false;
    aspectRatio = 16 / 9;
    removePlaceholder();
  }

  function shouldFloat() {
    if (!onWatchPage()) return false;

    player = player?.isConnected ? player : getPlayer();
    const comments = getComments();
    if (!player || !comments) return false;
    watchVideoMetadata();

    const playerRect = sourcePlayerRect();
    if (!playerRect) return false;

    const playerVisible = visibleRatio(playerRect) >= 0.35;
    const commentsVisible = commentsReached(comments);

    return commentsVisible && !playerVisible;
  }

  function check() {
    checkQueued = false;

    if (location.href !== lastUrl) {
      lastUrl = location.href;
      reset();
    }

    if (!onWatchPage()) {
      reset();
      return;
    }

    const shouldBeFloating = shouldFloat();

    if (!shouldBeFloating) {
      dismissed = false;
    }

    if (active) applyFloatingGeometry();

    if (shouldBeFloating && !dismissed) {
      activate();
    } else {
      deactivate();
    }
  }

  function queueCheck() {
    if (checkQueued) return;
    checkQueued = true;
    requestAnimationFrame(check);
  }

  const observer = new MutationObserver(queueCheck);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("scroll", queueCheck, { passive: true });
  window.addEventListener("resize", queueCheck);
  window.addEventListener("yt-navigate-finish", queueCheck);
  window.addEventListener("popstate", queueCheck);

  queueCheck();
})();

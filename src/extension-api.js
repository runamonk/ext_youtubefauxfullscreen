"use strict";

// Use Firefox's Promise APIs, with support for Chromium's chrome namespace.
globalThis.YTWindowExtension = globalThis.browser ?? globalThis.chrome;

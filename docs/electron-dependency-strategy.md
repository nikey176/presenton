# Electron Dependency Strategy

This is the working strategy for reducing first-run dependency installers in
the Electron app while keeping Presenton Apache-2.0.

## Recommendation

- Bundle Chrome for Testing with the Electron package (including Microsoft APPX)
  for export rendering.
- Bundle ImageMagick under `resources/imagemagick/` when present; the app prefers
  that path before PATH or first-run download.
- Use **LibreOffice only** for PPTX/office conversion and custom template rendering
  on all platforms (Windows, macOS, Linux). Do not detect or automate Microsoft
  PowerPoint.
- Install LibreOffice via the in-app first-run installer (or an existing system
  install). Do not bundle LibreOffice inside the desktop package.

## Licensing Notes

This is engineering guidance, not legal advice.

ImageMagick is practical to bundle. The official license permits personal,
internal, and commercial use, and its terms are close to Apache-2.0. Keep the
ImageMagick license and notices in the distributed app.
Source: https://imagemagick.org/license/

Chromium/Chrome for Testing can be bundled, but the notices matter. Puppeteer
now targets Chrome for Testing for supported automation, and Chromium source is
BSD-style plus third-party licenses. Keep generated browser credits/notices with
the shipped runtime.
Sources:
- https://pptr.dev/supported-browsers
- https://chromium.googlesource.com/chromium/src/+/main/LICENSE
- https://www.chromium.org/chromium-os/licensing/

LibreOffice is not bundled inside the Apache-2.0 desktop installer. Users install
it separately (in-app installer or package manager) so LGPL/MPL compliance,
notices, and updates stay outside the main app package.
Source: https://www.libreoffice.org/licenses/

## Runtime Layout

Bundled Chromium:

```text
electron/resources/chromium/
  chrome/<platform-build-id>/...
```

Populate it with:

```bash
cd electron
npm run prepare:export-chromium
```

Set `SKIP_BUNDLED_CHROMIUM=1` to keep the old first-run download behavior.

Bundled ImageMagick:

```text
electron/resources/imagemagick/<platform>-<arch>/bin/magick(.exe)
```

Examples:

```text
electron/resources/imagemagick/win32-x64/bin/magick.exe
electron/resources/imagemagick/darwin-arm64/bin/magick
electron/resources/imagemagick/linux-x64/bin/magick
```

The app checks this location before PATH, Homebrew, package-manager installs, or
the Windows per-user runtime install directory.

## Current Behavior

- `checkDependenciesBeforeWindow()` requires LibreOffice, ImageMagick, and export
  Chromium (bundled or installed).
- FastAPI receives `SOFFICE_PATH` and `PRESENTON_OFFICE_RENDERER=libreoffice` when
  LibreOffice is detected at startup.
- PPTX-to-PDF and office document conversion use LibreOffice (`soffice`) only.
- Export Chromium resolution checks the bundled app runtime before the user
  Puppeteer cache.

## APPX / Store builds

Before `npm run build:electron`:

1. Run `npm run prepare:export-chromium` so Chromium is under `resources/chromium/`.
2. Place a portable ImageMagick build under `resources/imagemagick/win32-x64/`.
3. LibreOffice is **not** included in the package; the unified setup installer
   downloads or guides installation on first launch.

Microsoft Store (MSIX/APPX) packages install under `Program Files\WindowsApps`.
Bundled Chrome cannot be launched in place from that folder; on first export the app
copies the browser tree to `%LOCALAPPDATA%\…\Cache\msix-export-chromium\` (same pattern
as the MSIX export runtime for Sharp). The portable EXE install does not need this copy.

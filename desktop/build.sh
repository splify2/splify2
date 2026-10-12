#!/bin/sh
# Сборка splify2 для компьютера.
#
#     sh build.sh          установщик Windows x64 (NSIS) — release/splify2-desktop-<версия>-setup-x64.exe
#     sh build.sh linux    AppImage x86_64
#
# Окно собирается из исходников панели (ui/src) их же сборщиком — поэтому сначала зависимости ui.
# Установщик Windows собирается в docker: шагу NSIS у electron-builder нужен wine, и образ
# electronuserland/builder:22-wine несёт его вместе с нужным node. Всё, что docker написал в
# дерево, отдаётся владельцу каталога внутри контейнера (сборка обязана проходить и не от root).
set -eu
cd "$(dirname "$0")"

TARGET=${1:-win}
IMAGE=${DESKTOP_BUILDER_IMAGE:-electronuserland/builder:22-wine}

[ -d ../ui/node_modules ] || (cd ../ui && npm ci)
[ -d node_modules ] || npm ci
npm run renderer

case "$TARGET" in
    win)
        owner="$(stat -c %u:%g .)"
        mkdir -p "${HOME}/.cache/electron" "${HOME}/.cache/electron-builder"
        docker run --rm \
            -v "$PWD/..":/project -w /project/desktop \
            -v "${HOME}/.cache/electron":/root/.cache/electron \
            -v "${HOME}/.cache/electron-builder":/root/.cache/electron-builder \
            "$IMAGE" sh -c "npx electron-builder --win nsis --x64; rc=\$?; chown -R $owner release dist 2>/dev/null; exit \$rc"
        ;;
    linux)
        npx electron-builder --linux AppImage --x64
        ;;
    *)
        echo "build.sh: цель win или linux, а не $TARGET" >&2
        exit 1
        ;;
esac
ls -la release/*.exe release/*.AppImage 2>/dev/null || true

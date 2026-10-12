#!/bin/sh
# Сборка splify2 для компьютера.
#
#     sh build.sh          установщик Windows x64 (Squirrel, как у Discord) в release/squirrel-windows/:
#                          splify2-desktop-<версия>-setup-x64.exe, splify2-<версия>-full.nupkg и RELEASES
#                          (последние два нужны будущему самообновлению)
#     sh build.sh nsis     запасной установщик NSIS — release/splify2-desktop-<версия>-setup-x64.exe
#     sh build.sh linux    AppImage x86_64
#
# Окно собирается из исходников панели (ui/src) их же сборщиком — поэтому сначала зависимости ui.
# Установщик Windows собирается в docker: Squirrel.Windows на Linux идёт через wine и mono, образ
# electronuserland/builder:wine-mono несёт их вместе с нужным node (NSIS тоже обходится им). Всё,
# что docker написал в дерево, отдаётся владельцу каталога внутри контейнера (сборка обязана
# проходить и не от root). Анимация установщика — resources/install.gif (`npm run install-gif`).
set -eu
cd "$(dirname "$0")"

TARGET=${1:-win}
IMAGE=${DESKTOP_BUILDER_IMAGE:-electronuserland/builder:wine-mono}

[ -d ../ui/node_modules ] || (cd ../ui && npm ci)
[ -d node_modules ] || npm ci
npm run renderer

docker_build() { # $1 — цель electron-builder
    owner="$(stat -c %u:%g .)"
    mkdir -p "${HOME}/.cache/electron" "${HOME}/.cache/electron-builder"
    docker run --rm \
        -v "$PWD/..":/project -w /project/desktop \
        -v "${HOME}/.cache/electron":/root/.cache/electron \
        -v "${HOME}/.cache/electron-builder":/root/.cache/electron-builder \
        "$IMAGE" sh -c "npx electron-builder --win $1 --x64; rc=\$?; chown -R $owner release dist 2>/dev/null; exit \$rc"
}

case "$TARGET" in
    win)
        # Squirrel называет Setup.exe «<продукт> Setup <версия>.exe» без возможности это поменять —
        # переименовываем в имя, как у остальных установщиков.
        docker_build squirrel
        v="$(node -p 'require("./package.json").version')"
        mv "release/squirrel-windows/splify2 Setup $v.exe" "release/squirrel-windows/splify2-desktop-$v-setup-x64.exe"
        ;;
    nsis)
        docker_build nsis
        ;;
    linux)
        npx electron-builder --linux AppImage --x64
        ;;
    *)
        echo "build.sh: цель win, nsis или linux, а не $TARGET" >&2
        exit 1
        ;;
esac
ls -la release/*.exe release/squirrel-windows/* release/*.AppImage 2>/dev/null || true

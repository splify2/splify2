#!/usr/bin/env python3
"""Окно установки Squirrel — сразу, а не через 4 секунды.

Update.exe (в electron-winstaller — vendor/Squirrel.exe) при установке зовёт
`AnimatedGifWindow.ShowWindow(TimeSpan.FromSeconds(4), ...)` (Squirrel/Update/Program.cs,
действие Install): окно с анимацией показывается, только если установка идёт дольше четырёх
секунд. Наша укладывается в это время, и человек видел окно в самом конце или не видел вовсе,
а до того — ничего (владелец: «окошко установки появляется уже только после установки»).

Правка — одна константа IL: `ldc.r8 4.0` перед вызовом FromSeconds → `ldc.r8 0.0`. Файл
меняется на месте в node_modules (оттуда его берёт electron-builder), и только если он ровно
тот, что разобран (sha256 исходника) и байты на месте те же: другая версия electron-winstaller
остановит сборку, а не получит заплату вслепую. Повторный запуск ничего не делает.

Найдено и проверено разбором IL (ikdasm из electronuserland/builder:wine-mono):
    IL_00de:  ldc.r8 4
    IL_00e7:  call TimeSpan::FromSeconds(float64)
    ...       call AnimatedGifWindow::ShowWindow(TimeSpan, CancellationToken, ProgressSource)
"""
import hashlib
import struct
import sys

ORIG_SHA = '76359cd4b0349a83337b941332ad042c90351c2bb0a4628307740324c97984cc'
OFFSET = 0x3106
CALL = bytes.fromhex('28df00000a')  # call FromSeconds(float64)
BEFORE = b'\x23' + struct.pack('<d', 4.0) + CALL
AFTER = b'\x23' + struct.pack('<d', 0.0) + CALL


def main(path: str) -> int:
    data = bytearray(open(path, 'rb').read())
    here = bytes(data[OFFSET:OFFSET + len(BEFORE)])
    if here == AFTER:
        print('squirrel-splash: уже без задержки')
        return 0
    if hashlib.sha256(data).hexdigest() != ORIG_SHA or here != BEFORE:
        print('squirrel-splash: Squirrel.exe не тот, что разобран (другая версия electron-winstaller?) — '
              'найдите константу заново (см. шапку) и обновите ORIG_SHA и OFFSET', file=sys.stderr)
        return 1
    data[OFFSET:OFFSET + len(AFTER)] = AFTER
    open(path, 'wb').write(data)
    print('squirrel-splash: окно установки — без задержки')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else 'node_modules/electron-winstaller/vendor/Squirrel.exe'))

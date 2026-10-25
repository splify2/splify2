'use strict'
// Подмена пакета electron для стендов: main-процесс без окна. Подключается первой строкой теста.
const Module = require('node:module')
const load = Module._load
Module._load = function (request, ...rest) {
    if (request === 'electron') return { safeStorage: { isEncryptionAvailable: () => false } }
    return load.call(this, request, ...rest)
}

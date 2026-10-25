// Стенд чистой логики окна (tests/*.test.ts): vitest берётся у панели (../ui/node_modules), как и
// остальные пакеты окна.
export default {
    test: { include: ['tests/**/*.test.ts'] },
}

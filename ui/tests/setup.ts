import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/preact'
import { afterAll, afterEach } from 'vitest'

// jsdom живёт один на весь файл, поэтому размонтирование обязательно: без него второй
// тест находит разметку первого и «проходит» по чужому DOM.
afterEach(cleanup)

// findBy* и waitFor ждут по умолчанию секунду. Одному файлу её хватает с запасом, а весь набор
// разом (tests/run.sh — 96 файлов в параллель, рядом сборка) отрисовывает экран дольше: так
// bench-repro ловил «нет текста Нидерланды» при зелёном прогоне того же файла отдельно. Пять
// секунд — потолок ожидания, а не задержка: найденное возвращается сразу.
configure({ asyncUtilTimeout: 5000 })

// useEffect в Preact откладывается до отрисовки: requestAnimationFrame и запасной setTimeout
// на 35 мс, который зовёт cancelAnimationFrame. Под нагрузкой (весь набор разом) этот таймер
// срабатывал уже после того, как окружение jsdom убрано, — «cancelAnimationFrame is not
// defined» и провал всего набора при зелёных тестах. Перед закрытием файла ждём, пока
// отложенное отработает.
afterAll(() => new Promise<void>((done) => setTimeout(done, 60)))

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/preact'
import { afterAll, afterEach } from 'vitest'

// jsdom живёт один на весь файл, поэтому размонтирование обязательно: без него второй
// тест находит разметку первого и «проходит» по чужому DOM.
afterEach(cleanup)

// useEffect в Preact откладывается до отрисовки: requestAnimationFrame и запасной setTimeout
// на 35 мс, который зовёт cancelAnimationFrame. Под нагрузкой (весь набор разом) этот таймер
// срабатывал уже после того, как окружение jsdom убрано, — «cancelAnimationFrame is not
// defined» и провал всего набора при зелёных тестах. Перед закрытием файла ждём, пока
// отложенное отработает.
afterAll(() => new Promise<void>((done) => setTimeout(done, 60)))

/** Точка входа текстового слоя. Сейчас язык один — русский; второй подключается здесь,
 *  выбором объекта того же типа (`Copy`). */
import { ru } from './ru'

export type Copy = typeof ru
export const S: Copy = ru

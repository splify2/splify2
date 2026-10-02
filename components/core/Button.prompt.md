Кнопка действия: одна primary на экран, остальное — secondary/ghost.

```jsx
<Button tone="primary" icon={<Icon name="plus" />} onClick={create}>Новое правило</Button>
<Button tone="secondary" size="sm">Проверить</Button>
<Button tone="danger">Остановить всё</Button>
<Button busy icon={<Icon name="loader-circle" />}>Применяем…</Button>
```

- `busy` сам крутит иконку и глушит нажатия — не заводите свой флаг.
- Опасное действие всегда `tone="danger"` и всегда через `Dialog`.
- Никогда не пишите на кнопке пересказ результата: «Проверить», а не «Проверить, всё ли хорошо».

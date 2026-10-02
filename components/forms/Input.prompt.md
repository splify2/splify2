Поле ввода; `icon` делает из него поиск.

```jsx
<Input icon={<Icon name="search" />} placeholder="поиск по каталогу" trailing="142" />
<Input mono value={url} invalid={bad} onChange={setUrl} />
```

- `invalid` — жёлтый, не красный: значение ещё можно поправить, ничего не сломалось.
- Адреса, ссылки и MAC — всегда `mono`.

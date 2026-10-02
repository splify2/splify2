Объект в списке: имя, пояснение, действия справа.

```jsx
<ListRow index={2} handle title="YouTube"
  subtitle="YouTube, Google · записей: 84 312 → vless-nl"
  actions={<><IconButton label="Изменить"><Icon name="pencil" /></IconButton><Switch checked onChange={t} /></>} />
```

- Между строками — `gap`, не margin: перетаскивание и удаление не должны ломать ритм.
- Порядок = приоритет? Тогда номер обязателен, а сортировку по имени не предлагайте.

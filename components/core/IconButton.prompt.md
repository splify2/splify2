Действие внутри строки: изменить, поднять, удалить.

```jsx
<IconButton label="Изменить правило" onClick={edit}><Icon name="pencil" /></IconButton>
<IconButton label="Удалить" tone="danger"><Icon name="trash-2" /></IconButton>
```

- `label` не опционален: без него в строке остаётся безымянный глиф.
- Не больше четырёх в одной строке; дальше — меню.

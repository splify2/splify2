Столбцы по категориям: дни месяца, часы дня, месяцы. Стопкой — когда части складываются в целое. Наведение показывает все ряды категории и итог стопки.

```jsx
<Bars labels={hours} stacked totalLabel="магазин"
  series={[{ label: "Гипер", values: hyper, tone: "accent" },
           { label: "ТП",    values: tp,    tone: "off" }]}
  ghost={typical} ghostLabel="обычный такой день" />

// ход дня: один показатель в трёх состояниях — плотностью, не цветом
<Bars labels={hours} stacked labelSeries={0}
  series={[{ label: "закрыто",    values: fact,     tone: "accent" },
           { label: "идёт сейчас", values: running,  tone: "accent", fill: "half" },
           { label: "ожидание",   values: expected, tone: "accent", fill: "ghost" },
           { label: "обычный день", values: typical, tone: "off", fill: "ghost", beside: true }]} />

// месяцы: план — призрак, факт — акцент, прогноз источника — линия поверх
<Bars labels={months} labelSeries={1}
  series={[{ label: "план", values: plan, tone: "ink", fill: "ghost" }, { label: "факт", values: fact }]}
  lines={[{ label: "прогноз API", values: api, tone: "muted", points: true }]} />
```

- Ось одна. Две величины разного масштаба — два графика, а не вторая ось. `lines` — только ряды того же масштаба.
- Стопка — только для частей одного целого (Гипер + ТП = магазин). Сравнение независимых рядов — группами; `beside` ставит эталон отдельным столбцом рядом со стопкой.
- Второстепенный ряд — серый `off`, не второй цвет: у системы один акцент, и он занят главным.
- `fill: "half"` — незавершённое (идущий час), `fill: "ghost"` — ожидание пунктирным контуром; `ghost` — то же ожидание за всей группой.
- Подписи значений — на столбцах, пока их не больше 14; дальше вместо них ось слева (`axis="auto"`) и подсказка. `labelSeries` выбирает, чей ряд подписывать.
- `bands` — подложка выходных; `reference` — уровень чернилами (цель, план).

import EngineCard from '@/components/EngineCard'
import { type Live } from '@/lib/live'

import { S } from '@/copy'
/** Первый экран у беты: движка нет.
 *
 *  Показывается ВМЕСТО вкладок, а не рядом с ними. Прежде интерфейс в этом случае открывал
 *  мастер, где половина шагов не могла подействовать: без движка нечем ни проверить настройку,
 *  ни применить её. Человек заполнял подписку, нажимал «Применить» и получал отказ на последнем
 *  шаге — то есть узнавал причину после всей работы, а не до.
 *
 *  Выбор варианта сборки остаётся человеку: зависимость apk умеет только «нужен steer», и
 *  угадав за него, мы либо кладём лишний мегабайт, либо не кладём VLESS и получаем «outbound не
 *  работает» уже после настройки всего остального. Поэтому объяснение стоит РЯДОМ с выбором. */
export default function FirstRun({ live }: { live: Live }) {
    return (
        <div className="sp-root text-foreground">
            <div className="mx-auto max-w-2xl space-y-4">
                <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
                    <h1 className="sp-title">{S.firstRun.yadroNeUstanovleno}</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        {/* Разделение ролей (splify2 — интерфейс, steer — маршрутизация) на экран
                          * не выносим: человеку нужно не устройство продукта, а то, что до
                          * установки движка ничего не заработает, и с чего начать. */}
                        {S.firstRun.marshrutizatsieyZanimaetsya}<b>steer</b>{S.firstRun.pokaEgoNetProveryat}</p>
                    <ul className="mt-3 space-y-1.5 text-sm">
                        <li>
                            <b>extended</b>
                            <span className="text-muted-foreground">
                                {' '}{S.firstRun.podnimaetVlessRealitySam}</span>
                        </li>
                        <li>
                            <b>basic</b>
                            <span className="text-muted-foreground">
                                {' '}{S.firstRun.tolkoMarshrutizatsiyaPoGotovym}</span>
                        </li>
                    </ul>
                </div>

                <EngineCard engine={live.build} releases={live.releases} onInstalled={live.refresh} />

                <p className="text-xs text-muted-foreground">
                    {S.firstRun.paketMozhnoPostavitI}{' '}
                    <code className="font-mono">apk add --allow-untrusted ./steer-extended-*.apk</code>{S.firstRun.naRoutereS64}</p>
            </div>
        </div>
    )
}

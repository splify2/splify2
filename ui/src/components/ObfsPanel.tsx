import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { FieldRow, ToggleRow } from '@/components/ui/layout'
import { inputCls } from '@/components/formbits'
import { isIp4 } from '@/lib/validate'
import type { Obfs, Output } from '@/lib/model'

// «WireGuard поверх TCP» для выхода kind=interface.
//
// Зачем это в интерфейсе вообще. Симптом, ради которого сюда приходят, звучит как «всё
// настроено, но туннель не поднимается»: маршрутизация исправна, устройство есть, метки
// стоят — а WireGuard это UDP целиком, и там, где UDP режут или пропускают по белому
// списку протоколов, не доходит ни один пакет. Обфускация уносит те же датаграммы внутрь
// потока, который выглядит обычным TCP.
//
// ЛОКАЛЬНЫЙ АДРЕС НЕ СПРАШИВАЕМ. Движок принимает любой, но осмысленный здесь ровно один:
// на этот порт приходит трафик, ещё не зашифрованный WireGuard'ом, и выставлять его в сеть
// нельзя. Поле, у которого один правильный ответ, — это не свобода, а способ ошибиться,
// поэтому спрашивается только порт, а адрес показан как есть.
//
// ПОРТ ДОЛЖЕН СОВПАДАТЬ С `Endpoint` ПИРА. Это единственное место, где две настройки
// обязаны знать друг о друге, и вывести одну из другой нельзя: ключи и пиры WireGuard
// живут в /etc/config/network и движку не принадлежат. Расхождение молчаливо — WireGuard
// шлёт в никуда, — поэтому оно названо прямо в подсказке, а не в документации.
//
// Bode 26.10, раскладка по образцу приложения Splify2: выключатель у правого края строки,
// пояснение под подписью; поля — строками «подпись слева, поле справа» через волосяную линию.
// Прежде здесь стояла галочка и три поля в ряд, которые на телефоне ломались на три строки
// разной ширины.

const LOCAL_ADDR = '127.0.0.1'

interface Props {
    output: Output
    onChange: (o: Output) => void
}

function split(hostport?: string): { host: string; port: string } {
    if (!hostport) return { host: '', port: '' }
    const i = hostport.lastIndexOf(':')
    if (i < 1) return { host: hostport, port: '' }
    return { host: hostport.slice(0, i), port: hostport.slice(i + 1) }
}

const isPort = (v: string) => /^\d{1,5}$/.test(v) && Number(v) >= 1 && Number(v) <= 65535

export default function ObfsPanel({ output, onChange }: Props) {
    const on = !!output.obfs
    const server = split(output.obfs?.server)
    const listen = split(output.obfs?.listen)
    /* Черновик держится отдельно от спеки: наполовину введённый адрес — это спека,
     * которую движок отвергнет при сохранении, а спорить с интерфейсом, который сам это
     * и предложил, человеку не за что. Тот же приём, что с именем выхода выше. */
    const [host, setHost] = useState(server.host)
    const [sport, setSport] = useState(server.port)
    const [lport, setLport] = useState(listen.port || '51820')

    function push(next: Partial<{ host: string; sport: string; lport: string }>) {
        const h = next.host ?? host
        const sp = next.sport ?? sport
        const lp = next.lport ?? lport
        const obfs: Obfs = {
            mode: 'wg-over-tcp',
            server: `${h}:${sp}`,
            listen: `${LOCAL_ADDR}:${lp}`,
        }
        onChange({ ...output, obfs })
    }

    function toggle(enabled: boolean) {
        if (!enabled) {
            const next = { ...output }
            delete next.obfs
            onChange(next)
            return
        }
        push({})
    }

    const hostBad = host.length > 0 && !isIp4(host)
    const sportBad = sport.length > 0 && !isPort(sport)
    const lportBad = !isPort(lport)

    return (
        <div className="rounded-lg border border-border px-3 py-1">
            <ToggleRow
                label={
                    <span className="flex flex-wrap items-center gap-2">
                        WireGuard поверх TCP
                        {on && <Badge variant="secondary">обфускация включена</Badge>}
                    </span>
                }
                caption={
                    <>
                        Прячет туннель в поток, похожий на обычный TCP. Нужно там, где UDP режут: маршрутизация выглядит
                        исправной, а туннель не поднимается.
                        На другой стороне должен работать <code>steer obfs-server</code> или phantun.
                    </>
                }
                on={on}
                onToggle={() => toggle(!on)}
                switchLabel="WireGuard поверх TCP"
            />

            {on && (
                <div className="divide-y divide-border border-t border-border">
                    <FieldRow label="Сервер обфускации">
                        <input
                            value={host}
                            placeholder="203.0.113.10"
                            onChange={(e) => { setHost(e.currentTarget.value); push({ host: e.currentTarget.value }) }}
                            className={`${inputCls} w-full font-mono`}
                            aria-label="Адрес сервера обфускации"
                        />
                    </FieldRow>
                    <FieldRow label="Порт">
                        <input
                            value={sport}
                            placeholder="4567"
                            onChange={(e) => { setSport(e.currentTarget.value); push({ sport: e.currentTarget.value }) }}
                            className={`${inputCls} w-full font-mono`}
                            aria-label="Порт сервера обфускации"
                        />
                    </FieldRow>
                    <FieldRow label="Локальный порт (= Endpoint пира)">
                        <input
                            value={lport}
                            onChange={(e) => { setLport(e.currentTarget.value); push({ lport: e.currentTarget.value }) }}
                            className={`${inputCls} w-full font-mono`}
                            aria-label="Локальный порт обфускатора"
                        />
                    </FieldRow>

                    <div className="space-y-1.5 py-2.5">
                    {/* Адрес, а не имя: движок имена не разрешает — резолвить пришлось бы через
                        DNS, который сам может идти в этот туннель. Говорим об этом до
                        сохранения, а не отказом движка после. */}
                    {host.length === 0 && (
                        <p className="text-xs text-warning-fg">
                            Без адреса сервера обфускации выход не сохранится.
                        </p>
                    )}
                    {hostBad && (
                        <p className="text-xs text-warning-fg">
                            {/* Имена здесь не разрешаются намеренно: запрос к DNS ушёл бы в тот
                              * самый туннель, который через этот сервер и поднимается, — курица
                              * и яйцо. Человеку от этой причины пользы нет, ему нужен адрес. */}
                            Нужен адрес, а не имя.
                        </p>
                    )}
                    {(sportBad || lportBad) && (
                        <p className="text-xs text-warning-fg">Порт — число от 1 до 65535.</p>
                    )}

                    <p className="text-xs text-muted-foreground">
                        В настройках пира WireGuard <code>Endpoint</code> должен указывать на{' '}
                        <code>{LOCAL_ADDR}:{lport || '…'}</code> — иначе трафик уйдёт мимо
                        обфускатора и туннель молча не поднимется. И MTU: поверх TCP конверт
                        на 12 байт больше, чем поверх UDP, поэтому у интерфейса туннеля
                        обычно <code>1428</code> вместо 1440, одинаково с обеих сторон.
                    </p>
                    </div>
                </div>
            )}
        </div>
    )
}

import { useEffect, useState } from 'react'
import { Globe, Network, ShieldCheck } from 'lucide-react'
import { Group, ScreenHeader, TapRow } from '@/components/ui/layout'
import PoolList from '@/components/PoolList'
import IfacesPanel from '@/components/IfacesPanel'
import VlessScreen from '@/components/VlessScreen'
import XsteerPanel from '@/components/XsteerPanel'
import { rpc } from '@/lib/rpc'
import { usePending } from '@/lib/pending'
import { devList, isPart, isTunnelKind } from '@/lib/model'
import { type Live } from '@/lib/live'

import { S } from '@/copy'
/** VPN: чем роутер выходит наружу.
 *
 *  Три входа и один список. Входы отвечают на «что у меня есть»: свои туннели, узлы подписки,
 *  звезда xsteer. Список ниже — выходы, то есть то, во что правила ведут трафик; выход
 *  собирается из того, что нашлось за тремя входами.
 *
 *  Подпункт открывается НА МЕСТЕ раздела, а не отдельной вкладкой рельса: рельс отвечает за
 *  четыре роли, и раздувать его до четырнадцати пунктов значит вернуть строку вкладок, из
 *  которой видно треть.
 *
 *  Bode 26.10, раскладка по образцу приложения Splify2 для телефона: три входа — строками
 *  ОДНОЙ карточки (как перечень в «Настройках»), выходы — строками второй карточки со своим
 *  заголовком и счётчиком, подпункт открывается с шапкой «← заголовок». Прежде каждый вход и
 *  каждый выход был отдельной карточкой, и восемь карточек подряд читались как восемь разных
 *  вещей, а не как два перечня. */

type Screen = 'root' | 'ifaces' | 'vless' | 'xsteer'

const TITLE: Record<Exclude<Screen, 'root'>, string> = {
    ifaces: S.vpn.svoiTunneli,
    vless: S.vpn.podpiski,
    xsteer: 'XSTEER',
}

export default function Vpn({ live }: { live: Live }) {
    const [screen, setScreen] = useState<Screen>('root')
    /** Открыт редактор выхода. Тогда раздел показывает ТОЛЬКО его: три строки-входа сверху
     *  относятся к разделу, а не к правимому выходу, и над формой читались как её часть. */
    const [editing, setEditing] = useState(false)
    const { spec } = usePending()
    const [devices, setDevices] = useState<{ name: string; up: boolean; kind: string }[]>([])

    useEffect(() => {
        rpc.devices().then((d) => setDevices(d.devices || [])).catch(() => setDevices([]))
    }, [])

    if (screen !== 'root') {
        return (
            <div className="space-y-4">
                {/* Шапка вложенного экрана: стрелка назад и заголовок. Прежняя строка «‹ VPN /
                    VLESS» (экран теперь «Подписки») делала то же, но на другом языке, чем «Настройки»; теперь оба раздела
                    открывают подпункт одинаково. Подпись стрелки — «VPN»: это то, куда она ведёт. */}
                <ScreenHeader title={TITLE[screen]} back={() => setScreen('root')} backLabel="VPN" />
                {screen === 'ifaces' && <IfacesPanel live={live} />}
                {screen === 'vless' && <VlessScreen />}
                {screen === 'xsteer' && <XsteerPanel live={live} />}
            </div>
        )
    }

    const outputs = Object.values(spec?.outputs || {})
    /* Названо ровно то, что человек увидит, открыв подпункт: какие устройства взяты в работу,
     * сколько локаций подписки заведено, какие устройства xsteer есть. Служебные части пулов
     * считаются локациями своей подписки, а их устройства — не «свои туннели». */
    const partNames = new Set(outputs.filter((o) => isPart(o)).map((o) => o.name))
    const ifaceDevs = outputs
        .filter((o) => o.kind === 'interface')
        .flatMap((o) => devList(o))
        .filter((d) => !partNames.has(d))
    const vless = outputs.filter((o) => isTunnelKind(o.kind))
    const vlessCount = vless.reduce(
        (n, o) => n + Math.max(1, o.nodes?.length || 0),
        0,
    )
    const subCount = new Set(vless.map((o) => o.sub_file || '')).size
    /* Устройства xsteer из netifd и выходы спеки kind: xsteer — их клиента держит ядро steer,
     * и устройство у такого выхода названо по выходу, а не «xs-…». */
    const xs = [
        ...new Set([
            ...devices.filter((d) => d.kind === 'xsteer' || /^xs-/.test(d.name)).map((d) => d.name),
            ...outputs.filter((o) => o.kind === 'xsteer').map((o) => o.name),
        ]),
    ]

    /* PoolList стоит на ОДНОМ месте дерева в обоих состояниях: редактор — его внутреннее
     * состояние, и отдельная ветка `if (editing) return <PoolList/>` пересоздавала бы список
     * с нуля, то есть закрывала бы редактор в момент открытия. */
    return (
        <div className="space-y-4">
            {!editing && <Group>
                {/* «Свои туннели», а не «VPN»: строка «VPN» внутри раздела VPN не говорила,
                    что за ней — WireGuard, AmneziaWG и прочие устройства самого роутера. */}
                <TapRow
                    icon={ShieldCheck}
                    title={S.vpn.svoiTunneli}
                    subtitle={ifaceDevs.length ? S.vpn.vzyaty(ifaceDevs.join(', ')) : S.vpn.wireguardAmneziawgOpenvpnNi}
                    onClick={() => setScreen('ifaces')}
                />
                <TapRow
                    icon={Globe}
                    title={S.vpn.podpiski}
                    /* «ВЗЯТЫ», а не «подписок» — и это не придирка к слову. Оба числа
                       считаются по ВЫХОДАМ спеки, то есть говорят, сколько подписок и
                       локаций взято в работу. Подпись «подписок: 1» при двух заведённых
                       читалась как перечень того, что у человека есть, — и выглядела
                       сломанным счётчиком. Соседняя строка про туннели говорит «взяты: wg0»
                       ровно про то же самое; теперь обе говорят одинаково.

                       Пусто — «ни одна не взята», а не «подписок нет»: подписки могут быть
                       заведены и не использоваться ни одним выходом, и прежний текст в этом
                       случае прямо врал. */
                    subtitle={
                        vlessCount
                            ? S.vpn.vzyaty2(S.vpn.subscriptions(subCount), S.vpn.locations(vlessCount))
                            : S.vpn.niOdnaPodpiskaNe
                    }
                    onClick={() => setScreen('vless')}
                />
                <TapRow
                    icon={Network}
                    title="XSTEER"
                    subtitle={xs.length ? xs.join(', ') : S.vpn.interfeysovNet}
                    onClick={() => setScreen('xsteer')}
                />
            </Group>}

            {/* Заголовок «Выходы» — у самой карточки списка (PoolList), как у карточек
                приложения: название слева, счётчик справа. */}
            <PoolList live={live} onEditingChange={setEditing} />
        </div>
    )
}

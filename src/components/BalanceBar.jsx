import { Button } from 'animal-island-ui';
import { classNames } from '../lib/utils';
import { COST_CHAT, COST_DRAW } from '../lib/constants';

/**
 * 顶部余额提醒条。展示当前余额、单次费用、不足时高亮+显示充值按钮。
 * balance === null 表示尚未加载完成，不渲染。
 */
export default function BalanceBar({ balance, onRecharge, cost }) {
  if (balance === null || balance === undefined) return null;

  const low = balance < (cost || COST_CHAT) - 0.0001;
  const display = balance.toFixed(2);

  return (
    <div className={classNames('balance-bar', low && 'balance-bar-low')}>
      <span className="balance-bar-text">
        {low
          ? `余额不足：剩余 ¥${display}（聊天 ¥${COST_CHAT}/条 · 制图 ¥${COST_DRAW}/张）`
          : `余额 ¥${display}（聊天 ¥${COST_CHAT}/条 · 制图 ¥${COST_DRAW}/张）`}
      </span>
      <Button
        type={low ? 'primary' : 'default'}
        size="small"
        onClick={onRecharge}
        aria-label="充值"
      >
        充值
      </Button>
    </div>
  );
}

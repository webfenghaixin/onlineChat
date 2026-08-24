import { useState } from 'react';
import { Button, Modal, Divider, Title } from 'animal-island-ui';
import { BALANCE_RECHARGE_PRESETS } from '../../lib/constants';

/**
 * 充值弹窗。展示预设金额快捷选择，需输入充值码，调 onRecharge(amount, code)。
 */
export default function RechargeDialog({
  visible,
  balance,
  loading,
  onRecharge,
  onCancel,
}) {
  const [customAmount, setCustomAmount] = useState('');
  const [rechargeCode, setRechargeCode] = useState('');

  function submit(amount) {
    const num = Number(amount);
    const code = rechargeCode.trim();
    if (!Number.isFinite(num) || num <= 0 || !code) return;
    onRecharge(num, code);
  }

  return (
    <Modal
      open={visible}
      title="充值余额"
      onClose={onCancel}
      typewriter={false}
      width={460}
      footer={
        <Button type="text" onClick={onCancel}>关闭</Button>
      }
    >
      <div className="recharge-dialog">
        <div className="recharge-balance-info">
          <span>当前余额</span>
          <Title size="large" color="app-teal">
            ¥{balance === null || balance === undefined ? '--' : balance.toFixed(2)}
          </Title>
        </div>
        <Divider type="wave-yellow" />
        <div className="recharge-presets">
          {BALANCE_RECHARGE_PRESETS.map((amt) => (
            <Button
              key={amt}
              type="default"
              size="small"
              className="recharge-preset-btn"
              disabled={loading}
              onClick={() => submit(amt)}
            >
              ¥{amt}
            </Button>
          ))}
        </div>
        <div className="recharge-custom">
          <input
            type="number"
            min="1"
            step="1"
            className="recharge-custom-input"
            placeholder="自定义金额"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit(customAmount);
              }
            }}
          />
          <Button
            type="primary"
            size="small"
            disabled={loading || !customAmount || Number(customAmount) <= 0 || !rechargeCode.trim()}
            onClick={() => submit(customAmount)}
          >
            {loading ? '处理中...' : '确认充值'}
          </Button>
        </div>
        <input
          type="password"
          className="recharge-custom-input recharge-code-input"
          placeholder="请输入充值码"
          value={rechargeCode}
          onChange={(e) => setRechargeCode(e.target.value)}
          disabled={loading}
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit(customAmount);
            }
          }}
        />
        <p className="recharge-hint">
          充值后立即到账，可用于继续聊天或画图。需要向管理员获取充值码。
        </p>
      </div>
    </Modal>
  );
}

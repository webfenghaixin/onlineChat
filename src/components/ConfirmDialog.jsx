import { classNames } from '../lib/utils';

export default function ConfirmDialog({
  visible,
  title,
  description,
  onCancel,
  onConfirm,
  titleId,
}) {
  if (!visible) return null;

  return (
    <div className="confirm-layer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button
        className="confirm-backdrop"
        type="button"
        aria-label="取消删除"
        onClick={onCancel}
      />
      <div className="confirm-dialog">
        <h2 id={titleId}>{title}</h2>
        <p>{description}</p>
        <div className="confirm-actions">
          <button className="confirm-button confirm-button-secondary" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="confirm-button confirm-button-danger" type="button" onClick={onConfirm}>
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

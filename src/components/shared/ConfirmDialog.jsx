import { Modal, Button } from 'animal-island-ui';

export default function ConfirmDialog({
  visible,
  title,
  description,
  onCancel,
  onConfirm,
  titleId,
}) {
  return (
    <Modal
      open={visible}
      title={title}
      onClose={onCancel}
      typewriter={false}
      width={420}
      footer={
        <>
          <Button type="text" onClick={onCancel}>取消</Button>
          <Button type="primary" danger onClick={onConfirm}>删除</Button>
        </>
      }
    >
      <span id={titleId}>{description}</span>
    </Modal>
  );
}

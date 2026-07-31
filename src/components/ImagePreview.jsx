import { useMemo, useState } from 'react';
import Lightbox from 'yet-another-react-lightbox';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/counter.css';

export default function ImagePreview({ images, index, onClose }) {
  // 冻结首次挂载时的图片列表：预览期间 images prop 可能因生成任务进行中而流式追加新图，
  // 若 list 随之变化会导致 slides 引用变化，库内部 dispatch update 重置 globalIndex（切回第一张）
  const [list] = useState(() => Array.isArray(images) ? images.filter(Boolean) : []);

  const initialIndex = Math.min(
    list.length - 1,
    Math.max(0, Number(index) || 0),
  );

  // Lightbox 的 index 为受控状态，需通过 on.view 回调同步，否则滑动后会被拉回初始 index
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  // slides 引用保持稳定，避免库因 slides 引用变化触发 update 重置 index
  const slides = useMemo(
    () => list.map((src, slideIndex) => ({
      src,
      alt: `预览图片 ${slideIndex + 1}`,
      imageFit: 'contain',
    })),
    [list],
  );

  if (list.length === 0) return null;

  return (
    <Lightbox
      open
      close={onClose}
      index={currentIndex}
      on={{ view: ({ index: viewIndex }) => setCurrentIndex(viewIndex) }}
      slides={slides}
      plugins={[Zoom, Counter]}
      className="image-preview-lightbox"
      carousel={{
        finite: true,
        imageFit: 'contain',
        padding: 0,
        spacing: '12px',
        preload: 2,
      }}
      controller={{
        closeOnBackdropClick: true,
        closeOnPullDown: false,
        closeOnPullUp: false,
      }}
      zoom={{
        maxZoomPixelRatio: 4,
        zoomInMultiplier: 2,
        doubleClickMaxStops: 3,
        pinchZoomV4: true,
        scrollToZoom: true,
      }}
      animation={{
        fade: 180,
        swipe: 260,
        zoom: 200,
      }}
      toolbar={{ buttons: ['zoom', 'close'] }}
      counter={{ separator: ' / ' }}
      labels={{
        Previous: '上一张',
        Next: '下一张',
        Close: '关闭预览',
        'Zoom in': '放大图片',
        'Zoom out': '缩小图片',
        Slide: '图片',
        Carousel: '图片预览',
        Lightbox: '图片预览',
        'Photo gallery': '图片列表',
        '{index} of {total}': '第 {index} 张，共 {total} 张',
      }}
    />
  );
}

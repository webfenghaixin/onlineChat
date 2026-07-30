import Lightbox from 'yet-another-react-lightbox';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/counter.css';

export default function ImagePreview({ images, index, onClose }) {
  const list = Array.isArray(images) ? images.filter(Boolean) : [];
  if (list.length === 0) return null;

  const initialIndex = Math.min(
    list.length - 1,
    Math.max(0, Number(index) || 0),
  );

  return (
    <Lightbox
      open
      close={onClose}
      index={initialIndex}
      slides={list.map((src, slideIndex) => ({
        src,
        alt: `预览图片 ${slideIndex + 1}`,
        imageFit: 'contain',
      }))}
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

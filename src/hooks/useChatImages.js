import { useCallback, useRef, useState } from 'react';
import { prepareChatImage } from '../lib/image-utils.js';
import { CHAT_MAX_IMAGES } from '../lib/constants.js';

/**
 * 聊天图片上传/处理逻辑（从 useChatActions 拆分）
 * 自包含图片相关 state/refs
 */
export function useChatImages({
  authState,
  setErrorText,
  setStatusText,
}) {
  const [pendingImages, setPendingImages] = useState([]);
  const [imageProcessing, setImageProcessing] = useState(false);
  const fileInputRef = useRef(null);
  const chatImageProcessingRef = useRef(false);

  const handleUploadClick = useCallback(() => {
    if (authState !== 'authenticated') return;
    fileInputRef.current?.click();
  }, [authState]);

  const processChatImageFiles = useCallback(async (files) => {
    if (authState !== 'authenticated') return;
    if (chatImageProcessingRef.current) {
      setErrorText('图片正在处理中，请稍候。');
      return;
    }
    const normalizedFiles = Array.from(files || []);
    if (normalizedFiles.length === 0) return;
    const imageFiles = normalizedFiles.filter((file) => file?.type?.startsWith('image/'));
    if (imageFiles.length === 0) {
      setErrorText('只能上传图片文件。');
      return;
    }
    const remainingSlots = CHAT_MAX_IMAGES - pendingImages.length;
    if (remainingSlots <= 0) {
      setErrorText(`最多只能上传 ${CHAT_MAX_IMAGES} 张图片。`);
      return;
    }
    const filesToProcess = imageFiles.slice(0, remainingSlots);
    if (imageFiles.length > remainingSlots) {
      setErrorText(`最多只能上传 ${CHAT_MAX_IMAGES} 张图片，已添加前 ${remainingSlots} 张。`);
    } else {
      setErrorText('');
    }
    chatImageProcessingRef.current = true;
    setImageProcessing(true);
    setStatusText('正在处理图片');
    try {
      const results = await Promise.all(
        filesToProcess.map(async (file) => {
          const optimizedUrl = await prepareChatImage(file);
          return { name: file.name || `clipboard-image-${Date.now()}`, url: optimizedUrl };
        }),
      );
      setPendingImages((prev) => [...prev, ...results]);
      setStatusText('已就绪');
    } catch (error) {
      setErrorText(error.message || '图片处理失败，请重试。');
      setStatusText('图片处理失败');
    } finally {
      chatImageProcessingRef.current = false;
      setImageProcessing(false);
    }
  }, [authState, pendingImages.length, setErrorText, setStatusText]);

  const handleFileChange = useCallback((event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    void processChatImageFiles(files);
  }, [processChatImageFiles]);

  const handleComposerPaste = useCallback((event) => {
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;
    const itemImages = Array.from(clipboardData.items || [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    const fileImages = Array.from(clipboardData.files || [])
      .filter((file) => file?.type?.startsWith('image/'));
    const imageFiles = itemImages.length > 0 ? itemImages : fileImages;
    if (imageFiles.length === 0) return;
    event.preventDefault();
    void processChatImageFiles(imageFiles);
  }, [processChatImageFiles]);

  const removePendingImage = useCallback((index) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearPendingImages = useCallback(() => {
    setPendingImages([]);
  }, []);

  return {
    pendingImages, setPendingImages, imageProcessing,
    fileInputRef,
    handleUploadClick, processChatImageFiles, handleFileChange, handleComposerPaste,
    removePendingImage, clearPendingImages,
  };
}

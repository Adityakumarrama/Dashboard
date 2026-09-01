import { useRef, useEffect, useCallback, useState } from 'react';

/**
 * Hook for debounced autosave
 * @param {Function} saveFn - async function to call with current data
 * @param {any} data - data to autosave (will trigger save when changed)
 * @param {number} delay - debounce delay in ms
 * @param {boolean} enabled - whether autosave is enabled
 */
export function useAutosave(saveFn, data, delay = 30000, enabled = true) {
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const timerRef = useRef(null);
  const dataRef = useRef(data);
  const initialRef = useRef(true);

  // Update ref when data changes
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const save = useCallback(async () => {
    if (!enabled) return;
    try {
      setSaveStatus('saving');
      await saveFn(dataRef.current);
      setSaveStatus('saved');
      setLastSavedAt(new Date());
    } catch (err) {
      setSaveStatus('error');
      console.error('Autosave failed:', err);
    }
  }, [saveFn, enabled]);

  // Debounced autosave on data change
  useEffect(() => {
    if (initialRef.current) {
      initialRef.current = false;
      return;
    }
    if (!enabled) return;

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, delay);

    return () => clearTimeout(timerRef.current);
  }, [data, delay, save, enabled]);

  // Save before unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (enabled && saveStatus !== 'saved') {
        save();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [save, enabled, saveStatus]);

  const getStatusText = () => {
    switch (saveStatus) {
      case 'saving': return 'Saving...';
      case 'saved': {
        if (!lastSavedAt) return 'Saved';
        const seconds = Math.floor((Date.now() - lastSavedAt.getTime()) / 1000);
        if (seconds < 5) return 'Saved just now';
        if (seconds < 60) return `Saved ${seconds}s ago`;
        return `Saved ${Math.floor(seconds / 60)}m ago`;
      }
      case 'error': return 'Save failed — will retry';
      default: return '';
    }
  };

  return {
    saveStatus,
    lastSavedAt,
    statusText: getStatusText(),
    forceSave: save,
  };
}

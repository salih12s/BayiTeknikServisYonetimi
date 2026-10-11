import { useEffect, useState } from 'react';

/** Telefon yan çevrildiğinde sayfanın çizileceği genişlik (masaüstü düzeni). */
const DESKTOP_VIEW_WIDTH = 1280;

function isPhone(): boolean {
  // Dokunmatik ve kısa kenarı küçük ekran: telefon. Tabletler zaten geniş düzeni alır.
  return (
    window.matchMedia('(pointer: coarse)').matches &&
    Math.min(window.screen.width, window.screen.height) < 600
  );
}

function isLandscape(): boolean {
  return window.matchMedia('(orientation: landscape)').matches;
}

/**
 * Telefonda ekran YAN çevrildiğinde sayfayı bilgisayardaki düzeniyle gösterir.
 *
 * Telefon yan durduğunda ekran 700-900 piksel genişliğindedir: masaüstü tablosu sığmaz,
 * telefon düzeni de devreye girmez; sonuç kullanışsız bir karışımdır. Burada tarayıcıya
 * "sayfayı 1280 piksel genişliğinde çiz ve ekrana sığdır" denir (tarayıcıdaki "masaüstü
 * sitesi" seçeneğinin yaptığı şey); kullanıcı parmaklarıyla yakınlaştırabilir. Telefon dik
 * tutulduğunda telefon düzeni olduğu gibi kalır.
 *
 * `active` false ise (ör. saha paneli) hiçbir şeye dokunulmaz.
 */
export function usePhoneDesktopView(active: boolean): { phone: boolean; landscape: boolean } {
  const [state, setState] = useState(() => ({ phone: isPhone(), landscape: isLandscape() }));

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!active || !meta) return undefined;
    const original = meta.content;

    const apply = () => {
      const next = { phone: isPhone(), landscape: isLandscape() };
      meta.content = next.phone && next.landscape ? `width=${DESKTOP_VIEW_WIDTH}` : original;
      setState((prev) => (prev.phone === next.phone && prev.landscape === next.landscape ? prev : next));
    };
    apply();

    const orientation = window.matchMedia('(orientation: landscape)');
    orientation.addEventListener('change', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      orientation.removeEventListener('change', apply);
      window.removeEventListener('orientationchange', apply);
      meta.content = original;
    };
  }, [active]);

  return state;
}
